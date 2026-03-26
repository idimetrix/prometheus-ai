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
};

const prProviders: Record<
  string,
  (ctx: ProviderContext) => Promise<ExternalPR[]>
> = {
  github: fetchGitHubPRs,
  gitlab: fetchGitLabPRs,
  jira: fetchJiraPRs,
  linear: fetchLinearPRs,
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
