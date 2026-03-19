import { serve } from "@hono/node-server";
import { createLogger } from "@prometheus/logger";
import { initSentry, initTelemetry } from "@prometheus/telemetry";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ContainerManager } from "./container";
import { GitOperations } from "./git-ops";
import { createHealthChecker } from "./health";
import { SandboxPool } from "./pool";
import { screenshotRoute } from "./routes/screenshot";
import { validateTimeout } from "./security";

await initTelemetry({ serviceName: "sandbox-manager" });
initSentry({ serviceName: "sandbox-manager" });

const logger = createLogger("sandbox-manager");
const app = new Hono();

app.use("/*", cors());

const containerManager = new ContainerManager();
const sandboxPool = new SandboxPool(containerManager);
const gitOps = new GitOperations(containerManager);
const healthCheck = createHealthChecker(containerManager, sandboxPool);

// ---- Health ----

app.get("/health", async (c) => {
  const health = await healthCheck();
  const statusCode = health.status === "unhealthy" ? 503 : 200;
  return c.json(health, statusCode);
});

// Liveness probe — lightweight, just confirms process is responsive
app.get("/live", (c) => c.json({ status: "ok" }));

// Readiness probe — can accept traffic
app.get("/ready", (c) => c.json({ status: "ready" }));

// ---- Pool stats ----

app.get("/pool/stats", (c) => {
  return c.json(sandboxPool.getStats());
});

// ---- Sandbox CRUD ----

/**
 * POST /sandbox/create
 * Body: { projectId: string, repoUrl?: string, branch?: string, cpuLimit?: number, memoryLimitMb?: number }
 */
app.post("/sandbox/create", async (c) => {
  try {
    const body = await c.req.json<{
      projectId: string;
      repoUrl?: string;
      branch?: string;
      cpuLimit?: number;
      memoryLimitMb?: number;
    }>();

    if (!body.projectId) {
      return c.json({ error: "projectId is required" }, 400);
    }

    const sandbox = await sandboxPool.acquire(body.projectId);

    // If a repo URL is provided, clone it into the sandbox
    if (body.repoUrl) {
      const cloneResult = await gitOps.clone(sandbox.id, {
        repoUrl: body.repoUrl,
        branch: body.branch,
        depth: 1,
      });

      if (!cloneResult.success) {
        // Clean up the sandbox if clone fails
        await sandboxPool.release(sandbox.id);
        return c.json(
          { error: `Failed to clone repo: ${cloneResult.error}` },
          500
        );
      }
    }

    return c.json(
      {
        id: sandbox.id,
        status: sandbox.status,
        workspacePath: sandbox.workspacePath,
        createdAt: sandbox.createdAt.toISOString(),
      },
      201
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to create sandbox");
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /sandbox/:id/exec
 * Body: { command: string, timeout?: number }
 */
app.post("/sandbox/:id/exec", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    const body = await c.req.json<{ command: string; timeout?: number }>();

    if (!body.command) {
      return c.json({ error: "command is required" }, 400);
    }

    const timeoutMs = body.timeout ?? 60_000;
    const timeoutCheck = validateTimeout(timeoutMs);
    if (!timeoutCheck.valid) {
      return c.json(
        {
          error: `Timeout exceeds maximum (300s). Clamped to ${timeoutCheck.timeout}ms`,
        },
        400
      );
    }

    const result = await containerManager.exec(
      sandboxId,
      body.command,
      timeoutCheck.timeout
    );

    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "Exec failed");
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /sandbox/:id/write
 * Body: { path: string, content: string }
 */
app.post("/sandbox/:id/write", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    const body = await c.req.json<{ path: string; content: string }>();

    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }
    if (typeof body.content !== "string") {
      return c.json({ error: "content must be a string" }, 400);
    }

    await containerManager.writeFile(sandboxId, body.path, body.content);

    return c.json({ success: true, path: body.path });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "Write file failed");
    return c.json({ error: msg }, 500);
  }
});

/**
 * GET /sandbox/:id/read?path=...
 */
app.get("/sandbox/:id/read", async (c) => {
  const sandboxId = c.req.param("id");
  const filePath = c.req.query("path");

  if (!filePath) {
    return c.json({ error: "path query parameter is required" }, 400);
  }

  try {
    const content = await containerManager.readFile(sandboxId, filePath);
    return c.json({ path: filePath, content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, filePath, error: msg }, "Read file failed");

    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      return c.json({ error: "File not found" }, 404);
    }
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /sandbox/:id/git
 * Body: { operation: string, ...params }
 * Operations: clone, createBranch, commit, push, diff, log, currentBranch
 */
app.post("/sandbox/:id/git", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    const body = await c.req.json<{
      operation: string;
      repoUrl?: string;
      branch?: string;
      branchName?: string;
      message?: string;
      files?: string[];
      authorName?: string;
      authorEmail?: string;
      remote?: string;
      force?: boolean;
      staged?: boolean;
      maxCount?: number;
      depth?: number;
    }>();

    if (!body.operation) {
      return c.json({ error: "operation is required" }, 400);
    }

    switch (body.operation) {
      case "clone": {
        if (!body.repoUrl) {
          return c.json({ error: "repoUrl is required for clone" }, 400);
        }
        const result = await gitOps.clone(sandboxId, {
          repoUrl: body.repoUrl,
          branch: body.branch,
          depth: body.depth,
        });
        return c.json(result);
      }

      case "createBranch": {
        if (!body.branchName) {
          return c.json(
            { error: "branchName is required for createBranch" },
            400
          );
        }
        const result = await gitOps.createBranch(sandboxId, body.branchName);
        return c.json(result);
      }

      case "commit": {
        if (!body.message) {
          return c.json({ error: "message is required for commit" }, 400);
        }
        const result = await gitOps.commit(sandboxId, {
          message: body.message,
          files: body.files,
          authorName: body.authorName,
          authorEmail: body.authorEmail,
        });
        return c.json(result);
      }

      case "push": {
        const result = await gitOps.push(sandboxId, {
          remote: body.remote,
          force: body.force,
        });
        return c.json(result);
      }

      case "diff": {
        const result = await gitOps.diff(sandboxId, { staged: body.staged });
        return c.json(result);
      }

      case "log": {
        const result = await gitOps.log(sandboxId, body.maxCount);
        return c.json({ commits: result });
      }

      case "currentBranch": {
        const branch = await gitOps.getCurrentBranch(sandboxId);
        return c.json({ branch });
      }

      default:
        return c.json(
          { error: `Unknown git operation: ${body.operation}` },
          400
        );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "Git operation failed");
    return c.json({ error: msg }, 500);
  }
});

/**
 * DELETE /sandbox/:id
 */
app.delete("/sandbox/:id", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    await sandboxPool.destroy(sandboxId);
    return c.json({ success: true, id: sandboxId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "Failed to destroy sandbox");
    return c.json({ error: msg }, 500);
  }
});

/**
 * GET /sandbox/:id - Get sandbox status
 */
app.get("/sandbox/:id", (c) => {
  const sandboxId = c.req.param("id");
  const info = containerManager.getContainerInfo(sandboxId);

  if (!info) {
    return c.json({ error: "Sandbox not found" }, 404);
  }

  return c.json({
    id: info.id,
    status: info.status,
    projectId: info.projectId,
    workspacePath: info.workspacePath,
    createdAt: info.createdAt.toISOString(),
    lastUsedAt: info.lastUsedAt.toISOString(),
  });
});

// ---- Screenshots (Playwright) ----
app.route("/", screenshotRoute);

// ---- Startup ----

const port = Number(process.env.SANDBOX_MANAGER_PORT ?? 4006);

async function start() {
  // Initialize the sandbox pool (pre-warm sandboxes)
  await sandboxPool.initialize().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { error: msg },
      "Pool initialization failed (will create sandboxes on demand)"
    );
  });

  serve({ fetch: app.fetch, port }, () => {
    logger.info(
      { port, mode: containerManager.getMode() },
      "Sandbox Manager running"
    );
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await sandboxPool.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  logger.error({ error: String(err) }, "Failed to start sandbox manager");
  process.exit(1);
});
