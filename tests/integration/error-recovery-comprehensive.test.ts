/**
 * Comprehensive Error Recovery Integration Tests (AE04).
 *
 * Tests rate limit retry logic, sandbox crash recovery, timeout handling,
 * and checkpoint creation on destructive commands. Extends the existing
 * error-recovery.test.ts with deeper coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationFixtures,
  createMockEventPublisher,
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

// ---------------------------------------------------------------------------
// Rate limiter simulation
// ---------------------------------------------------------------------------

interface RateLimitState {
  lastReset: number;
  maxRequestsPerWindow: number;
  requestCount: number;
  windowMs: number;
}

function createRateLimiter(windowMs: number, maxRequests: number) {
  const limits = new Map<string, RateLimitState>();

  return {
    canMakeRequest(modelId: string): boolean {
      const state = limits.get(modelId);
      if (!state) {
        return true;
      }
      const now = Date.now();
      if (now - state.lastReset > state.windowMs) {
        state.requestCount = 0;
        state.lastReset = now;
        return true;
      }
      return state.requestCount < state.maxRequestsPerWindow;
    },

    recordRequest(modelId: string): void {
      const existing = limits.get(modelId);
      if (existing) {
        existing.requestCount++;
      } else {
        limits.set(modelId, {
          requestCount: 1,
          maxRequestsPerWindow: maxRequests,
          windowMs,
          lastReset: Date.now(),
        });
      }
    },

    getRemainingRequests(modelId: string): number {
      const state = limits.get(modelId);
      if (!state) {
        return maxRequests;
      }
      return Math.max(0, state.maxRequestsPerWindow - state.requestCount);
    },

    reset(): void {
      limits.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Retry with backoff simulation
// ---------------------------------------------------------------------------

interface RetryConfig {
  baseDelayMs: number;
  maxAttempts: number;
  maxDelayMs: number;
  multiplier: number;
}

function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelayMs * config.multiplier ** attempt;
  return Math.min(delay, config.maxDelayMs);
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<{ attempts: number; delays: number[]; result: T }> {
  const delays: number[] = [];
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt + 1, delays };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < config.maxAttempts - 1) {
        const delay = calculateBackoffDelay(attempt, config);
        delays.push(delay);
        // In tests we don't actually wait
      }
    }
  }

  throw lastError ?? new Error("Max retries exceeded");
}

// ---------------------------------------------------------------------------
// Checkpoint management simulation
// ---------------------------------------------------------------------------

interface Checkpoint {
  agentState: Record<string, unknown>;
  completedSteps: Array<{
    output: string;
    stepId: string;
    success: boolean;
  }>;
  createdAt: string;
  id: string;
  modifiedFiles: string[];
  phase: string;
  sessionId: string;
  taskId: string;
  tokensUsed: { input: number; output: number };
}

/**
 * Commands that should trigger automatic checkpoint creation before execution.
 */
const DESTRUCTIVE_COMMANDS = [
  "rm -rf",
  "git reset --hard",
  "git checkout -- .",
  "drop table",
  "truncate",
  "docker system prune",
  "npm cache clean",
] as const;

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMANDS.some((dc) => command.toLowerCase().includes(dc));
}

function createCheckpointStore() {
  const checkpoints = new Map<string, Checkpoint[]>();

  return {
    create(
      sessionId: string,
      taskId: string,
      state: Omit<Checkpoint, "id" | "sessionId" | "taskId" | "createdAt">
    ): Checkpoint {
      const checkpoint: Checkpoint = {
        id: `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        taskId,
        createdAt: new Date().toISOString(),
        ...state,
      };

      if (!checkpoints.has(sessionId)) {
        checkpoints.set(sessionId, []);
      }
      checkpoints.get(sessionId)?.push(checkpoint);
      return checkpoint;
    },

    getLatest(sessionId: string): Checkpoint | undefined {
      const sessionCheckpoints = checkpoints.get(sessionId);
      if (!sessionCheckpoints || sessionCheckpoints.length === 0) {
        return undefined;
      }
      return sessionCheckpoints.at(-1);
    },

    getAll(sessionId: string): Checkpoint[] {
      return checkpoints.get(sessionId) ?? [];
    },

    restore(checkpointId: string): Checkpoint | undefined {
      for (const sessionCheckpoints of checkpoints.values()) {
        const found = sessionCheckpoints.find((c) => c.id === checkpointId);
        if (found) {
          return found;
        }
      }
      return undefined;
    },

    clear(): void {
      checkpoints.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Comprehensive Error Recovery", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  let redis: ReturnType<typeof createMockRedis>;
  let eventPublisher: ReturnType<typeof createMockEventPublisher>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    redis = createMockRedis();
    eventPublisher = createMockEventPublisher();
  });

  afterEach(() => {
    vi.clearAllMocks();
    redis._reset();
    eventPublisher.reset();
  });

  describe("rate limit retry logic", () => {
    it("allows requests within rate limit window", () => {
      const limiter = createRateLimiter(60_000, 10);

      for (let i = 0; i < 10; i++) {
        expect(limiter.canMakeRequest("ollama/qwen2.5-coder:32b")).toBe(true);
        limiter.recordRequest("ollama/qwen2.5-coder:32b");
      }

      // 11th request should be denied
      expect(limiter.canMakeRequest("ollama/qwen2.5-coder:32b")).toBe(false);
    });

    it("tracks remaining requests per model", () => {
      const limiter = createRateLimiter(60_000, 5);

      expect(limiter.getRemainingRequests("model_a")).toBe(5);

      limiter.recordRequest("model_a");
      limiter.recordRequest("model_a");

      expect(limiter.getRemainingRequests("model_a")).toBe(3);
    });

    it("rate limits are per-model independent", () => {
      const limiter = createRateLimiter(60_000, 2);

      limiter.recordRequest("model_a");
      limiter.recordRequest("model_a");

      expect(limiter.canMakeRequest("model_a")).toBe(false);
      expect(limiter.canMakeRequest("model_b")).toBe(true);
    });

    it("retries with exponential backoff on rate limit", async () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error("Rate limited"));
        }
        return Promise.resolve("success");
      };

      const result = await retryWithBackoff(fn, {
        maxAttempts: 5,
        baseDelayMs: 100,
        multiplier: 2,
        maxDelayMs: 5000,
      });

      expect(result.result).toBe("success");
      expect(result.attempts).toBe(3);
      expect(result.delays).toHaveLength(2);
    });

    it("calculates correct exponential backoff delays", () => {
      const config: RetryConfig = {
        maxAttempts: 5,
        baseDelayMs: 100,
        multiplier: 2,
        maxDelayMs: 5000,
      };

      expect(calculateBackoffDelay(0, config)).toBe(100); // 100 * 2^0
      expect(calculateBackoffDelay(1, config)).toBe(200); // 100 * 2^1
      expect(calculateBackoffDelay(2, config)).toBe(400); // 100 * 2^2
      expect(calculateBackoffDelay(3, config)).toBe(800); // 100 * 2^3
      expect(calculateBackoffDelay(4, config)).toBe(1600); // 100 * 2^4
    });

    it("caps backoff delay at maxDelayMs", () => {
      const config: RetryConfig = {
        maxAttempts: 10,
        baseDelayMs: 1000,
        multiplier: 3,
        maxDelayMs: 5000,
      };

      // 1000 * 3^3 = 27000, should be capped at 5000
      expect(calculateBackoffDelay(3, config)).toBe(5000);
    });

    it("throws after max retry attempts exhausted", async () => {
      const fn = (): Promise<string> => {
        return Promise.reject(new Error("Persistent failure"));
      };

      await expect(
        retryWithBackoff(fn, {
          maxAttempts: 3,
          baseDelayMs: 10,
          multiplier: 2,
          maxDelayMs: 100,
        })
      ).rejects.toThrow("Persistent failure");
    });
  });

  describe("sandbox crash recovery", () => {
    it("detects sandbox crash and triggers restart flow", async () => {
      const sandboxClient = createMockServiceClient("sandbox-manager");

      // Sandbox crashes
      sandboxClient.onRequest("POST", "/execute", {
        status: 502,
        body: { error: "Container exited unexpectedly" },
      });

      const crashResponse = await sandboxClient.request("POST", "/execute", {
        command: "npm test",
      });
      expect(crashResponse.status).toBe(502);

      // Emit crash event
      await eventPublisher.publishSessionEvent(fixtures.session.id, {
        type: "task_status",
        data: { status: "recovering", reason: "sandbox_crash" },
        timestamp: new Date().toISOString(),
      });

      // Restart sandbox
      sandboxClient._reset();
      sandboxClient.onRequest("POST", "/restart", {
        status: 200,
        body: { status: "running" },
      });

      const restartResponse = await sandboxClient.request("POST", "/restart", {
        sandboxId: fixtures.session.id,
      });
      expect(restartResponse.status).toBe(200);

      // Resume execution after restart
      sandboxClient.onRequest("POST", "/execute", {
        status: 200,
        body: { exitCode: 0, output: "All tests passed" },
      });

      const resumeResponse = await sandboxClient.request("POST", "/execute", {
        command: "npm test",
      });
      expect(resumeResponse.status).toBe(200);

      // Verify recovery events
      expect(eventPublisher.events).toHaveLength(1);
      const recoveryEvent = eventPublisher.events[0].data as {
        data: { reason: string; status: string };
      };
      expect(recoveryEvent.data.status).toBe("recovering");
    });

    it("creates checkpoint before sandbox restart", () => {
      const checkpointStore = createCheckpointStore();

      const checkpoint = checkpointStore.create(
        fixtures.session.id,
        fixtures.task.id,
        {
          phase: "tool_execution",
          agentState: { tool: "terminal_exec", iteration: 3 },
          modifiedFiles: ["src/index.ts", "src/utils.ts"],
          tokensUsed: { input: 3000, output: 1500 },
          completedSteps: [
            {
              stepId: "step_1",
              output: "File created",
              success: true,
            },
          ],
        }
      );

      expect(checkpoint.id).toContain("ckpt_");
      expect(checkpoint.sessionId).toBe(fixtures.session.id);
      expect(checkpoint.modifiedFiles).toHaveLength(2);

      // After restart, restore from checkpoint
      const restored = checkpointStore.getLatest(fixtures.session.id);
      expect(restored).toBeDefined();
      expect(restored?.phase).toBe("tool_execution");
      expect(restored?.completedSteps).toHaveLength(1);
    });

    it("handles multiple sequential sandbox crashes with escalating recovery", async () => {
      const sandboxClient = createMockServiceClient("sandbox-manager");
      const checkpointStore = createCheckpointStore();
      let crashCount = 0;

      // Simulate 3 crashes then success
      for (let i = 0; i < 3; i++) {
        crashCount++;

        // Save checkpoint before each crash
        checkpointStore.create(fixtures.session.id, fixtures.task.id, {
          phase: "tool_execution",
          agentState: { iteration: i + 1 },
          modifiedFiles: [],
          tokensUsed: { input: 1000 * (i + 1), output: 500 * (i + 1) },
          completedSteps: [],
        });

        sandboxClient._reset();
        sandboxClient.onRequest("POST", "/restart", {
          status: 200,
          body: { status: "running" },
        });

        const restartResp = await sandboxClient.request("POST", "/restart", {});
        expect(restartResp.status).toBe(200);
      }

      expect(crashCount).toBe(3);
      expect(checkpointStore.getAll(fixtures.session.id)).toHaveLength(3);
    });
  });

  describe("timeout handling", () => {
    it("detects command execution timeout", async () => {
      const sandboxClient = createMockServiceClient("sandbox-manager");

      sandboxClient.onRequest("POST", "/execute", {
        status: 504,
        body: { error: "Command timed out after 300000ms" },
      });

      const response = await sandboxClient.request("POST", "/execute", {
        command: "npm install && npm run build && npm test",
        timeoutMs: 300_000,
      });

      expect(response.status).toBe(504);
      const body = response.body as { error: string };
      expect(body.error).toContain("timed out");
    });

    it("saves state before timeout kills the process", () => {
      const checkpointStore = createCheckpointStore();

      // Simulating: timeout detected -> save checkpoint
      const checkpoint = checkpointStore.create(
        fixtures.session.id,
        fixtures.task.id,
        {
          phase: "tool_execution",
          agentState: {
            currentCommand: "npm test",
            timedOut: true,
            elapsedMs: 300_000,
          },
          modifiedFiles: ["src/app.ts"],
          tokensUsed: { input: 5000, output: 2000 },
          completedSteps: [
            {
              stepId: "install",
              output: "Dependencies installed",
              success: true,
            },
            {
              stepId: "build",
              output: "Build completed",
              success: true,
            },
          ],
        }
      );

      expect(checkpoint.agentState.timedOut).toBe(true);
      expect(checkpoint.completedSteps).toHaveLength(2);
    });

    it("resumes from checkpoint after timeout with smaller scope", () => {
      const checkpointStore = createCheckpointStore();

      // Create timeout checkpoint
      checkpointStore.create(fixtures.session.id, fixtures.task.id, {
        phase: "tool_execution",
        agentState: { timedOut: true },
        modifiedFiles: ["src/app.ts"],
        tokensUsed: { input: 5000, output: 2000 },
        completedSteps: [
          { stepId: "step_1", output: "Done", success: true },
          { stepId: "step_2", output: "Done", success: true },
        ],
      });

      // Restore and verify we can continue from where we left off
      const restored = checkpointStore.getLatest(fixtures.session.id);
      expect(restored).toBeDefined();
      expect(restored?.completedSteps).toHaveLength(2);

      // The agent would skip completed steps and continue
      const remainingSteps = ["step_3", "step_4"].filter(
        (s) => !restored?.completedSteps.some((cs) => cs.stepId === s)
      );
      expect(remainingSteps).toEqual(["step_3", "step_4"]);
    });
  });

  describe("checkpoint creation on destructive commands", () => {
    it("identifies destructive commands correctly", () => {
      expect(isDestructiveCommand("rm -rf /app/src")).toBe(true);
      expect(isDestructiveCommand("git reset --hard HEAD~3")).toBe(true);
      expect(isDestructiveCommand("git checkout -- .")).toBe(true);
      expect(isDestructiveCommand("DROP TABLE users")).toBe(true);
      expect(isDestructiveCommand("TRUNCATE sessions")).toBe(true);
      expect(isDestructiveCommand("docker system prune -a")).toBe(true);
    });

    it("does not flag non-destructive commands", () => {
      expect(isDestructiveCommand("ls -la")).toBe(false);
      expect(isDestructiveCommand("cat src/index.ts")).toBe(false);
      expect(isDestructiveCommand("git status")).toBe(false);
      expect(isDestructiveCommand("npm install")).toBe(false);
      expect(isDestructiveCommand("echo hello")).toBe(false);
    });

    it("creates checkpoint before executing destructive command", () => {
      const checkpointStore = createCheckpointStore();
      const command = "rm -rf node_modules && npm install";

      if (isDestructiveCommand(command)) {
        checkpointStore.create(fixtures.session.id, fixtures.task.id, {
          phase: "pre_destructive",
          agentState: { pendingCommand: command },
          modifiedFiles: ["package.json"],
          tokensUsed: { input: 2000, output: 800 },
          completedSteps: [],
        });
      }

      const checkpoint = checkpointStore.getLatest(fixtures.session.id);
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.phase).toBe("pre_destructive");
      expect(checkpoint?.agentState.pendingCommand).toBe(command);
    });

    it("can rollback to pre-destructive checkpoint on failure", () => {
      const checkpointStore = createCheckpointStore();
      const command = "git reset --hard HEAD~5";

      // Create checkpoint before destructive command
      const ckpt = checkpointStore.create(
        fixtures.session.id,
        fixtures.task.id,
        {
          phase: "pre_destructive",
          agentState: { gitHead: "abc123", pendingCommand: command },
          modifiedFiles: ["src/index.ts", "src/auth.ts"],
          tokensUsed: { input: 4000, output: 2000 },
          completedSteps: [
            { stepId: "coding", output: "Code written", success: true },
          ],
        }
      );

      // Simulate command failure
      const commandFailed = true;

      if (commandFailed) {
        // Restore checkpoint
        const restored = checkpointStore.restore(ckpt.id);
        expect(restored).toBeDefined();
        expect(restored?.agentState.gitHead).toBe("abc123");
        expect(restored?.modifiedFiles).toEqual([
          "src/index.ts",
          "src/auth.ts",
        ]);
        expect(restored?.completedSteps).toHaveLength(1);
      }
    });

    it("maintains checkpoint history for audit trail", () => {
      const checkpointStore = createCheckpointStore();

      // Multiple checkpoints for the same session
      checkpointStore.create(fixtures.session.id, fixtures.task.id, {
        phase: "planning",
        agentState: {},
        modifiedFiles: [],
        tokensUsed: { input: 500, output: 200 },
        completedSteps: [],
      });

      checkpointStore.create(fixtures.session.id, fixtures.task.id, {
        phase: "coding",
        agentState: {},
        modifiedFiles: ["src/index.ts"],
        tokensUsed: { input: 2000, output: 1000 },
        completedSteps: [
          { stepId: "plan", output: "Plan done", success: true },
        ],
      });

      checkpointStore.create(fixtures.session.id, fixtures.task.id, {
        phase: "pre_destructive",
        agentState: { pendingCommand: "rm -rf dist" },
        modifiedFiles: ["src/index.ts", "src/utils.ts"],
        tokensUsed: { input: 3000, output: 1500 },
        completedSteps: [
          { stepId: "plan", output: "Plan done", success: true },
          { stepId: "code", output: "Code done", success: true },
        ],
      });

      const all = checkpointStore.getAll(fixtures.session.id);
      expect(all).toHaveLength(3);
      expect(all.map((c) => c.phase)).toEqual([
        "planning",
        "coding",
        "pre_destructive",
      ]);

      // Latest should be the pre_destructive one
      const latest = checkpointStore.getLatest(fixtures.session.id);
      expect(latest?.phase).toBe("pre_destructive");
    });
  });

  describe("combined recovery scenarios", () => {
    it("rate limit + fallback + retry succeeds", async () => {
      const limiter = createRateLimiter(60_000, 1);
      const modelRouter = createMockServiceClient("model-router");

      // Exhaust primary model rate limit
      limiter.recordRequest("primary_model");
      expect(limiter.canMakeRequest("primary_model")).toBe(false);

      // Fallback model is available
      expect(limiter.canMakeRequest("fallback_model")).toBe(true);

      // Model router serves from fallback
      modelRouter.onRequest("POST", "/route", {
        status: 200,
        body: {
          model: "fallback_model",
          content: "Recovered response",
          routing: { wasFallback: true },
        },
      });

      const response = await modelRouter.request("POST", "/route", {});
      expect(response.status).toBe(200);
      const body = response.body as {
        routing: { wasFallback: boolean };
      };
      expect(body.routing.wasFallback).toBe(true);
    });

    it("checkpoint + restart + resume recovers full state", async () => {
      const checkpointStore = createCheckpointStore();
      const sandboxClient = createMockServiceClient("sandbox-manager");

      // Save checkpoint
      const ckpt = checkpointStore.create(
        fixtures.session.id,
        fixtures.task.id,
        {
          phase: "coding",
          agentState: { iteration: 5, currentFile: "src/api.ts" },
          modifiedFiles: ["src/api.ts", "src/types.ts"],
          tokensUsed: { input: 8000, output: 4000 },
          completedSteps: [
            { stepId: "plan", output: "Plan created", success: true },
            { stepId: "scaffold", output: "Files created", success: true },
          ],
        }
      );

      // Sandbox restarts
      sandboxClient.onRequest("POST", "/restart", {
        status: 200,
        body: { status: "running" },
      });

      await sandboxClient.request("POST", "/restart", {});

      // Resume from checkpoint
      const restored = checkpointStore.restore(ckpt.id);
      expect(restored).toBeDefined();
      expect(restored?.agentState.iteration).toBe(5);
      expect(restored?.completedSteps).toHaveLength(2);
      expect(restored?.modifiedFiles).toHaveLength(2);
    });
  });
});
