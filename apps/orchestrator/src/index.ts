import { serve } from "@hono/node-server";
import { createLogger } from "@prometheus/logger";
import {
  initSentry,
  initTelemetry,
  traceMiddleware,
} from "@prometheus/telemetry";
import type { AgentMode, AgentRole } from "@prometheus/types";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
} from "@prometheus/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { CheckpointManager } from "./checkpoint";
import { GovernanceEngine } from "./governance/governance-engine";
import { TrustScorer } from "./governance/trust-scorer";
import { SessionManager } from "./session-manager";
import { TakeoverManager } from "./takeover";
import { TaskRouter } from "./task-router";
import { SelfPlayTrainer } from "./training/self-play-trainer";

await initTelemetry({ serviceName: "orchestrator" });
initSentry({ serviceName: "orchestrator" });
installShutdownHandlers();

const logger = createLogger("orchestrator");

const sessionManager = new SessionManager();
const taskRouter = new TaskRouter(sessionManager);
const checkpointManager = new CheckpointManager();
const takeoverManager = new TakeoverManager();
const trustScorer = new TrustScorer();
const _governanceEngine = new GovernanceEngine(trustScorer);
const selfPlayTrainer = new SelfPlayTrainer();

const app = new Hono();

app.use("/*", cors());
app.use("/*", traceMiddleware("orchestrator"));

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

// Readiness probe — can accept traffic
app.get("/ready", (c) => c.json({ status: "ready" }));

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
    return c.json({ error: msg }, 500);
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
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
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
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
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
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
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
    return c.json({ error: msg }, 500);
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
    return c.json({ error: String(error) }, 500);
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
    return c.json({ error: String(error) }, 500);
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
    return c.json({ error: String(error) }, 500);
  }
});

// ─── Self-Play Training ──────────────────────────────────────

app.post("/training/self-play", async (c) => {
  try {
    const body = await c.req.json();
    const { action } = body as {
      action: "record" | "mine" | "recommend" | "metrics";
    };

    if (!action) {
      return c.json({ error: "'action' is required" }, 400);
    }

    switch (action) {
      case "record": {
        const {
          agentRole,
          taskDescription,
          context,
          outcome,
          qualityScore,
          actions,
          projectId,
        } = body as {
          agentRole: string;
          taskDescription: string;
          context: string;
          outcome: "success" | "failure" | "partial";
          qualityScore: number;
          actions: Array<{
            tool: string;
            args: Record<string, unknown>;
            result: string;
          }>;
          projectId: string;
        };

        if (!(agentRole && taskDescription && outcome !== undefined)) {
          return c.json(
            { error: "agentRole, taskDescription, and outcome are required" },
            400
          );
        }

        selfPlayTrainer.recordSession({
          agentRole,
          taskDescription,
          context: context ?? "",
          outcome,
          qualityScore: qualityScore ?? 0,
          actions: actions ?? [],
          projectId: projectId ?? "",
        });
        return c.json({
          status: "recorded",
          metrics: selfPlayTrainer.getMetrics(),
        });
      }

      case "mine": {
        const { agentRole, taskType } = body as {
          agentRole: string;
          taskType: string;
        };

        if (!(agentRole && taskType)) {
          return c.json({ error: "agentRole and taskType are required" }, 400);
        }

        const tree = selfPlayTrainer.minePatterns(agentRole, taskType);
        return c.json({ tree });
      }

      case "recommend": {
        const { agentRole, taskType, context } = body as {
          agentRole: string;
          taskType: string;
          context: Record<string, string>;
        };

        if (!(agentRole && taskType)) {
          return c.json({ error: "agentRole and taskType are required" }, 400);
        }

        const recommendation = selfPlayTrainer.getRecommendation(
          agentRole,
          taskType,
          context ?? {}
        );
        return c.json({ recommendation });
      }

      case "metrics": {
        return c.json({ metrics: selfPlayTrainer.getMetrics() });
      }

      default: {
        return c.json({ error: `Unknown action: ${action as string}` }, 400);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Self-play training error");
    return c.json({ error: msg }, 500);
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

// ─── Start Server ───────────────────────────────────────────────

const port = Number(process.env.ORCHESTRATOR_PORT ?? 4002);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Orchestrator engine running");
});

export { AgentLoop } from "./agent-loop";
export { BugPredictor } from "./analysis/bug-predictor";
// MOON-014: API version management
export { ApiVersionManager } from "./api-management/version-manager";
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
// MOON-003: Cross-repo refactoring
export { CrossRepoRefactor } from "./composition/cross-repo-refactor";
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
export type {
  CanaryConfig,
  CanaryRollout,
  CanaryStage,
} from "./deployment/canary-manager";
// Deployment pipeline
export { CanaryManager } from "./deployment/canary-manager";
export type { DeploymentPlan, DeployStep } from "./deployment/deploy-pipeline";
export { DeployPipeline } from "./deployment/deploy-pipeline";
export type {
  GeneratedManifest,
  ProjectConfig,
} from "./deployment/iac-generator";
export { IaCGenerator } from "./deployment/iac-generator";
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
export { MixtureOfAgents } from "./moa/parallel-generator";
// Phase 7: MoA
export { MoAVoting } from "./moa/voting";
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
export type { SprintPlan } from "./phases/planning";
export { PlanningPhase } from "./phases/planning";
export { DependencyMigrationPipeline } from "./pipelines/dependency-migration";
// MOON-008: Framework migration
export { FrameworkMigrationPipeline } from "./pipelines/framework-migration";
export { IncidentResponsePipeline } from "./pipelines/incident-response";
// MOON-009: Performance optimization
export { PerformanceOptimizationPipeline } from "./pipelines/performance-optimizer";
// P3 Moonshot: Autonomous operations
export { ProjectGenesisPipeline } from "./pipelines/project-genesis";
export { SecurityPatchingPipeline } from "./pipelines/security-patcher";
// MOON-010: Self-healing deployment
export { SelfHealingDeployment } from "./pipelines/self-healing-deploy";
export { SmartCodeReviewer } from "./pipelines/smart-reviewer";
export type { PlanNode, SchedulableTask } from "./planning/dag-decomposer";
// Planning: Sprint decomposition and DAG
export { DAGDecomposer } from "./planning/dag-decomposer";
// Phase 7: Planning
export { SeniorPlanner } from "./planning/senior-planner";
export { SessionManager } from "./session-manager";
export { TakeoverManager } from "./takeover";
export { TaskRouter } from "./task-router";
// MOON-002: Self-improving agents
export { SelfImprovingAgent } from "./training/self-improvement";
// Self-play training
export { SelfPlayTrainer } from "./training/self-play-trainer";
// MOON-048: Self-play training loop
export { SelfPlayTrainingLoop } from "./training/self-play-training-loop";
export { SharedLearningStore } from "./training/transfer-learning";
export { DeployVerifier } from "./verification/deploy-verifier";
// Verification: visual regression & deploy
export { VisualRegressionTester } from "./verification/visual-regression";
// Visual: screenshot-based verification
export { ScreenshotDiffer } from "./visual/screenshot-differ";
export { VisualVerifier } from "./visual/visual-verifier";
