import type { AuthContext } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import { oauthTokens, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:v1:integrations");

interface V1Env {
  Variables: {
    apiKeyAuth: AuthContext;
    apiKeyId: string;
    db: Database;
    orgId: string;
    userId: string;
  };
}

const integrationsV1 = new Hono<V1Env>();

// GET /api/v1/integrations - List connected integrations
integrationsV1.get("/", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");

  const tokens = await db.query.oauthTokens.findMany({
    where: eq(oauthTokens.orgId, orgId),
    columns: {
      id: true,
      provider: true,
      scopes: true,
      createdAt: true,
    },
  });

  return c.json({
    integrations: tokens.map((t) => ({
      id: t.id,
      provider: t.provider,
      scopes: t.scopes,
      connectedAt: t.createdAt?.toISOString(),
    })),
  });
});

// GET /api/v1/integrations/repos - List repos from connected git provider
integrationsV1.get("/repos", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");

  const provider = c.req.query("provider") ?? "github";
  const page = Number(c.req.query("page") ?? "1");
  const perPage = Math.min(Number(c.req.query("per_page") ?? "30"), 100);

  // Find the OAuth token for this provider
  const token = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.orgId, orgId),
      eq(oauthTokens.provider, provider)
    ),
  });

  if (!token) {
    return c.json(
      {
        error: "Not Found",
        message: `No ${provider} integration connected. Connect it first via the integrations page.`,
      },
      404
    );
  }

  // Fetch repos from the provider
  try {
    if (provider === "github") {
      const res = await fetch(
        `https://api.github.com/user/repos?sort=updated&per_page=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error");
        logger.warn({ status: res.status, text }, "GitHub API request failed");
        return c.json(
          {
            error: "Provider Error",
            message: `GitHub API error: ${res.status}`,
          },
          502
        );
      }

      const repos = (await res.json()) as Array<{
        clone_url: string;
        default_branch: string;
        description: string | null;
        full_name: string;
        html_url: string;
        id: number;
        language: string | null;
        name: string;
        owner: { login: string };
        private: boolean;
        updated_at: string;
      }>;

      return c.json({
        repos: repos.map((r) => ({
          id: String(r.id),
          name: r.name,
          fullName: r.full_name,
          description: r.description,
          cloneUrl: r.clone_url,
          htmlUrl: r.html_url,
          defaultBranch: r.default_branch,
          language: r.language,
          isPrivate: r.private,
          owner: r.owner.login,
          updatedAt: r.updated_at,
        })),
        page,
        perPage,
      });
    }

    if (provider === "gitlab") {
      const res = await fetch(
        `https://gitlab.com/api/v4/projects?membership=true&order_by=updated_at&per_page=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
        }
      );

      if (!res.ok) {
        return c.json(
          {
            error: "Provider Error",
            message: `GitLab API error: ${res.status}`,
          },
          502
        );
      }

      const repos = (await res.json()) as Array<{
        default_branch: string;
        description: string | null;
        http_url_to_repo: string;
        id: number;
        name: string;
        path_with_namespace: string;
        visibility: string;
        web_url: string;
      }>;

      return c.json({
        repos: repos.map((r) => ({
          id: String(r.id),
          name: r.name,
          fullName: r.path_with_namespace,
          description: r.description,
          cloneUrl: r.http_url_to_repo,
          htmlUrl: r.web_url,
          defaultBranch: r.default_branch,
          language: null,
          isPrivate: r.visibility !== "public",
          owner: r.path_with_namespace.split("/")[0] ?? "",
          updatedAt: null,
        })),
        page,
        perPage,
      });
    }

    return c.json(
      {
        error: "Bad Request",
        message: `Unsupported provider: ${provider}. Use "github" or "gitlab".`,
      },
      400
    );
  } catch (err) {
    logger.error(
      { error: String(err), provider },
      "Failed to fetch repos from provider"
    );
    return c.json(
      {
        error: "Internal Error",
        message: "Failed to communicate with provider",
      },
      500
    );
  }
});

// POST /api/v1/integrations/import - Import a repo as a project
integrationsV1.post("/import", async (c) => {
  const _auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<{
    cloneUrl: string;
    defaultBranch?: string;
    description?: string;
    name: string;
    provider?: string;
  }>();

  if (!(body.name && body.cloneUrl)) {
    return c.json(
      {
        error: "Bad Request",
        message: "name and cloneUrl are required",
      },
      400
    );
  }

  const projectId = generateId("proj");
  const [project] = await db
    .insert(projects)
    .values({
      id: projectId,
      orgId,
      name: body.name,
      description: body.description ?? null,
      repoUrl: body.cloneUrl,
      status: "active",
    })
    .returning();

  logger.info(
    { projectId, orgId, repoUrl: body.cloneUrl },
    "Project imported via REST API v1"
  );

  return c.json(
    {
      id: project?.id ?? projectId,
      name: body.name,
      repoUrl: body.cloneUrl,
      status: "active",
      createdAt: project?.createdAt?.toISOString() ?? new Date().toISOString(),
    },
    201
  );
});

export { integrationsV1 };
