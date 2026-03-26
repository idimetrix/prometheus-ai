import { serve } from "@hono/node-server";
import { internalAuthMiddleware } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import {
  createServiceMetrics,
  initSentry,
  initTelemetry,
  metricsMiddleware,
  traceMiddleware,
} from "@prometheus/telemetry";
import type { AgentMode, AgentRole } from "@prometheus/types";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
  registerShutdownHandler,
} from "@prometheus/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { CheckpointManager } from "./checkpoint";
import { GovernanceEngine } from "./governance/governance-engine";
import { TrustScorer } from "./governance/trust-scorer";
import { SessionManager } from "./session-manager";
import { TakeoverManager } from "./takeover";
import { TaskRouter } from "./task-router";

await initTelemetry({ serviceName: "orchestrator" });
initSentry({ serviceName: "orchestrator" });
installShutdownHandlers();

const serviceMetrics = createServiceMetrics("orchestrator");

const logger = createLogger("orchestrator");

const sessionManager = new SessionManager();
const taskRouter = new TaskRouter(sessionManager);
const checkpointManager = new CheckpointManager();
const takeoverManager = new TakeoverManager();
const trustScorer = new TrustScorer();

// Initialize trust scorer persistence via Redis
try {
  const { redis } = await import("@prometheus/queue");
  trustScorer.setPersistence({
    get: (key: string) => redis.get(key),
    set: (key: string, value: string) =>
      redis.set(key, value).then(() => undefined),
  });
  await trustScorer.loadFromPersistence();
} catch {
  logger.warn(
    "Redis unavailable for trust score persistence — using in-memory only"
  );
}

const _governanceEngine = new GovernanceEngine(trustScorer);

const app = new Hono();

app.use("/*", cors());
app.use("/*", traceMiddleware("orchestrator"));
app.use("/*", metricsMiddleware());

// Shared-secret auth middleware for internal service-to-service calls
app.use("/*", internalAuthMiddleware());

// Record request latency and errors via service metrics
app.use("/*", async (c, next) => {
  const start = performance.now();
  await next();
  const durationSec = (performance.now() - start) / 1000;
  const status = String(c.res.status);

  serviceMetrics.api.requestLatencySeconds
    .labels({ router: "http", method: c.req.method, status })
    .observe(durationSec);

  if (c.res.status >= 500) {
    serviceMetrics.generic.errorRate
      .labels({ error_type: "http_5xx", severity: "error" })
      .inc();
  }
});

// ─── Health Check ────────────────────────────────────────────────

app.get("/health", async (c) => {
  if (isProcessShuttingDown()) {
    return c.json({ status: "draining" }, 503);
  }

  const dependencies: Record<string, string> = {};

  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    dependencies.db = "ok";
  } catch {
    dependencies.db = "unavailable";
  }

  try {
    const { createRedisConnection } = await import("@prometheus/queue");
    const redis = createRedisConnection();
    await redis.ping();
    await redis.quit();
    dependencies.redis = "ok";
  } catch {
    dependencies.redis = "unavailable";
  }

  const allHealthy = Object.values(dependencies).every((v) => v === "ok");

  return c.json({
    status: allHealthy ? "ok" : "degraded",
    service: "orchestrator",
    version: process.env.APP_VERSION ?? "0.0.0",
    uptime: process.uptime(),
    activeSessions: sessionManager.getActiveSessionCount(),
    timestamp: new Date().toISOString(),
    dependencies,
  });
});

// Liveness probe — lightweight, just confirms process is responsive
app.get("/live", (c) => c.json({ status: "ok" }));

// Readiness probe — checks all dependencies are connected
app.get("/ready", async (c) => {
  const checks: Record<string, boolean> = {};

  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  try {
    const { createRedisConnection } = await import("@prometheus/queue");
    const r = createRedisConnection();
    await r.ping();
    await r.quit();
    checks.redis = true;
  } catch {
    checks.redis = false;
  }

  try {
    const modelRouterUrl =
      process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
    const resp = await fetch(`${modelRouterUrl}/live`, {
      signal: AbortSignal.timeout(3000),
    });
    checks.modelRouter = resp.ok;
  } catch {
    checks.modelRouter = false;
  }

  const allReady = Object.values(checks).every(Boolean);

  if (!allReady) {
    return c.json({ status: "not ready", checks }, 503);
  }
  return c.json({ status: "ready", checks });
});

// Readiness probe (alias)
app.get("/health/ready", async (c) => {
  const checks: Record<string, boolean> = {};

  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  try {
    const { createRedisConnection } = await import("@prometheus/queue");
    const r = createRedisConnection();
    await r.ping();
    await r.quit();
    checks.redis = true;
  } catch {
    checks.redis = false;
  }

  try {
    const modelRouterUrl =
      process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
    const resp = await fetch(`${modelRouterUrl}/live`, {
      signal: AbortSignal.timeout(3000),
    });
    checks.modelRouter = resp.ok;
  } catch {
    checks.modelRouter = false;
  }

  const allReady = Object.values(checks).every(Boolean);

  if (!allReady) {
    return c.json({ status: "not ready", checks }, 503);
  }
  return c.json({ status: "ready", checks });
});

// ─── Process Task (called by queue worker) ──────────────────────

app.post("/process", async (c) => {
  try {
    const body = await c.req.json();

    const {
      taskId,
      sessionId,
      projectId,
      orgId,
      userId,
      title,
      description,
      mode,
      agentRole,
    } = body as {
      taskId: string;
      sessionId: string;
      projectId: string;
      orgId: string;
      userId: string;
      title: string;
      description: string | null;
      mode: AgentMode;
      agentRole: AgentRole | null;
    };

    if (
      !(taskId && sessionId && projectId && orgId && userId && title && mode)
    ) {
      return c.json(
        {
          error:
            "Missing required fields: taskId, sessionId, projectId, orgId, userId, title, mode",
        },
        400
      );
    }

    logger.info({ taskId, sessionId, mode, agentRole }, "Processing task");

    const result = await taskRouter.processTask({
      taskId,
      sessionId,
      projectId,
      orgId,
      userId,
      title,
      description: description ?? null,
      mode,
      agentRole: agentRole ?? null,
    });

    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to process task");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Task Execute (alternative entry point) ─────────────────────
// Provides a task-centric API for the queue worker and external callers

app.post("/tasks/execute", async (c) => {
  try {
    const body = await c.req.json();

    const {
      taskId,
      sessionId,
      projectId,
      orgId,
      userId,
      title,
      description,
      mode,
      agentRole,
    } = body as {
      taskId: string;
      sessionId: string;
      projectId: string;
      orgId: string;
      userId: string;
      title: string;
      description: string | null;
      mode: AgentMode;
      agentRole: AgentRole | null;
    };

    if (
      !(taskId && sessionId && projectId && orgId && userId && title && mode)
    ) {
      return c.json(
        {
          error:
            "Missing required fields: taskId, sessionId, projectId, orgId, userId, title, mode",
        },
        400
      );
    }

    logger.info(
      { taskId, sessionId, mode, agentRole },
      "Executing task via /tasks/execute"
    );

    const result = await taskRouter.processTask({
      taskId,
      sessionId,
      projectId,
      orgId,
      userId,
      title,
      description: description ?? null,
      mode,
      agentRole: agentRole ?? null,
    });

    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to execute task");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Task Status ────────────────────────────────────────────────

app.get("/tasks/:id/status", async (c) => {
  const taskId = c.req.param("id");

  try {
    const { db, tasks } = await import("@prometheus/db");
    const { eq } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const task = rows[0];

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Try to find the associated session for live agent info
    const session = sessionManager.getSession(task.sessionId);
    const loopStatus = session?.agentLoop.getStatus() ?? null;
    const creditsConsumed = session?.agentLoop.getCreditsConsumed() ?? 0;

    return c.json({
      taskId: task.id,
      sessionId: task.sessionId,
      status: task.status,
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      creditsConsumed: task.creditsConsumed ?? creditsConsumed,
      loopStatus,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg, taskId }, "Failed to get task status");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Task Cancel ────────────────────────────────────────────────

app.post("/tasks/cancel", async (c) => {
  try {
    const body = await c.req.json();
    const { taskId, sessionId } = body as {
      taskId: string;
      sessionId?: string;
    };

    if (!taskId) {
      return c.json({ error: "'taskId' is required" }, 400);
    }

    // Look up the session for this task
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const { db, tasks } = await import("@prometheus/db");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({ sessionId: tasks.sessionId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
      targetSessionId = rows[0]?.sessionId;
    }

    if (!targetSessionId) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Cancel the session's agent loop
    const session = sessionManager.getSession(targetSessionId);
    if (session) {
      await sessionManager.cancelSession(targetSessionId);
    }

    // Mark task as cancelled in DB
    const { db, tasks } = await import("@prometheus/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(tasks)
      .set({
        status: "cancelled",
        completedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    logger.info({ taskId, sessionId: targetSessionId }, "Task cancelled");

    return c.json({
      status: "cancelled",
      taskId,
      sessionId: targetSessionId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to cancel task");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Session Status ─────────────────────────────────────────────

app.get("/sessions/:id/status", async (c) => {
  const sessionId = c.req.param("id");

  // Try in-memory first
  const status = sessionManager.getSessionStatus(sessionId);
  if (status) {
    return c.json(status);
  }

  // Try loading from DB
  const loaded = await sessionManager.loadSession(sessionId, "");
  if (loaded) {
    const loadedStatus = sessionManager.getSessionStatus(sessionId);
    return c.json(loadedStatus);
  }

  return c.json({ error: "Session not found" }, 404);
});

// ─── Pause Session ──────────────────────────────────────────────

app.post("/sessions/:id/pause", async (c) => {
  const sessionId = c.req.param("id");

  try {
    await sessionManager.pauseSession(sessionId);
    return c.json({ status: "paused", sessionId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return c.json({ error: "Session not found" }, 404);
    }
    logger.error({ error: msg }, "Failed to pause session");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Resume Session ─────────────────────────────────────────────

app.post("/sessions/:id/resume", async (c) => {
  const sessionId = c.req.param("id");

  try {
    await sessionManager.resumeSession(sessionId);
    return c.json({ status: "active", sessionId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return c.json({ error: "Session not found" }, 404);
    }
    logger.error({ error: msg }, "Failed to resume session");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Cancel Session ─────────────────────────────────────────────

app.post("/sessions/:id/cancel", async (c) => {
  const sessionId = c.req.param("id");

  try {
    await sessionManager.cancelSession(sessionId);
    return c.json({ status: "cancelled", sessionId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return c.json({ error: "Session not found" }, 404);
    }
    logger.error({ error: msg }, "Failed to cancel session");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Retry Failed Session ───────────────────────────────────────

app.post("/sessions/:id/retry", async (c) => {
  const sessionId = c.req.param("id");

  try {
    const body = await c.req.json();
    const { fromCheckpoint } = body as { fromCheckpoint?: boolean };

    await sessionManager.retrySession(sessionId, "", fromCheckpoint ?? true);
    return c.json({ status: "active", sessionId, retried: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return c.json({ error: "Session not found" }, 404);
    }
    logger.error({ error: msg }, "Failed to retry session");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── List Active Sessions ───────────────────────────────────────

app.get("/sessions", (c) => {
  const activeSessions = sessionManager.getActiveSessions().map((s) => ({
    id: s.session.id,
    projectId: s.session.projectId,
    userId: s.session.userId,
    status: s.session.status,
    mode: s.session.mode,
    startedAt: s.startedAt.toISOString(),
    activeAgentCount: s.activeAgents.size,
  }));

  return c.json({ sessions: activeSessions, count: activeSessions.length });
});

// ─── Route Task (dry run) ───────────────────────────────────────

app.post("/route", async (c) => {
  try {
    const body = await c.req.json();
    const { description, projectContext } = body as {
      description: string;
      projectContext?: string;
    };

    if (!description) {
      return c.json({ error: "'description' is required" }, 400);
    }

    const routing = taskRouter.routeTask(description, projectContext);
    return c.json(routing);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to route task");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Checkpoint Response ────────────────────────────────────────

app.post("/checkpoints/:id/respond", async (c) => {
  const checkpointId = c.req.param("id");

  try {
    const body = await c.req.json();
    const { action, data, message, userId } = body as {
      action: "approve" | "reject" | "modify" | "input";
      data?: Record<string, unknown>;
      message?: string;
      userId: string;
    };

    const resolved = checkpointManager.respondToCheckpoint(checkpointId, {
      action,
      data,
      message,
      respondedBy: userId,
      respondedAt: new Date(),
    });

    if (!resolved) {
      return c.json({ error: "Checkpoint not found or already resolved" }, 404);
    }

    return c.json({ status: "resolved", checkpointId });
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to respond to checkpoint");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Pending Checkpoints ────────────────────────────────────────

app.get("/sessions/:id/checkpoints", (c) => {
  const sessionId = c.req.param("id");
  const checkpoints = checkpointManager.getPendingCheckpoints(sessionId);
  return c.json({ checkpoints });
});

// ─── Takeover Controls ──────────────────────────────────────────

app.post("/sessions/:id/takeover", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const { userId } = body as { userId: string };

  try {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    await session.agentLoop.pause();
    await takeoverManager.takeover(sessionId, userId);

    return c.json({ status: "human_control", sessionId });
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to takeover session");
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/sessions/:id/release", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const { userId, context } = body as { userId: string; context?: string };

  try {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    await takeoverManager.release(sessionId, userId, context);
    await session.agentLoop.resume();

    return c.json({ status: "agent_control", sessionId });
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to release session");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Meta-Learning Stats (AI08) ──────────────────────────────

import { sharedMetaLearner } from "./agent-loop";

app.get("/meta-learning/stats", (c) => {
  return c.json(sharedMetaLearner.getStats());
});

app.get("/meta-learning/patterns", (c) => {
  return c.json({ patterns: sharedMetaLearner.getPatterns() });
});

app.post("/meta-learning/extract", (c) => {
  const patterns = sharedMetaLearner.extractPatterns();
  const adjustments = sharedMetaLearner.generateAdjustments();
  return c.json({ patterns, adjustments });
});

// ─── Self-Play Training (AI04) ────────────────────────────────

import { TrainingRunner } from "./training/training-runner";

const trainingRunner = new TrainingRunner();

app.post("/training/self-play", async (c) => {
  try {
    if (trainingRunner.isRunning()) {
      return c.json({ error: "Training run already in progress" }, 409);
    }

    const body = await c.req.json();
    const { projectId, orgId, agentRoles, taskTypes, maxRoundsPerRole } =
      body as {
        projectId: string;
        orgId: string;
        agentRoles?: string[];
        taskTypes?: string[];
        maxRoundsPerRole?: number;
      };

    if (!(projectId && orgId)) {
      return c.json({ error: "projectId and orgId are required" }, 400);
    }

    const defaultRoles = [
      "backend_coder",
      "frontend_coder",
      "test_engineer",
      "ci_loop",
    ];

    const result = trainingRunner.runSelfPlay({
      projectId,
      orgId,
      agentRoles: agentRoles ?? defaultRoles,
      taskTypes,
      maxRoundsPerRole,
    });

    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Self-play training failed");
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/training/metrics", (c) => {
  return c.json(trainingRunner.getMetrics());
});

app.post("/training/recommend", async (c) => {
  try {
    const body = await c.req.json();
    const { agentRole, taskType, context } = body as {
      agentRole: string;
      taskType: string;
      context?: Record<string, string>;
    };

    if (!(agentRole && taskType)) {
      return c.json({ error: "agentRole and taskType are required" }, 400);
    }

    const recommendation = trainingRunner.getRecommendation(
      agentRole,
      taskType,
      context ?? {}
    );

    return c.json({ recommendation });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Training recommendation failed");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Benchmark Endpoints (SWE-bench) ────────────────────────

app.post("/benchmark/run", async (c) => {
  try {
    const body = await c.req.json();
    const { filePath, commitHash } = body as {
      filePath: string;
      commitHash?: string;
    };

    if (!filePath) {
      return c.json({ error: "'filePath' is required" }, 400);
    }

    const { loadFromFile } = await import("./benchmarks/swe-bench");
    const { SWEBenchRunner } = await import("./benchmarks/swe-bench-runner");

    const sweTasks = await loadFromFile(filePath);
    const instances = sweTasks.map((t) => ({
      instanceId: t.instance_id,
      repo: t.repo,
      baseCommit: t.base_commit,
      problemStatement: t.problem_statement,
      goldPatch: t.patch,
      testPatch: t.test_patch,
    }));

    const runner = new SWEBenchRunner();
    const report = await runner.runBenchmark(instances, commitHash ?? "HEAD");

    return c.json(report);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Benchmark run failed");
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/benchmark/suite", async (c) => {
  try {
    const body = await c.req.json();
    const { caseIds, commitHash } = body as {
      caseIds: string[];
      commitHash?: string;
    };

    if (!caseIds?.length) {
      return c.json({ error: "'caseIds' is required" }, 400);
    }

    const { SWEBenchRunner } = await import("./benchmarks/swe-bench-runner");
    const runner = new SWEBenchRunner();
    const report = await runner.runSuite(caseIds, commitHash ?? "HEAD");

    return c.json(report);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Benchmark suite failed");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Prometheus Metrics ──────────────────────────────────────

app.get("/metrics", async (c) => {
  const { metricsRegistry, metrics } = await import("@prometheus/telemetry");
  metrics.activeSessions.set({}, sessionManager.getActiveSessionCount());
  return c.text(await metricsRegistry.render(), 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
});

// ─── Graceful Shutdown ───────────────────────────────────────────

registerShutdownHandler("orchestrator", async () => {
  logger.info("Orchestrator shutting down...");

  // Cancel all active sessions so agents stop processing
  const activeSessions = sessionManager.getActiveSessions();
  for (const s of activeSessions) {
    try {
      await sessionManager.cancelSession(s.session.id);
    } catch {
      // Best-effort cancellation
    }
  }
  logger.info(
    { cancelledSessions: activeSessions.length },
    "Active sessions cancelled"
  );

  logger.info("Orchestrator shutdown complete");
});

// ─── Start Server ───────────────────────────────────────────────

const port = Number(process.env.ORCHESTRATOR_PORT ?? 4002);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Orchestrator engine running");
});

export { AgentLoop, sharedMetaLearner } from "./agent-loop";
export {
  BlueprintEnforcer as OrchestratorBlueprintEnforcer,
  type BlueprintViolation as OrcBlueprintViolation,
} from "./blueprint-enforcer";
export { CheckpointManager } from "./checkpoint";
// Phase 7: CI-Loop enhancements
export { FiveWhyDebugger } from "./ci-loop/five-why-debugger";
export { FuzzTesting } from "./ci-loop/fuzz-testing";
export { LivingRequirementsTracker } from "./ci-loop/living-requirements";
export { PropertyTesting } from "./ci-loop/property-testing";
export { SystemicAnalyzer } from "./ci-loop/systemic-analyzer";
// Phase 9 exports
export {
  type ConfidenceResult,
  ConfidenceScorer,
  type IterationSignals,
} from "./confidence";
export { ContextManager } from "./context-manager";
// Phase 7: Session continuity
export { SessionMemory } from "./continuity/session-memory";
export { CreditTracker } from "./credit-tracker";
// Phase 2: Decision logging
export { DecisionLogger } from "./decision-logger";
export {
  createExecutionContext,
  type ExecutionContext,
  ExecutionEngine,
  type ExecutionEvent,
  type ExecutionOptions,
} from "./engine";
export { FleetManager } from "./fleet-manager";
export { GovernanceEngine } from "./governance/governance-engine";
export { TrustScorer } from "./governance/trust-scorer";
// Phase 7: Guardian
export { BusinessLogicGuardian } from "./guardian/business-logic-guardian";
// Phase 7: Meta-learning
export {
  type LearnedPattern,
  MetaLearner,
  type MetaLearnerStats,
  type RoleAdjustment,
  type SessionOutcome,
} from "./meta-learning/meta-learner";
export { CodeVoter } from "./moa/code-voter";
export { MixtureOfAgents } from "./moa/parallel-generator";
// Phase 7: MoA
export { MoADecisionGate, MoAVoting } from "./moa/voting";
// Phase 2: Mode handlers
export { getModeHandler } from "./modes";
export type { ModeHandler, ModeHandlerParams, ModeResult } from "./modes/types";
// Phase 2: Patterns
export { AmbiguityResolver } from "./patterns/ambiguity-resolver";
export { GeneratorEvaluator } from "./patterns/generator-evaluator";
export { SpecFirst } from "./patterns/spec-first";
export { AuditPhase } from "./phases/audit";
export { IntegrationPhase } from "./phases/integration";
// Phase 7: Pipeline phases
export { PhaseGate } from "./phases/phase-gate";
// MCTS Planning
export { MCTSPlanner } from "./planning/mcts-planner";
// Phase 7: Planning
export { SeniorPlanner } from "./planning/senior-planner";
export { SessionManager } from "./session-manager";
export { TakeoverManager } from "./takeover";
export { TaskRouter } from "./task-router";
// Phase: Self-play training
export {
  type TrainingRunConfig,
  TrainingRunner,
  type TrainingRunResult,
} from "./training/training-runner";
export { ScreenshotComparator } from "./verification/screenshot-comparator";
// Visual regression & verification
export { VisualRegressionTester } from "./verification/visual-regression";
export { ScreenshotDiffer } from "./visual/screenshot-differ";
