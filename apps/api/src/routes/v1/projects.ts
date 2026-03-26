import type { AuthContext } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import { projectMembers, projectSettings, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { indexingQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:v1:projects");

interface V1Env {
  Variables: {
    apiKeyAuth: AuthContext;
    apiKeyId: string;
    db: Database;
    orgId: string;
    userId: string;
  };
}

const projectsV1 = new Hono<V1Env>();

// GET /api/v1/projects - List projects
projectsV1.get("/", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");

  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 100);
  const offset = Number(c.req.query("offset") ?? "0");
  const status = c.req.query("status");

  const conditions = [eq(projects.orgId, orgId)];
  if (status) {
    conditions.push(
      eq(projects.status, status as "active" | "archived" | "setup")
    );
  }

  const results = await db.query.projects.findMany({
    where: and(...conditions),
    orderBy: [desc(projects.createdAt)],
    limit: limit + 1,
    offset,
  });

  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  return c.json({
    projects: items.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      repoUrl: p.repoUrl,
      techStackPreset: p.techStackPreset,
      status: p.status,
      createdAt: p.createdAt?.toISOString(),
      updatedAt: p.updatedAt?.toISOString(),
    })),
    hasMore,
  });
});

// POST /api/v1/projects - Create project
projectsV1.post("/", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<{
    description?: string;
    name: string;
    repoUrl?: string;
    techStackPreset?: string;
  }>();

  if (!body.name) {
    return c.json({ error: "Bad Request", message: "name is required" }, 400);
  }

  const id = generateId("proj");
  const [project] = await db
    .insert(projects)
    .values({
      id,
      orgId,
      name: body.name,
      description: body.description ?? null,
      repoUrl: body.repoUrl ?? null,
      techStackPreset: body.techStackPreset ?? null,
      status: "setup",
    })
    .returning();

  // Create default settings
  await db.insert(projectSettings).values({ projectId: id });

  // Add creator as owner
  await db.insert(projectMembers).values({
    id: generateId("pm"),
    projectId: id,
    userId: auth.userId,
    role: "owner",
  });

  // If a repo URL was provided, enqueue an indexing job
  if (body.repoUrl) {
    await indexingQueue.add(
      "index-project",
      {
        projectId: id,
        orgId,
        filePaths: [],
        fullReindex: true,
        triggeredBy: "manual",
      },
      { jobId: `index-${id}-init` }
    );
    logger.info(
      { projectId: id, repoUrl: body.repoUrl },
      "Repo clone/index job enqueued"
    );
  }

  logger.info({ projectId: id, orgId }, "Project created via REST API v1");

  return c.json(
    {
      id: project?.id ?? id,
      name: body.name,
      description: body.description ?? null,
      repoUrl: body.repoUrl ?? null,
      techStackPreset: body.techStackPreset ?? null,
      status: "setup",
      createdAt: project?.createdAt?.toISOString() ?? new Date().toISOString(),
    },
    201
  );
});

// GET /api/v1/projects/:id - Get project details
projectsV1.get("/:id", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const projectId = c.req.param("id");

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
    with: { settings: true, members: true },
  });

  if (!project) {
    return c.json({ error: "Not Found", message: "Project not found" }, 404);
  }

  return c.json({
    id: project.id,
    name: project.name,
    description: project.description,
    repoUrl: project.repoUrl,
    techStackPreset: project.techStackPreset,
    status: project.status,
    createdAt: project.createdAt?.toISOString(),
    updatedAt: project.updatedAt?.toISOString(),
    settings: project.settings,
    members: project.members?.map((m) => ({
      userId: m.userId,
      role: m.role,
    })),
  });
});

// POST /api/v1/projects/:id/import - Import/re-import from repo
projectsV1.post("/:id/import", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const projectId = c.req.param("id");

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
    columns: { id: true, repoUrl: true },
  });

  if (!project) {
    return c.json({ error: "Not Found", message: "Project not found" }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    repoUrl?: string;
    fullReindex?: boolean;
  };

  // If a new repoUrl is provided, update the project
  if (body.repoUrl) {
    await db
      .update(projects)
      .set({ repoUrl: body.repoUrl, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  const repoUrl = body.repoUrl ?? project.repoUrl;
  if (!repoUrl) {
    return c.json(
      {
        error: "Bad Request",
        message:
          "Project has no repo URL. Provide repoUrl in the request body.",
      },
      400
    );
  }

  await indexingQueue.add(
    "index-project",
    {
      projectId,
      orgId,
      filePaths: [],
      fullReindex: body.fullReindex ?? true,
      triggeredBy: "manual",
    },
    { jobId: `index-${projectId}-${Date.now()}` }
  );

  logger.info(
    { projectId, repoUrl },
    "Project import triggered via REST API v1"
  );

  return c.json({
    id: projectId,
    message: "Import job queued",
    repoUrl,
  });
});

export { projectsV1 };
