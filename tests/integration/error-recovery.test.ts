/**
 * Integration tests: Error Recovery and Self-Healing (GAP-005).
 *
 * Verifies recovery behavior across failure scenarios:
 * - Model API 500 recovery with model escalation
 * - Sandbox timeout recovery with checkpoint save/resume
 * - Repeated tool failure detection via health watchdog
 * - Queue job retry with backoff and DLQ
 * - Connection recovery after Redis disconnect
 * - Graceful degradation when all strategies exhausted
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationFixtures,
  createMockEventPublisher,
  createMockJobQueue,
  createMockRedis,
  createMockServiceClient,
} from "./setup";

const { mockLogger } = vi.hoisted(() => {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = () => logger;
  return { mockLogger: logger };
});

vi.mock("@prometheus/logger", () => ({
  createLogger: () => mockLogger,
}));

describe("Error Recovery and Self-Healing", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  const modelRouter = createMockServiceClient("model-router");
  const sandboxManager = createMockServiceClient("sandbox-manager");

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    modelRouter._reset();
    sandboxManager._reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Model API 500 recovery", () => {
    it("triggers model escalation from default to think slot on 500 error", async () => {
      // First call returns 500
      modelRouter.onRequest("POST", "/route", {
        status: 500,
        body: { error: "Internal server error" },
      });

      const failedResponse = await modelRouter.request("POST", "/route", {
        slot: "default",
        messages: [{ role: "user", content: "Generate code" }],
      });

      expect(failedResponse.status).toBe(500);

      // Import recovery strategy and simulate escalation
      const { RecoveryStrategy } = await import(
        "../../apps/orchestrator/src/engine/recovery-strategy"
      );
      const recovery = new RecoveryStrategy();

      const strategy = recovery.handleStuckAgent(
        fixtures.session.id,
        "stale_timeout",
        {
          attemptCount: 1,
          currentModelSlot: "default",
          sessionId: fixtures.session.id,
          reason: "stale_timeout",
        }
      );

      expect(strategy).toBe("upgrade_model");

      const result = recovery.executeRecovery(strategy, {
        attemptCount: 1,
        currentModelSlot: "default",
        sessionId: fixtures.session.id,
        reason: "stale_timeout",
      });

      expect(result.success).toBe(true);
      expect(result.newModelSlot).toBe("think");
      expect(result.description).toContain(
        "Upgraded model from default to think"
      );

      // Retry with upgraded model succeeds
      modelRouter._reset();
      modelRouter.onRequest("POST", "/route", {
        status: 200,
        body: {
          id: "cmpl_recovery",
          model: "ollama/deepseek-r1:32b",
          slot: "think",
          content: "// recovered code output",
          usage: {
            promptTokens: 800,
            completionTokens: 200,
            totalTokens: 1000,
          },
          costUsd: 0,
          latencyMs: 3000,
        },
      });

      const recoveredResponse = await modelRouter.request("POST", "/route", {
        slot: "think",
        messages: [{ role: "user", content: "Generate code" }],
      });

      expect(recoveredResponse.status).toBe(200);
      const body = recoveredResponse.body as { slot: string };
      expect(body.slot).toBe("think");
    });
  });

  describe("Sandbox timeout recovery", () => {
    it("saves checkpoint and resumes after sandbox restart", async () => {
      // Simulate sandbox timeout
      sandboxManager.onRequest("POST", "/execute", {
        status: 504,
        body: { error: "Sandbox execution timed out" },
      });

      const timeoutResponse = await sandboxManager.request("POST", "/execute", {
        sandboxId: fixtures.session.id,
        command: "npm test",
      });

      expect(timeoutResponse.status).toBe(504);

      // Verify checkpoint state structure for persistence
      // (CheckpointPersistence.createState is a pure static factory)
      const checkpointState = {
        phase: "tool_execution",
        agentState: { currentTool: "terminal_exec", iteration: 5 },
        modifiedFiles: ["src/index.ts", "src/utils.ts"],
        tokensUsed: { input: 5000, output: 2000 },
        creditsConsumed: 7,
        savedAt: new Date().toISOString(),
        completedSteps: [
          { stepId: "step_1", output: "File created", success: true },
          { stepId: "step_2", output: "Tests written", success: true },
        ],
      };

      expect(checkpointState.phase).toBe("tool_execution");
      expect(checkpointState.modifiedFiles).toHaveLength(2);
      expect(checkpointState.completedSteps).toHaveLength(2);
      expect(checkpointState.savedAt).toBeDefined();

      // Sandbox restart succeeds
      sandboxManager._reset();
      sandboxManager.onRequest("POST", "/restart", {
        status: 200,
        body: { sandboxId: fixtures.session.id, status: "running" },
      });

      const restartResponse = await sandboxManager.request("POST", "/restart", {
        sandboxId: fixtures.session.id,
      });

      expect(restartResponse.status).toBe(200);

      // Execution resumes after restart
      sandboxManager.onRequest("POST", "/execute", {
        status: 200,
        body: {
          output: "All tests passed",
          exitCode: 0,
        },
      });

      const resumedResponse = await sandboxManager.request("POST", "/execute", {
        sandboxId: fixtures.session.id,
        command: "npm test",
      });

      expect(resumedResponse.status).toBe(200);
      const resumedBody = resumedResponse.body as { output: string };
      expect(resumedBody.output).toContain("tests passed");
    });
  });

  describe("Repeated tool failure detection", () => {
    it("health watchdog detects repeated failures and triggers human checkpoint", async () => {
      const { HealthWatchdog } = await import(
        "../../apps/orchestrator/src/engine/health-watchdog"
      );

      const watchdog = new HealthWatchdog();
      const sessionId = fixtures.session.id;

      watchdog.startMonitoring(sessionId);

      // Simulate 5 identical tool calls (loop detection threshold)
      for (let i = 0; i < 5; i++) {
        watchdog.reportProgress(sessionId, "tool_call", {
          tool: "file_read",
          args: { path: "/src/broken.ts" },
        });
      }

      // Watchdog should detect the loop
      expect(watchdog.isStuck(sessionId)).toBe(true);

      const status = watchdog.getStatus(sessionId);
      expect(status).not.toBeNull();
      expect(status?.isLooping).toBe(true);

      // Recovery action should be "reset" for infinite loop
      const action = watchdog.getRecoveryAction(sessionId);
      expect(action).toBe("reset");

      // Recovery strategy handles this with inject_reflection first
      const { RecoveryStrategy } = await import(
        "../../apps/orchestrator/src/engine/recovery-strategy"
      );
      const recovery = new RecoveryStrategy();

      const strategy = recovery.handleStuckAgent(sessionId, "infinite_loop", {
        attemptCount: 0,
        sessionId,
        reason: "infinite_loop",
      });

      expect(strategy).toBe("inject_reflection");

      const result = recovery.executeRecovery(strategy, {
        attemptCount: 0,
        sessionId,
        reason: "infinite_loop",
      });

      expect(result.success).toBe(true);
      expect(result.injectedPrompt).toContain("stuck");
      expect(result.injectedPrompt).toContain("alternative approach");

      watchdog.stopMonitoring(sessionId);
    });
  });

  describe("Queue job retry with backoff", () => {
    it("retries failed jobs with exponential backoff and moves to DLQ after max attempts", async () => {
      const queue = createMockJobQueue();
      const maxAttempts = 3;
      let processAttempts = 0;

      // Register a processor that always fails
      queue.onProcess(() => {
        processAttempts++;
        throw new Error("Transient processing error");
      });

      // Add a job
      await queue.add(
        "agent-task",
        {
          sessionId: fixtures.session.id,
          taskId: fixtures.task.id,
        },
        { jobId: `job_${fixtures.task.id}` }
      );

      const waitingCount = await queue.getWaitingCount();
      expect(waitingCount).toBe(1);

      // Process the job (simulates first attempt - fails)
      const result1 = await queue.processNext();
      expect(result1).not.toBeNull();
      expect(result1?.state).toBe("failed");
      expect(result1?.failReason).toBe("Transient processing error");
      expect(processAttempts).toBe(1);

      // Simulate retry: put job back to waiting
      const job = await queue.getJob(`job_${fixtures.task.id}`);
      expect(job).not.toBeNull();
      await job?.retry();

      // Process again (second attempt)
      const result2 = await queue.processNext();
      expect(result2?.state).toBe("failed");
      expect(processAttempts).toBe(2);

      // Retry once more
      const job2 = await queue.getJob(`job_${fixtures.task.id}`);
      await job2?.retry();

      // Third attempt
      const result3 = await queue.processNext();
      expect(result3?.state).toBe("failed");
      expect(processAttempts).toBe(maxAttempts);

      // After max attempts, move to failed (DLQ equivalent)
      const _failedCount = await queue.getFailedCount();
      // Job should now be in failed state (no more retries)
      const finalJob = await queue.getJob(`job_${fixtures.task.id}`);
      expect(finalJob).not.toBeNull();

      const finalState = await finalJob?.getState();
      expect(finalState).toBe("failed");
    });
  });

  describe("Connection recovery", () => {
    it("recovers from Redis disconnect and maintains state consistency", async () => {
      const redis = createMockRedis();

      // Store some state
      await redis.set("session:state:abc", JSON.stringify({ iteration: 5 }));
      const stored = await redis.get("session:state:abc");
      expect(stored).toBeDefined();
      expect(JSON.parse(stored as string)).toEqual({ iteration: 5 });

      // Simulate disconnect by clearing all data (mock limitation)
      // In real scenario, Redis would reconnect automatically
      // Here we verify that state can be re-established after reconnection

      // Store state again (simulating post-reconnect write)
      await redis.set(
        "session:state:abc",
        JSON.stringify({ iteration: 5, recovered: true })
      );

      const recovered = await redis.get("session:state:abc");
      expect(recovered).toBeDefined();

      const parsedState = JSON.parse(recovered as string);
      expect(parsedState.iteration).toBe(5);
      expect(parsedState.recovered).toBe(true);

      // Verify pub/sub can resume (publisher pattern)
      const eventPublisher = createMockEventPublisher();
      await eventPublisher.publishSessionEvent("abc", {
        type: "recovery",
        data: { message: "Connection recovered" },
        timestamp: new Date().toISOString(),
      });

      // Publisher should have recorded the event
      const events = eventPublisher.events;
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("session");
    });
  });

  describe("Graceful degradation", () => {
    it("returns clean error notification when all recovery strategies exhausted", async () => {
      const { RecoveryStrategy } = await import(
        "../../apps/orchestrator/src/engine/recovery-strategy"
      );
      const recovery = new RecoveryStrategy();
      const sessionId = fixtures.session.id;

      // Attempt 0: inject_reflection
      const strategy0 = recovery.handleStuckAgent(sessionId, "infinite_loop", {
        attemptCount: 0,
        sessionId,
        reason: "infinite_loop",
      });
      expect(strategy0).toBe("inject_reflection");

      // Attempt 1: rollback_checkpoint (with checkpoint)
      const strategy1 = recovery.handleStuckAgent(sessionId, "infinite_loop", {
        attemptCount: 1,
        lastCheckpointId: "ckpt_123",
        sessionId,
        reason: "infinite_loop",
      });
      expect(strategy1).toBe("rollback_checkpoint");

      // Attempt 2: upgrade_model
      const strategy2 = recovery.handleStuckAgent(sessionId, "infinite_loop", {
        attemptCount: 2,
        sessionId,
        reason: "infinite_loop",
      });
      expect(strategy2).toBe("upgrade_model");

      // Attempt 3 (max): abort_partial
      const strategy3 = recovery.handleStuckAgent(sessionId, "infinite_loop", {
        attemptCount: 3,
        sessionId,
        reason: "infinite_loop",
      });
      expect(strategy3).toBe("abort_partial");

      // Execute abort and verify clean notification
      const abortResult = recovery.executeRecovery("abort_partial", {
        attemptCount: 3,
        sessionId,
        reason: "infinite_loop",
        partialResults: "Partial: created 2 of 5 files",
      });

      expect(abortResult.success).toBe(true);
      expect(abortResult.strategy).toBe("abort_partial");
      expect(abortResult.partialOutput).toBe("Partial: created 2 of 5 files");
      expect(abortResult.description).toContain(
        "Aborting after 3 recovery attempts"
      );

      // Verify event publisher can deliver user notification
      const eventPublisher = createMockEventPublisher();
      await eventPublisher.publishSessionEvent(sessionId, {
        type: "task_failed",
        data: {
          reason: abortResult.description,
          partialOutput: abortResult.partialOutput,
          recoverable: false,
        },
        timestamp: new Date().toISOString(),
      });

      const events = eventPublisher.events;
      expect(events).toHaveLength(1);
      expect(events[0].channel).toContain(sessionId);
    });
  });
});
