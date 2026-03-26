import { serve } from "@hono/node-server";

const TERMINAL_URL_PATTERN = /^\/terminal\/([^/?]+)/;

import { internalAuthMiddleware } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import {
  initSentry,
  initTelemetry,
  metricsHandler,
  metricsMiddleware,
  traceMiddleware,
} from "@prometheus/telemetry";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
  registerShutdownHandler,
} from "@prometheus/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ContainerManager } from "./container";
import { GitOperations } from "./git-ops";
import { createHealthChecker } from "./health";
import { SandboxPool } from "./pool";
import { PoolManager } from "./pool-manager";
import { DevProvider } from "./providers/dev";
import { DockerProvider } from "./providers/docker";
import { PersistentSandboxProvider } from "./providers/persistent";
import { createPersistentRoutes } from "./routes/persistent";
import { createPreviewProxyRoute } from "./routes/preview-proxy";
import { screenshotRoute } from "./routes/screenshot";
import {
  createTerminalWsRoute,
  handleTerminalWebSocket,
} from "./routes/terminal-ws";
import { validateTimeout } from "./security";

await initTelemetry({ serviceName: "sandbox-manager" });
initSentry({ serviceName: "sandbox-manager" });
installShutdownHandlers();

const logger = createLogger("sandbox-manager");
const app = new Hono();

app.use("/*", cors());
app.use("/*", traceMiddleware("sandbox-manager"));
app.use("/*", metricsMiddleware());

// Shared-secret auth middleware for internal service-to-service calls
app.use("/*", internalAuthMiddleware());

const containerManager = new ContainerManager();
const sandboxPool = new SandboxPool(containerManager);
const gitOps = new GitOperations(containerManager);
const healthCheck = createHealthChecker(containerManager, sandboxPool);

// ---- Warm Pool Manager (provider-level pool with pre-created sandboxes) ----

const SANDBOX_POOL_SIZE = Number(process.env.SANDBOX_POOL_SIZE ?? 3);
const SANDBOX_MAX_POOL_SIZE = Number(process.env.SANDBOX_MAX_POOL_SIZE ?? 20);
const SANDBOX_IDLE_TTL_MS = Number(
  process.env.SANDBOX_IDLE_TTL_MS ?? 30 * 60 * 1000
);

const poolManager = new PoolManager({
  warmPoolSize: SANDBOX_POOL_SIZE,
  maxPoolSize: SANDBOX_MAX_POOL_SIZE,
  idleTtlMs: SANDBOX_IDLE_TTL_MS,
  affinityEnabled: process.env.SANDBOX_AFFINITY_ENABLED !== "false",
  predictiveScalingEnabled: process.env.SANDBOX_PREDICTIVE_SCALING !== "false",
});

// Register providers with the pool manager
const dockerProvider = new DockerProvider(
  process.env.SANDBOX_IMAGE ?? "node:20-slim"
);
const devProvider = new DevProvider();

poolManager.registerProvider(dockerProvider);
poolManager.registerProvider(devProvider);

// ---- Health ----

app.get("/health", async (c) => {
  if (isProcessShuttingDown()) {
    return c.json({ status: "draining" }, 503);
  }
  const health = await healthCheck();
  const statusCode = health.status === "unhealthy" ? 503 : 200;
  return c.json(health, statusCode);
});

// Liveness probe — lightweight, just confirms process is responsive
app.get("/live", (c) => c.json({ status: "ok" }));

// Readiness probe — checks Docker/sandbox availability
app.get("/ready", async (c) => {
  const checks: Record<string, boolean> = {};

  try {
    checks.docker = await containerManager.checkDockerConnectivity();
  } catch {
    checks.docker = false;
  }

  // In dev mode, Docker is not required
  const mode = containerManager.getMode();
  const allReady = mode === "dev" || Object.values(checks).every(Boolean);

  if (!allReady) {
    return c.json({ status: "not ready", checks, mode }, 503);
  }
  return c.json({ status: "ready", checks, mode });
});

// Readiness probe (alias)
app.get("/health/ready", async (c) => {
  const checks: Record<string, boolean> = {};

  try {
    checks.docker = await containerManager.checkDockerConnectivity();
  } catch {
    checks.docker = false;
  }

  const mode = containerManager.getMode();
  const allReady = mode === "dev" || Object.values(checks).every(Boolean);

  if (!allReady) {
    return c.json({ status: "not ready", checks, mode }, 503);
  }
  return c.json({ status: "ready", checks, mode });
});

// ---- Metrics ----
app.get("/metrics", metricsHandler);

// ---- Pool stats ----

app.get("/pool/stats", (c) => {
  return c.json(sandboxPool.getStats());
});

// ---- Warm Pool Manager stats ----

app.get("/pool/manager/metrics", (c) => {
  return c.json(poolManager.getMetrics());
});

app.get("/pool/manager/templates", (c) => {
  return c.json(poolManager.getTemplateStats());
});

app.get("/pool/manager/hourly-usage", (c) => {
  return c.json(poolManager.getHourlyUsagePatterns());
});

/**
 * POST /pool/manager/acquire
 * Acquire a sandbox from the warm pool manager.
 * Body: { projectId: string, cpuLimit?: number, memoryMb?: number, sessionId?: string, template?: string }
 */
app.post("/pool/manager/acquire", async (c) => {
  try {
    const body = await c.req.json<{
      projectId: string;
      cpuLimit?: number;
      memoryMb?: number;
      sessionId?: string;
      template?: "node18" | "python3.12" | "rust";
      provider?: "docker" | "firecracker" | "dev" | "gvisor" | "e2b";
    }>();

    if (!body.projectId) {
      return c.json({ error: "projectId is required" }, 400);
    }

    const instance = await poolManager.acquire(
      {
        projectId: body.projectId,
        cpuLimit: body.cpuLimit,
        memoryMb: body.memoryMb,
      },
      body.provider,
      { sessionId: body.sessionId, template: body.template }
    );

    return c.json(
      {
        id: instance.id,
        provider: instance.provider,
        status: instance.status,
        workDir: instance.workDir,
        containerId: instance.containerId,
        createdAt: instance.createdAt.toISOString(),
      },
      201
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to acquire sandbox from pool manager");
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /pool/manager/release
 * Release a sandbox back to the warm pool.
 * Body: { sandboxId: string, sessionId?: string }
 */
app.post("/pool/manager/release", async (c) => {
  try {
    const body = await c.req.json<{
      sandboxId: string;
      sessionId?: string;
    }>();

    if (!body.sandboxId) {
      return c.json({ error: "sandboxId is required" }, 400);
    }

    poolManager.release(body.sandboxId, body.sessionId);
    return c.json({ success: true, sandboxId: body.sandboxId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to release sandbox to pool manager");
    return c.json({ error: msg }, 500);
  }
});

/**
 * DELETE /pool/manager/:id
 * Destroy a sandbox via the pool manager.
 */
app.delete("/pool/manager/:id", async (c) => {
  const sandboxId = c.req.param("id");
  try {
    await poolManager.destroy(sandboxId);
    return c.json({ success: true, id: sandboxId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "Failed to destroy pooled sandbox");
    return c.json({ error: msg }, 500);
  }
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
 * Operations: clone, setupAuth, createBranch, checkout, status, add, commit, push, diff, log, currentBranch
 */
app.post("/sandbox/:id/git", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    const body = await c.req.json<{
      operation: string;
      repoUrl?: string;
      branch?: string;
      branchName?: string;
      ref?: string;
      create?: boolean;
      message?: string;
      files?: string[];
      authorName?: string;
      authorEmail?: string;
      remote?: string;
      force?: boolean;
      setUpstream?: boolean;
      staged?: boolean;
      maxCount?: number;
      depth?: number;
      token?: string;
      host?: string;
      username?: string;
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
          token: body.token,
        });
        return c.json(result);
      }

      case "setupAuth": {
        if (!body.token) {
          return c.json({ error: "token is required for setupAuth" }, 400);
        }
        const result = await gitOps.setupAuth(sandboxId, {
          token: body.token,
          host: body.host,
          username: body.username,
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

      case "checkout": {
        if (!body.ref) {
          return c.json({ error: "ref is required for checkout" }, 400);
        }
        const result = await gitOps.checkout(sandboxId, body.ref, {
          create: body.create,
        });
        return c.json(result);
      }

      case "status": {
        const result = await gitOps.status(sandboxId);
        return c.json(result);
      }

      case "add": {
        if (!body.files || body.files.length === 0) {
          return c.json({ error: "files is required for add" }, 400);
        }
        const result = await gitOps.add(sandboxId, body.files);
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
          setUpstream: body.setUpstream,
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

// ---- File Operations (REST API) ----

/**
 * POST /api/sandboxes/:id/files/read
 * Body: { path: string }
 */
app.post("/api/sandboxes/:id/files/read", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    const body = await c.req.json<{ path: string }>();

    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }

    const content = await containerManager.readFile(sandboxId, body.path);
    return c.json({ path: body.path, content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "File read failed");

    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      return c.json({ error: "File not found" }, 404);
    }
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /api/sandboxes/:id/files/write
 * Body: { path: string, content: string }
 */
app.post("/api/sandboxes/:id/files/write", async (c) => {
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
    logger.error({ sandboxId, error: msg }, "File write failed");
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /api/sandboxes/:id/files/list
 * Body: { path?: string }
 */
app.post("/api/sandboxes/:id/files/list", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    const body = await c.req
      .json<{ path?: string }>()
      .catch(() => ({ path: undefined }));
    const dirPath = body.path ?? ".";

    const files = await containerManager.listFiles(sandboxId, dirPath);
    return c.json({ path: dirPath, files });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "File list failed");

    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      return c.json({ error: "Directory not found" }, 404);
    }
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /api/sandboxes/:id/files/create
 * Body: { path: string, content?: string }
 */
app.post("/api/sandboxes/:id/files/create", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    const body = await c.req.json<{ path: string; content?: string }>();

    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }

    await containerManager.writeFile(sandboxId, body.path, body.content ?? "");
    return c.json({ success: true, path: body.path }, 201);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "File create failed");
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /api/sandboxes/:id/files/delete
 * Body: { path: string }
 */
app.post("/api/sandboxes/:id/files/delete", async (c) => {
  const sandboxId = c.req.param("id");

  try {
    const body = await c.req.json<{ path: string }>();

    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }

    await containerManager.deleteFile(sandboxId, body.path);
    return c.json({ success: true, path: body.path });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ sandboxId, error: msg }, "File delete failed");

    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      return c.json({ error: "File not found" }, 404);
    }
    return c.json({ error: msg }, 500);
  }
});

// ---- Exec (REST API alias) ----

/**
 * POST /api/sandboxes/:id/exec
 * Body: { command: string, timeout?: number }
 */
app.post("/api/sandboxes/:id/exec", async (c) => {
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

// ---- Persistent Sandbox Routes ----
const persistentProvider = new PersistentSandboxProvider(
  process.env.SANDBOX_IMAGE ?? "node:20-slim"
);
const persistentRoutes = createPersistentRoutes(persistentProvider);
app.route("/", persistentRoutes);

// ---- Screenshots (Playwright) ----
app.route("/", screenshotRoute);

// ---- Terminal WebSocket ----
const terminalWsRoute = createTerminalWsRoute(containerManager);
app.route("/", terminalWsRoute);

// ---- Preview Proxy ----
const previewProxyRoute = createPreviewProxyRoute(containerManager);
app.route("/", previewProxyRoute);

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

  // Initialize the warm pool manager (provider-level pre-created containers)
  const dockerAvailable = await DockerProvider.isAvailable().catch(() => false);
  const defaultProvider = dockerAvailable
    ? ("docker" as const)
    : ("dev" as const);

  await poolManager.initialize(defaultProvider).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { error: msg },
      "Warm pool manager initialization failed (will create sandboxes on demand)"
    );
  });

  // Start the persistent sandbox idle monitor
  persistentProvider.startIdleMonitor();

  logger.info(
    {
      warmPoolSize: SANDBOX_POOL_SIZE,
      maxPoolSize: SANDBOX_MAX_POOL_SIZE,
      defaultProvider,
    },
    "Warm pool manager ready"
  );

  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info(
      { port, mode: containerManager.getMode() },
      "Sandbox Manager running"
    );
  });

  // Handle WebSocket upgrades for the terminal endpoint
  // @hono/node-server returns a Node.js http.Server
  const httpServer = server as unknown as import("node:http").Server;
  httpServer.on("upgrade", async (req, socket, head) => {
    const url = req.url ?? "";
    const terminalMatch = url.match(TERMINAL_URL_PATTERN);
    if (!terminalMatch) {
      socket.destroy();
      return;
    }

    const sandboxId = terminalMatch[1] as string;

    try {
      const { WebSocketServer } = await import("ws");
      const wss = new WebSocketServer({ noServer: true });
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleTerminalWebSocket(ws, sandboxId, containerManager);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ error: msg }, "WebSocket upgrade failed");
      socket.destroy();
    }
  });

  // Register custom cleanup with the centralized shutdown handler
  registerShutdownHandler("sandbox-manager", async () => {
    logger.info("Shutting down...");
    await Promise.allSettled([
      sandboxPool.shutdown(),
      poolManager.shutdown(),
      persistentProvider.shutdown(),
    ]);
  });
}

start().catch((err) => {
  logger.error({ error: String(err) }, "Failed to start sandbox manager");
  process.exit(1);
});
