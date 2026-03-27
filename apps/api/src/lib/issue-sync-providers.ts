import type { Database } from "@prometheus/db";
import { oauthTokens } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { decrypt } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";

const logger = createLogger("api:issue-sync-providers");

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ExternalIssue {
  body: string;
  externalId: string;
  status: string;
  title: string;
  updatedAt: string | null;
  url: string;
}

export interface ExternalPR {
  baseBranch: string;
  branch: string;
  externalId: string;
  title: string;
  updatedAt: string | null;
  url: string;
}

interface ProviderContext {
  db: Database;
  orgId: string;
  repoUrl: string;
}

// ---------------------------------------------------------------------------
// Token retrieval helper
// ---------------------------------------------------------------------------

async function getProviderToken(
  db: Database,
  orgId: string,
  provider: string
): Promise<string | null> {
  const tokenRow = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.orgId, orgId),
      eq(oauthTokens.provider, provider)
    ),
  });

  if (!tokenRow) {
    logger.warn({ orgId, provider }, "No OAuth token found for provider");
    return null;
  }

  try {
    return decrypt(tokenRow.accessToken);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ provider, error: msg }, "Failed to decrypt OAuth token");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Repo URL parsing helpers
// ---------------------------------------------------------------------------

const GITHUB_REPO_RE = /github\.com[/:]([^/]+)\/([^/.]+)/;
const GITLAB_PROJECT_RE = /gitlab\.com[/:](.+?)(?:\.git)?$/;

function parseGitHubOwnerRepo(
  repoUrl: string
): { owner: string; repo: string } | null {
  const match = GITHUB_REPO_RE.exec(repoUrl);
  const owner = match?.[1];
  const repo = match?.[2];
  if (!(owner && repo)) {
    return null;
  }
  return { owner, repo };
}

function parseGitLabProjectPath(repoUrl: string): string | null {
  const match = GITLAB_PROJECT_RE.exec(repoUrl);
  const projectPath = match?.[1];
  if (!projectPath) {
    return null;
  }
  return projectPath;
}

// ---------------------------------------------------------------------------
// GitHub provider
// ---------------------------------------------------------------------------

interface GitHubIssue {
  body: string | null;
  html_url: string;
  number: number;
  pull_request?: unknown;
  state: string;
  title: string;
  updated_at: string;
}

interface GitHubPR {
  base: { ref: string };
  head: { ref: string };
  html_url: string;
  number: number;
  title: string;
  updated_at: string;
}

async function fetchGitHubIssues(
  ctx: ProviderContext
): Promise<ExternalIssue[]> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    logger.warn({ repoUrl: ctx.repoUrl }, "Cannot parse GitHub repo URL");
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return [];
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues?state=all&per_page=100&sort=updated&direction=desc`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, owner: parsed.owner, repo: parsed.repo },
        "GitHub issues API request failed"
      );
      return [];
    }

    const data = (await response.json()) as GitHubIssue[];

    // GitHub returns PRs in the issues endpoint; filter them out
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        externalId: String(issue.number),
        title: issue.title,
        body: issue.body ?? "",
        status: issue.state,
        url: issue.html_url,
        updatedAt: issue.updated_at,
      }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "github", error: msg },
      "Failed to fetch GitHub issues"
    );
    return [];
  }
}

async function fetchGitHubPRs(ctx: ProviderContext): Promise<ExternalPR[]> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    logger.warn({ repoUrl: ctx.repoUrl }, "Cannot parse GitHub repo URL");
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return [];
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, owner: parsed.owner, repo: parsed.repo },
        "GitHub PRs API request failed"
      );
      return [];
    }

    const data = (await response.json()) as GitHubPR[];

    return data.map((pr) => ({
      externalId: String(pr.number),
      title: pr.title,
      branch: pr.head.ref,
      baseBranch: pr.base.ref,
      url: pr.html_url,
      updatedAt: pr.updated_at,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "github", error: msg },
      "Failed to fetch GitHub PRs"
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// GitLab provider
// ---------------------------------------------------------------------------

interface GitLabIssue {
  description: string | null;
  iid: number;
  state: string;
  title: string;
  updated_at: string;
  web_url: string;
}

interface GitLabMR {
  iid: number;
  source_branch: string;
  target_branch: string;
  title: string;
  updated_at: string;
  web_url: string;
}

async function fetchGitLabIssues(
  ctx: ProviderContext
): Promise<ExternalIssue[]> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    logger.warn({ repoUrl: ctx.repoUrl }, "Cannot parse GitLab project URL");
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return [];
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/issues?per_page=100&order_by=updated_at&sort=desc`;
    const response = await fetch(url, {
      headers: {
        "PRIVATE-TOKEN": token,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, projectPath },
        "GitLab issues API request failed"
      );
      return [];
    }

    const data = (await response.json()) as GitLabIssue[];

    return data.map((issue) => ({
      externalId: String(issue.iid),
      title: issue.title,
      body: issue.description ?? "",
      status: issue.state,
      url: issue.web_url,
      updatedAt: issue.updated_at,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "gitlab", error: msg },
      "Failed to fetch GitLab issues"
    );
    return [];
  }
}

async function fetchGitLabPRs(ctx: ProviderContext): Promise<ExternalPR[]> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    logger.warn({ repoUrl: ctx.repoUrl }, "Cannot parse GitLab project URL");
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return [];
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests?per_page=100&order_by=updated_at&sort=desc`;
    const response = await fetch(url, {
      headers: {
        "PRIVATE-TOKEN": token,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, projectPath },
        "GitLab merge requests API request failed"
      );
      return [];
    }

    const data = (await response.json()) as GitLabMR[];

    return data.map((mr) => ({
      externalId: String(mr.iid),
      title: mr.title,
      branch: mr.source_branch,
      baseBranch: mr.target_branch,
      url: mr.web_url,
      updatedAt: mr.updated_at,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "gitlab", error: msg },
      "Failed to fetch GitLab MRs"
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Jira provider
// ---------------------------------------------------------------------------

/**
 * Jira stores its domain in the oauth token's providerAccountId field
 * (e.g. "your-company.atlassian.net") or we extract it from providerUsername.
 * The token row also stores the email needed for Basic auth in providerUsername.
 */

interface JiraSearchResponse {
  issues: Array<{
    fields: {
      description?: {
        content?: Array<{
          content?: Array<{ text?: string }>;
        }>;
      };
      status: { name: string };
      summary: string;
      updated: string;
    };
    key: string;
  }>;
}

async function fetchJiraIssues(ctx: ProviderContext): Promise<ExternalIssue[]> {
  const tokenRow = await ctx.db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.orgId, ctx.orgId),
      eq(oauthTokens.provider, "jira")
    ),
  });

  if (!tokenRow) {
    logger.warn({ orgId: ctx.orgId }, "No Jira OAuth token found");
    return [];
  }

  let apiToken: string;
  try {
    apiToken = decrypt(tokenRow.accessToken);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to decrypt Jira token");
    return [];
  }

  // providerAccountId stores the Jira domain (e.g. "mycompany.atlassian.net")
  // providerUsername stores the email for Basic auth
  const domain = tokenRow.providerAccountId;
  const email = tokenRow.providerUsername;
  if (!(domain && email)) {
    logger.warn(
      { orgId: ctx.orgId },
      "Jira token missing domain (providerAccountId) or email (providerUsername)"
    );
    return [];
  }

  try {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const jql = encodeURIComponent("ORDER BY updated DESC");
    const url = `https://${domain}/rest/api/3/search?jql=${jql}&maxResults=100&fields=summary,status,description,updated`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, domain },
        "Jira search API request failed"
      );
      return [];
    }

    const data = (await response.json()) as JiraSearchResponse;

    return data.issues.map((issue) => {
      // Extract plain text from ADF description
      const descriptionText =
        issue.fields.description?.content
          ?.flatMap((block) => block.content?.map((c) => c.text ?? "") ?? [])
          .join("\n") ?? "";

      return {
        externalId: issue.key,
        title: issue.fields.summary,
        body: descriptionText,
        status: issue.fields.status.name,
        url: `https://${domain}/browse/${issue.key}`,
        updatedAt: issue.fields.updated,
      };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "jira", error: msg },
      "Failed to fetch Jira issues"
    );
    return [];
  }
}

function fetchJiraPRs(_ctx: ProviderContext): Promise<ExternalPR[]> {
  // Jira does not have a native pull request concept.
  // PRs are linked via dev tools integrations (Bitbucket, GitHub, etc.)
  // and are not directly queryable from the Jira REST API.
  logger.info("Jira does not support native PR fetching; returning empty");
  return Promise.resolve([]);
}

// ---------------------------------------------------------------------------
// Linear provider
// ---------------------------------------------------------------------------

interface LinearIssuesResponse {
  data?: {
    issues?: {
      nodes?: Array<{
        description: string | null;
        identifier: string;
        state: { name: string };
        title: string;
        updatedAt: string;
        url: string;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

async function fetchLinearIssues(
  ctx: ProviderContext
): Promise<ExternalIssue[]> {
  const token = await getProviderToken(ctx.db, ctx.orgId, "linear");
  if (!token) {
    return [];
  }

  try {
    const query = `
      query SyncIssues {
        issues(
          first: 100,
          orderBy: updatedAt
        ) {
          nodes {
            identifier
            title
            description
            state { name }
            updatedAt
            url
          }
        }
      }
    `;

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status },
        "Linear GraphQL API request failed"
      );
      return [];
    }

    const data = (await response.json()) as LinearIssuesResponse;

    if (data.errors?.length) {
      logger.error(
        { errors: data.errors.map((e) => e.message) },
        "Linear GraphQL returned errors"
      );
      return [];
    }

    const nodes = data.data?.issues?.nodes ?? [];

    return nodes.map((issue) => ({
      externalId: issue.identifier,
      title: issue.title,
      body: issue.description ?? "",
      status: issue.state.name,
      url: issue.url,
      updatedAt: issue.updatedAt,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "linear", error: msg },
      "Failed to fetch Linear issues"
    );
    return [];
  }
}

function fetchLinearPRs(_ctx: ProviderContext): Promise<ExternalPR[]> {
  // Linear does not have pull requests; it links to external Git PRs.
  // PRs should be synced from the Git provider (GitHub/GitLab) instead.
  logger.info("Linear does not support native PR fetching; returning empty");
  return Promise.resolve([]);
}

// ---------------------------------------------------------------------------
// Bitbucket provider (read operations)
// ---------------------------------------------------------------------------

interface BitbucketIssue {
  content: { raw: string };
  id: number;
  links: { html: { href: string } };
  state: string;
  title: string;
  updated_on: string;
}

interface BitbucketPR {
  destination: { branch: { name: string } };
  id: number;
  links: { html: { href: string } };
  source: { branch: { name: string } };
  title: string;
  updated_on: string;
}

async function fetchBitbucketIssues(
  ctx: ProviderContext
): Promise<ExternalIssue[]> {
  const parsed = parseBitbucketOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    logger.warn({ repoUrl: ctx.repoUrl }, "Cannot parse Bitbucket repo URL");
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "bitbucket");
  if (!token) {
    return [];
  }

  try {
    const url = `https://api.bitbucket.org/2.0/repositories/${parsed.owner}/${parsed.repo}/issues?sort=-updated_on&pagelen=100`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, owner: parsed.owner, repo: parsed.repo },
        "Bitbucket issues API request failed"
      );
      return [];
    }

    const data = (await response.json()) as { values: BitbucketIssue[] };

    return (data.values ?? []).map((issue) => ({
      externalId: String(issue.id),
      title: issue.title,
      body: issue.content?.raw ?? "",
      status: issue.state,
      url: issue.links?.html?.href ?? "",
      updatedAt: issue.updated_on,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "bitbucket", error: msg },
      "Failed to fetch Bitbucket issues"
    );
    return [];
  }
}

async function fetchBitbucketPRs(ctx: ProviderContext): Promise<ExternalPR[]> {
  const parsed = parseBitbucketOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    logger.warn({ repoUrl: ctx.repoUrl }, "Cannot parse Bitbucket repo URL");
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "bitbucket");
  if (!token) {
    return [];
  }

  try {
    const url = `https://api.bitbucket.org/2.0/repositories/${parsed.owner}/${parsed.repo}/pullrequests?sort=-updated_on&pagelen=100&state=OPEN&state=MERGED&state=DECLINED`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, owner: parsed.owner, repo: parsed.repo },
        "Bitbucket PRs API request failed"
      );
      return [];
    }

    const data = (await response.json()) as { values: BitbucketPR[] };

    return (data.values ?? []).map((pr) => ({
      externalId: String(pr.id),
      title: pr.title,
      branch: pr.source?.branch?.name ?? "",
      baseBranch: pr.destination?.branch?.name ?? "",
      url: pr.links?.html?.href ?? "",
      updatedAt: pr.updated_on,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "bitbucket", error: msg },
      "Failed to fetch Bitbucket PRs"
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Azure DevOps provider
// ---------------------------------------------------------------------------

const AZDO_RE = /dev\.azure\.com\/([^/]+)\/([^/]+)/;

function parseAzureDevOpsOrgProject(
  repoUrl: string
): { org: string; project: string } | null {
  const match = AZDO_RE.exec(repoUrl);
  const org = match?.[1];
  const project = match?.[2];
  if (!(org && project)) {
    return null;
  }
  return { org, project };
}

async function fetchAzureDevOpsIssues(
  ctx: ProviderContext
): Promise<ExternalIssue[]> {
  const parsed = parseAzureDevOpsOrgProject(ctx.repoUrl);
  if (!parsed) {
    logger.warn({ repoUrl: ctx.repoUrl }, "Cannot parse Azure DevOps URL");
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "azure_devops");
  if (!token) {
    return [];
  }

  try {
    const wiql = JSON.stringify({
      query:
        "SELECT [System.Id],[System.Title],[System.State],[System.Description],[System.ChangedDate] FROM WorkItems ORDER BY [System.ChangedDate] DESC",
    });
    const url = `https://dev.azure.com/${parsed.org}/${parsed.project}/_apis/wit/wiql?api-version=7.1&$top=100`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: wiql,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status },
        "Azure DevOps WIQL query failed"
      );
      return [];
    }

    const data = (await response.json()) as {
      workItems: Array<{ id: number; url: string }>;
    };

    if (!data.workItems?.length) {
      return [];
    }

    const ids = data.workItems.slice(0, 100).map((wi) => wi.id);
    const batchUrl = `https://dev.azure.com/${parsed.org}/${parsed.project}/_apis/wit/workitems?ids=${ids.join(",")}&fields=System.Id,System.Title,System.State,System.Description,System.ChangedDate&api-version=7.1`;
    const batchResp = await fetch(batchUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!batchResp.ok) {
      return [];
    }

    const batchData = (await batchResp.json()) as {
      value: Array<{
        id: number;
        fields: Record<string, string>;
        _links: { html: { href: string } };
      }>;
    };

    return (batchData.value ?? []).map((wi) => ({
      externalId: String(wi.id),
      title: wi.fields["System.Title"] ?? "",
      body: wi.fields["System.Description"] ?? "",
      status: wi.fields["System.State"] ?? "",
      url:
        wi._links?.html?.href ??
        `https://dev.azure.com/${parsed.org}/${parsed.project}/_workitems/edit/${wi.id}`,
      updatedAt: wi.fields["System.ChangedDate"] ?? null,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "azure_devops", error: msg },
      "Failed to fetch Azure DevOps work items"
    );
    return [];
  }
}

async function fetchAzureDevOpsPRs(
  ctx: ProviderContext
): Promise<ExternalPR[]> {
  const parsed = parseAzureDevOpsOrgProject(ctx.repoUrl);
  if (!parsed) {
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "azure_devops");
  if (!token) {
    return [];
  }

  try {
    const url = `https://dev.azure.com/${parsed.org}/${parsed.project}/_apis/git/pullrequests?api-version=7.1&$top=100`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      value: Array<{
        pullRequestId: number;
        title: string;
        sourceRefName: string;
        targetRefName: string;
        url: string;
        closedDate?: string;
        creationDate: string;
      }>;
    };

    return (data.value ?? []).map((pr) => ({
      externalId: String(pr.pullRequestId),
      title: pr.title,
      branch: pr.sourceRefName.replace("refs/heads/", ""),
      baseBranch: pr.targetRefName.replace("refs/heads/", ""),
      url: pr.url,
      updatedAt: pr.closedDate ?? pr.creationDate,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "azure_devops", error: msg },
      "Failed to fetch Azure DevOps PRs"
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Gitea provider
// ---------------------------------------------------------------------------

const _GITEA_REPO_RE = /([^/]+)\/([^/]+)\/([^/.]+)/;

const GIT_SUFFIX_RE = /\.git$/;

function parseGiteaOwnerRepo(
  repoUrl: string
): { host: string; owner: string; repo: string } | null {
  // Gitea URLs can be any self-hosted domain
  try {
    const u = new URL(repoUrl.replace(GIT_SUFFIX_RE, ""));
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }
    return { host: u.origin, owner: parts[0] ?? "", repo: parts[1] ?? "" };
  } catch {
    return null;
  }
}

async function fetchGiteaIssues(
  ctx: ProviderContext
): Promise<ExternalIssue[]> {
  const parsed = parseGiteaOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitea");
  if (!token) {
    return [];
  }

  try {
    const url = `${parsed.host}/api/v1/repos/${parsed.owner}/${parsed.repo}/issues?state=all&sort=updated&type=issues&limit=50`;
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as Array<{
      number: number;
      title: string;
      body: string;
      state: string;
      html_url: string;
      updated_at: string;
    }>;

    return data.map((issue) => ({
      externalId: String(issue.number),
      title: issue.title,
      body: issue.body ?? "",
      status: issue.state,
      url: issue.html_url,
      updatedAt: issue.updated_at,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "gitea", error: msg },
      "Failed to fetch Gitea issues"
    );
    return [];
  }
}

async function fetchGiteaPRs(ctx: ProviderContext): Promise<ExternalPR[]> {
  const parsed = parseGiteaOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitea");
  if (!token) {
    return [];
  }

  try {
    const url = `${parsed.host}/api/v1/repos/${parsed.owner}/${parsed.repo}/pulls?state=all&sort=updated&limit=50`;
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as Array<{
      number: number;
      title: string;
      head: { label: string };
      base: { label: string };
      html_url: string;
      updated_at: string;
    }>;

    return data.map((pr) => ({
      externalId: String(pr.number),
      title: pr.title,
      branch: pr.head?.label ?? "",
      baseBranch: pr.base?.label ?? "",
      url: pr.html_url,
      updatedAt: pr.updated_at,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { provider: "gitea", error: msg },
      "Failed to fetch Gitea PRs"
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// PR detail enrichment: diffs, comments, review operations
// ---------------------------------------------------------------------------

export interface PRFileDiff {
  additions: number;
  deletions: number;
  patch: string | null;
  path: string;
}

export interface PRComment {
  author: string | null;
  content: string;
  id: string;
  lineNumber: number | null;
  resolved: boolean;
  timestamp: string | null;
}

export interface PRDetail {
  author: string | null;
  comments: PRComment[];
  description: string | null;
  diffs: PRFileDiff[];
  number: number;
  status: string;
  title: string;
  updatedAt: string | null;
}

async function fetchGitHubPRDetails(
  ctx: ProviderContext,
  prNumber: number
): Promise<PRDetail | null> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return null;
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return null;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Prometheus-Issue-Sync/1.0",
  };

  try {
    const [prResp, filesResp, commentsResp] = await Promise.all([
      fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}`,
        { headers, signal: AbortSignal.timeout(15_000) }
      ),
      fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}/files?per_page=100`,
        { headers, signal: AbortSignal.timeout(15_000) }
      ),
      fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}/comments?per_page=100`,
        { headers, signal: AbortSignal.timeout(15_000) }
      ),
    ]);

    if (!prResp.ok) {
      return null;
    }

    const pr = (await prResp.json()) as {
      body: string | null;
      number: number;
      state: string;
      title: string;
      updated_at: string;
      user: { login: string } | null;
    };

    const files = filesResp.ok
      ? ((await filesResp.json()) as Array<{
          additions: number;
          deletions: number;
          filename: string;
          patch?: string;
        }>)
      : [];

    const comments = commentsResp.ok
      ? ((await commentsResp.json()) as Array<{
          body: string;
          created_at: string;
          id: number;
          line: number | null;
          user: { login: string } | null;
        }>)
      : [];

    return {
      number: pr.number,
      title: pr.title,
      description: pr.body,
      author: pr.user?.login ?? null,
      status: pr.state,
      updatedAt: pr.updated_at,
      diffs: files.map((f) => ({
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
      comments: comments.map((c) => ({
        id: String(c.id),
        author: c.user?.login ?? null,
        content: c.body,
        timestamp: c.created_at,
        lineNumber: c.line ?? null,
        resolved: false,
      })),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to fetch GitHub PR details");
    return null;
  }
}

async function fetchGitLabPRDetails(
  ctx: ProviderContext,
  mrIid: number
): Promise<PRDetail | null> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    return null;
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return null;
  }

  const encodedPath = encodeURIComponent(projectPath);
  const headers = {
    "PRIVATE-TOKEN": token,
    "User-Agent": "Prometheus-Issue-Sync/1.0",
  };

  try {
    const [mrResp, changesResp, notesResp] = await Promise.all([
      fetch(
        `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`,
        { headers, signal: AbortSignal.timeout(15_000) }
      ),
      fetch(
        `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/changes`,
        { headers, signal: AbortSignal.timeout(15_000) }
      ),
      fetch(
        `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/notes?per_page=100`,
        { headers, signal: AbortSignal.timeout(15_000) }
      ),
    ]);

    if (!mrResp.ok) {
      return null;
    }

    const mr = (await mrResp.json()) as {
      author: { username: string } | null;
      description: string | null;
      iid: number;
      state: string;
      title: string;
      updated_at: string;
    };

    const changes = changesResp.ok
      ? ((await changesResp.json()) as {
          changes: Array<{
            diff: string;
            new_path: string;
          }>;
        })
      : { changes: [] };

    const notes = notesResp.ok
      ? ((await notesResp.json()) as Array<{
          author: { username: string };
          body: string;
          created_at: string;
          id: number;
          position?: { new_line: number | null };
          resolved?: boolean;
        }>)
      : [];

    return {
      number: mr.iid,
      title: mr.title,
      description: mr.description,
      author: mr.author?.username ?? null,
      status: mr.state,
      updatedAt: mr.updated_at,
      diffs: (changes.changes ?? []).map((c) => {
        const lines = (c.diff ?? "").split("\n");
        const additions = lines.filter(
          (l) => l.startsWith("+") && !l.startsWith("+++")
        ).length;
        const deletions = lines.filter(
          (l) => l.startsWith("-") && !l.startsWith("---")
        ).length;
        return {
          path: c.new_path,
          additions,
          deletions,
          patch: c.diff ?? null,
        };
      }),
      comments: notes
        .filter(
          (n) => !(n.body.startsWith("Merged") || n.body.startsWith("Closed"))
        )
        .map((n) => ({
          id: String(n.id),
          author: n.author?.username ?? null,
          content: n.body,
          timestamp: n.created_at,
          lineNumber: n.position?.new_line ?? null,
          resolved: n.resolved ?? false,
        })),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to fetch GitLab MR details");
    return null;
  }
}

export async function fetchPRDetails(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  prNumber: number
): Promise<PRDetail | null> {
  const ctx: ProviderContext = { db, orgId, repoUrl };
  switch (provider) {
    case "github":
      return await fetchGitHubPRDetails(ctx, prNumber);
    case "gitlab":
      return await fetchGitLabPRDetails(ctx, prNumber);
    default:
      logger.warn(
        { provider },
        "PR detail enrichment not supported for provider"
      );
      return null;
  }
}

// ---------------------------------------------------------------------------
// PR review operations: approve, comment, request changes
// ---------------------------------------------------------------------------

export async function approveProviderPR(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  prNumber: number,
  body?: string
): Promise<PushResult> {
  const ctx: ProviderContext = { db, orgId, repoUrl };
  switch (provider) {
    case "github":
      return await approveGitHubPR(ctx, prNumber, body);
    case "gitlab":
      return await approveGitLabMR(ctx, prNumber);
    default:
      return { success: false, error: `Approve not supported for ${provider}` };
  }
}

export async function commentOnProviderPR(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  prNumber: number,
  comment: string
): Promise<PushResult> {
  const ctx: ProviderContext = { db, orgId, repoUrl };
  switch (provider) {
    case "github":
      return await commentOnGitHubPR(ctx, prNumber, comment);
    case "gitlab":
      return await commentOnGitLabMR(ctx, prNumber, comment);
    default:
      return { success: false, error: `Comment not supported for ${provider}` };
  }
}

export async function requestChangesOnProviderPR(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  prNumber: number,
  body: string
): Promise<PushResult> {
  const ctx: ProviderContext = { db, orgId, repoUrl };
  switch (provider) {
    case "github":
      return await requestChangesGitHubPR(ctx, prNumber, body);
    default:
      return {
        success: false,
        error: `Request changes not supported for ${provider}`,
      };
  }
}

async function approveGitHubPR(
  ctx: ProviderContext,
  prNumber: number,
  body?: string
): Promise<PushResult> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse GitHub repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return { success: false, error: "No GitHub token found" };
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}/reviews`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ event: "APPROVE", body: body ?? "" }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitHub API returned ${response.status}`,
      };
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function approveGitLabMR(
  ctx: ProviderContext,
  mrIid: number
): Promise<PushResult> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    return { success: false, error: "Cannot parse GitLab project URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return { success: false, error: "No GitLab token found" };
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/approve`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitLab API returned ${response.status}`,
      };
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function commentOnGitHubPR(
  ctx: ProviderContext,
  prNumber: number,
  comment: string
): Promise<PushResult> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse GitHub repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return { success: false, error: "No GitHub token found" };
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${prNumber}/comments`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ body: comment }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitHub API returned ${response.status}`,
      };
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function commentOnGitLabMR(
  ctx: ProviderContext,
  mrIid: number,
  comment: string
): Promise<PushResult> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    return { success: false, error: "Cannot parse GitLab project URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return { success: false, error: "No GitLab token found" };
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/notes`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ body: comment }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitLab API returned ${response.status}`,
      };
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function requestChangesGitHubPR(
  ctx: ProviderContext,
  prNumber: number,
  body: string
): Promise<PushResult> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse GitHub repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return { success: false, error: "No GitHub token found" };
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}/reviews`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ event: "REQUEST_CHANGES", body }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitHub API returned ${response.status}`,
      };
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// PR merge/close operations
// ---------------------------------------------------------------------------

export async function mergeProviderPR(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  prNumber: number,
  mergeMethod?: "merge" | "squash" | "rebase"
): Promise<PushResult> {
  const ctx: ProviderContext = { db, orgId, repoUrl };
  switch (provider) {
    case "github":
      return await mergeGitHubPR(ctx, prNumber, mergeMethod ?? "merge");
    case "gitlab":
      return await mergeGitLabMR(ctx, prNumber);
    default:
      return { success: false, error: `Merge not supported for ${provider}` };
  }
}

async function mergeGitHubPR(
  ctx: ProviderContext,
  prNumber: number,
  mergeMethod: string
): Promise<PushResult> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse GitHub repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return { success: false, error: "No GitHub token found" };
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}/merge`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ merge_method: mergeMethod }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        error: `GitHub API returned ${response.status}: ${body}`,
      };
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function mergeGitLabMR(
  ctx: ProviderContext,
  mrIid: number
): Promise<PushResult> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    return { success: false, error: "Cannot parse GitLab project URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return { success: false, error: "No GitLab token found" };
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/merge`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "PRIVATE-TOKEN": token,
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitLab API returned ${response.status}`,
      };
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

export async function closeProviderPR(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  prNumber: number
): Promise<PushResult> {
  const _ctx: ProviderContext = { db, orgId, repoUrl };
  switch (provider) {
    case "github": {
      const parsed = parseGitHubOwnerRepo(repoUrl);
      if (!parsed) {
        return { success: false, error: "Cannot parse repo URL" };
      }
      const token = await getProviderToken(db, orgId, "github");
      if (!token) {
        return { success: false, error: "No token" };
      }
      const resp = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ state: "closed" }),
          signal: AbortSignal.timeout(15_000),
        }
      );
      return resp.ok
        ? { success: true }
        : { success: false, error: `GitHub returned ${resp.status}` };
    }
    case "gitlab": {
      const projectPath = parseGitLabProjectPath(repoUrl);
      if (!projectPath) {
        return { success: false, error: "Cannot parse repo URL" };
      }
      const token = await getProviderToken(db, orgId, "gitlab");
      if (!token) {
        return { success: false, error: "No token" };
      }
      const encodedPath = encodeURIComponent(projectPath);
      const resp = await fetch(
        `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${prNumber}`,
        {
          method: "PUT",
          headers: {
            "PRIVATE-TOKEN": token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ state_event: "close" }),
          signal: AbortSignal.timeout(15_000),
        }
      );
      return resp.ok
        ? { success: true }
        : { success: false, error: `GitLab returned ${resp.status}` };
    }
    default:
      return { success: false, error: `Close not supported for ${provider}` };
  }
}

// ---------------------------------------------------------------------------
// PR creation
// ---------------------------------------------------------------------------

export interface CreatePRInput {
  baseBranch: string;
  body?: string;
  headBranch: string;
  title: string;
}

export interface CreatePRResult {
  error?: string;
  number?: number;
  success: boolean;
  url?: string;
}

export async function createProviderPR(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  input: CreatePRInput
): Promise<CreatePRResult> {
  switch (provider) {
    case "github":
      return await createGitHubPR({ db, orgId, repoUrl }, input);
    case "gitlab":
      return await createGitLabMR({ db, orgId, repoUrl }, input);
    default:
      return {
        success: false,
        error: `PR creation not supported for ${provider}`,
      };
  }
}

async function createGitHubPR(
  ctx: ProviderContext,
  input: CreatePRInput
): Promise<CreatePRResult> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse GitHub repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return { success: false, error: "No GitHub token found" };
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({
        title: input.title,
        head: input.headBranch,
        base: input.baseBranch,
        body: input.body ?? "",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        error: `GitHub API returned ${response.status}: ${body}`,
      };
    }

    const data = (await response.json()) as {
      html_url: string;
      number: number;
    };
    return { success: true, number: data.number, url: data.html_url };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function createGitLabMR(
  ctx: ProviderContext,
  input: CreatePRInput
): Promise<CreatePRResult> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    return { success: false, error: "Cannot parse GitLab project URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return { success: false, error: "No GitLab token found" };
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({
        title: input.title,
        source_branch: input.headBranch,
        target_branch: input.baseBranch,
        description: input.body ?? "",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        error: `GitLab API returned ${response.status}: ${body}`,
      };
    }

    const data = (await response.json()) as { iid: number; web_url: string };
    return { success: true, number: data.iid, url: data.web_url };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// CI run fetching
// ---------------------------------------------------------------------------

export interface CIRun {
  conclusion: string | null;
  name: string;
  runId: string;
  startedAt: string;
  status: string;
  url: string;
}

export async function fetchProviderCIRuns(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string
): Promise<CIRun[]> {
  switch (provider) {
    case "github":
      return await fetchGitHubCIRuns({ db, orgId, repoUrl });
    case "gitlab":
      return await fetchGitLabCIRuns({ db, orgId, repoUrl });
    default:
      return [];
  }
}

async function fetchGitHubCIRuns(ctx: ProviderContext): Promise<CIRun[]> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return [];
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/actions/runs?per_page=30`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      workflow_runs: Array<{
        conclusion: string | null;
        html_url: string;
        id: number;
        name: string;
        run_started_at: string;
        status: string;
      }>;
    };

    return (data.workflow_runs ?? []).map((run) => ({
      runId: String(run.id),
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      startedAt: run.run_started_at,
      url: run.html_url,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to fetch GitHub CI runs");
    return [];
  }
}

function mapGitLabPipelineConclusion(status: string): string | null {
  if (status === "success") {
    return "success";
  }
  if (status === "failed") {
    return "failure";
  }
  return null;
}

async function fetchGitLabCIRuns(ctx: ProviderContext): Promise<CIRun[]> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    return [];
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return [];
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/pipelines?per_page=30&order_by=updated_at&sort=desc`;
    const response = await fetch(url, {
      headers: { "PRIVATE-TOKEN": token },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as Array<{
      created_at: string;
      id: number;
      ref: string;
      status: string;
      web_url: string;
    }>;

    return data.map((pipeline) => ({
      runId: String(pipeline.id),
      name: `Pipeline #${pipeline.id} (${pipeline.ref})`,
      status: pipeline.status,
      conclusion: mapGitLabPipelineConclusion(pipeline.status),
      startedAt: pipeline.created_at,
      url: pipeline.web_url,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to fetch GitLab CI pipelines");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write operations: Push status, comments, and PR links back to providers
// ---------------------------------------------------------------------------

export interface PushResult {
  error?: string;
  success: boolean;
}

// --- GitHub write operations ---

async function pushGitHubStatusUpdate(
  ctx: ProviderContext,
  issueNumber: string,
  status: string
): Promise<PushResult> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse GitHub repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return { success: false, error: "No GitHub token found" };
  }

  try {
    // GitHub issues have "open" or "closed" states
    const state = status === "closed" || status === "done" ? "closed" : "open";
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${issueNumber}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ state }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitHub API returned ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function pushGitHubComment(
  ctx: ProviderContext,
  issueNumber: string,
  comment: string
): Promise<PushResult> {
  const parsed = parseGitHubOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse GitHub repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "github");
  if (!token) {
    return { success: false, error: "No GitHub token found" };
  }

  try {
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${issueNumber}/comments`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ body: comment }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitHub API returned ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

// --- GitLab write operations ---

async function pushGitLabStatusUpdate(
  ctx: ProviderContext,
  issueIid: string,
  status: string
): Promise<PushResult> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    return { success: false, error: "Cannot parse GitLab project URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return { success: false, error: "No GitLab token found" };
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const stateEvent =
      status === "closed" || status === "done" ? "close" : "reopen";
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/issues/${issueIid}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ state_event: stateEvent }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitLab API returned ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function pushGitLabComment(
  ctx: ProviderContext,
  issueIid: string,
  comment: string
): Promise<PushResult> {
  const projectPath = parseGitLabProjectPath(ctx.repoUrl);
  if (!projectPath) {
    return { success: false, error: "Cannot parse GitLab project URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "gitlab");
  if (!token) {
    return { success: false, error: "No GitLab token found" };
  }

  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `https://gitlab.com/api/v4/projects/${encodedPath}/issues/${issueIid}/notes`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ body: comment }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitLab API returned ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

// --- Bitbucket write operations ---

const BITBUCKET_REPO_RE = /bitbucket\.org[/:]([^/]+)\/([^/.]+)/;

function parseBitbucketOwnerRepo(
  repoUrl: string
): { owner: string; repo: string } | null {
  const match = BITBUCKET_REPO_RE.exec(repoUrl);
  const owner = match?.[1];
  const repo = match?.[2];
  if (!(owner && repo)) {
    return null;
  }
  return { owner, repo };
}

async function pushBitbucketComment(
  ctx: ProviderContext,
  issueId: string,
  comment: string
): Promise<PushResult> {
  const parsed = parseBitbucketOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse Bitbucket repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "bitbucket");
  if (!token) {
    return { success: false, error: "No Bitbucket token found" };
  }

  try {
    const url = `https://api.bitbucket.org/2.0/repositories/${parsed.owner}/${parsed.repo}/issues/${issueId}/comments`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ content: { raw: comment } }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Bitbucket API returned ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function pushBitbucketStatusUpdate(
  ctx: ProviderContext,
  issueId: string,
  status: string
): Promise<PushResult> {
  const parsed = parseBitbucketOwnerRepo(ctx.repoUrl);
  if (!parsed) {
    return { success: false, error: "Cannot parse Bitbucket repo URL" };
  }

  const token = await getProviderToken(ctx.db, ctx.orgId, "bitbucket");
  if (!token) {
    return { success: false, error: "No Bitbucket token found" };
  }

  try {
    const bbStatus =
      status === "closed" || status === "done" ? "resolved" : "open";
    const url = `https://api.bitbucket.org/2.0/repositories/${parsed.owner}/${parsed.repo}/issues/${issueId}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Prometheus-Issue-Sync/1.0",
      },
      body: JSON.stringify({ state: bbStatus }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Bitbucket API returned ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

// --- Write operation dispatchers ---

type WriteHandler = (
  ctx: ProviderContext,
  externalId: string,
  payload: string
) => Promise<PushResult>;

const statusUpdateProviders: Record<string, WriteHandler> = {
  github: pushGitHubStatusUpdate,
  gitlab: pushGitLabStatusUpdate,
  bitbucket: pushBitbucketStatusUpdate,
};

const commentProviders: Record<string, WriteHandler> = {
  github: pushGitHubComment,
  gitlab: pushGitLabComment,
  bitbucket: pushBitbucketComment,
};

export async function pushProviderStatusUpdate(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  externalId: string,
  status: string
): Promise<PushResult> {
  const handler = statusUpdateProviders[provider];
  if (!handler) {
    logger.warn({ provider }, "Provider does not support status updates");
    return { success: false, error: `Unsupported provider: ${provider}` };
  }

  logger.info(
    { provider, externalId, status },
    "Pushing status update to provider"
  );
  return await handler({ db, orgId, repoUrl }, externalId, status);
}

export async function pushProviderComment(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  externalId: string,
  comment: string
): Promise<PushResult> {
  const handler = commentProviders[provider];
  if (!handler) {
    logger.warn({ provider }, "Provider does not support comments");
    return { success: false, error: `Unsupported provider: ${provider}` };
  }

  logger.info({ provider, externalId }, "Pushing comment to provider");
  return await handler({ db, orgId, repoUrl }, externalId, comment);
}

export async function pushProviderPRLink(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string,
  externalId: string,
  prUrl: string,
  prTitle?: string
): Promise<PushResult> {
  // PR links are posted as a comment with a formatted link
  const comment = prTitle
    ? `Prometheus created PR [${prTitle}](${prUrl}) for this issue.`
    : `Prometheus created a PR for this issue: ${prUrl}`;

  return await pushProviderComment(
    provider,
    repoUrl,
    db,
    orgId,
    externalId,
    comment
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const issueProviders: Record<
  string,
  (ctx: ProviderContext) => Promise<ExternalIssue[]>
> = {
  github: fetchGitHubIssues,
  gitlab: fetchGitLabIssues,
  jira: fetchJiraIssues,
  linear: fetchLinearIssues,
  bitbucket: fetchBitbucketIssues,
  azure_devops: fetchAzureDevOpsIssues,
  gitea: fetchGiteaIssues,
};

const prProviders: Record<
  string,
  (ctx: ProviderContext) => Promise<ExternalPR[]>
> = {
  github: fetchGitHubPRs,
  gitlab: fetchGitLabPRs,
  jira: fetchJiraPRs,
  linear: fetchLinearPRs,
  bitbucket: fetchBitbucketPRs,
  azure_devops: fetchAzureDevOpsPRs,
  gitea: fetchGiteaPRs,
};

export async function fetchProviderIssues(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string
): Promise<ExternalIssue[]> {
  const handler = issueProviders[provider];
  if (!handler) {
    logger.warn({ provider }, "Unsupported issue sync provider");
    return [];
  }

  logger.info({ provider, repoUrl }, "Fetching issues from provider");
  return await handler({ db, orgId, repoUrl });
}

export async function fetchProviderPRs(
  provider: string,
  repoUrl: string,
  db: Database,
  orgId: string
): Promise<ExternalPR[]> {
  const handler = prProviders[provider];
  if (!handler) {
    logger.warn({ provider }, "Unsupported PR sync provider");
    return [];
  }

  logger.info({ provider, repoUrl }, "Fetching PRs from provider");
  return await handler({ db, orgId, repoUrl });
}
