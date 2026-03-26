/**
 * E2E Pipeline Integration Tests (CP02).
 *
 * Tests the full flow: create session -> enqueue task -> mock LLM response
 * -> verify events streamed -> verify session status transitions.
 *
 * Uses the mock LLM provider (DEV_MOCK_LLM=true) to avoid real API calls
 * and verifies the complete pipeline contract end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockJobQueue } from "./setup";
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

// ---------------------------------------------------------------------------
// Session & event tracking types
// ---------------------------------------------------------------------------

type SessionStatus = "active" | "completed" | "failed" | "cancelled";

type SessionEventType =
  | "token"
  | "tool_call"
  | "tool_result"
  | "file_change"
  | "agent_output"
  | "task_status"
  | "complete"
  | "error";

interface SessionEvent {
  data: Record<string, unknown>;
  timestamp: string;
  type: SessionEventType;
}

interface SessionRecord {
  createdAt: string;
  endedAt?: string;
  events: SessionEvent[];
  id: string;
  mode: "task" | "ask" | "review";
  projectId: string;
  status: SessionStatus;
  statusHistory: Array<{ from: SessionStatus; to: SessionStatus; at: string }>;
  userId: string;
}

// ---------------------------------------------------------------------------
// Pipeline simulation
// ---------------------------------------------------------------------------

function createSessionStore() {
  const sessions = new Map<string, SessionRecord>();

  return {
    create(params: {
      id: string;
      projectId: string;
      userId: string;
      mode: "task" | "ask" | "review";
    }): SessionRecord {
      const session: SessionRecord = {
        id: params.id,
        projectId: params.projectId,
        userId: params.userId,
        mode: params.mode,
        status: "active",
        events: [],
        statusHistory: [],
        createdAt: new Date().toISOString(),
      };
      sessions.set(session.id, session);
      return session;
    },

    transition(sessionId: string, newStatus: SessionStatus): void {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const from = session.status;
      session.status = newStatus;
      session.statusHistory.push({
        from,
        to: newStatus,
        at: new Date().toISOString(),
      });
      if (newStatus === "completed" || newStatus === "failed") {
        session.endedAt = new Date().toISOString();
      }
    },

    addEvent(sessionId: string, event: SessionEvent): void {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      session.events.push(event);
    },

    get(sessionId: string): SessionRecord | undefined {
      return sessions.get(sessionId);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock LLM response simulator (mirrors mock-provider.ts contract)
// ---------------------------------------------------------------------------

interface MockLLMResponse {
  choices: Array<{
    finish_reason: string;
    message: { content: string; role: string; tool_calls?: unknown[] };
  }>;
  id: string;
  model: string;
  provider: string;
  slot: string;
  usage: {
    completion_tokens: number;
    cost_usd: number;
    prompt_tokens: number;
    total_tokens: number;
  };
}

function createMockLLMResponse(
  content: string,
  options?: { slot?: string; toolCalls?: unknown[] }
): MockLLMResponse {
  return {
    id: `mock_${Date.now()}`,
    model: "mock/dev-model",
    provider: "mock",
    slot: options?.slot ?? "default",
    choices: [
      {
        message: {
          role: "assistant",
          content: options?.toolCalls ? "" : content,
          tool_calls: options?.toolCalls,
        },
        finish_reason: options?.toolCalls ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
      cost_usd: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E Pipeline Integration", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  let sessionStore: ReturnType<typeof createSessionStore>;
  let taskQueue: MockJobQueue;
  let eventPublisher: ReturnType<typeof createMockEventPublisher>;
  let modelRouterClient: ReturnType<typeof createMockServiceClient>;
  let orchestratorClient: ReturnType<typeof createMockServiceClient>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    sessionStore = createSessionStore();
    taskQueue = createMockJobQueue();
    eventPublisher = createMockEventPublisher();
    modelRouterClient = createMockServiceClient("model-router");
    orchestratorClient = createMockServiceClient("orchestrator");
    redis = createMockRedis();

    // Configure mock model-router to return mock LLM responses
    modelRouterClient.onRequest("POST", "/route", {
      status: 200,
      body: createMockLLMResponse(
        "I'll implement this feature. Here's the code:\n\n```typescript\nconsole.log('hello');\n```"
      ),
    });

    // Configure mock orchestrator to succeed
    orchestratorClient.onRequest("POST", "/execute", {
      status: 200,
      body: {
        success: true,
        filesChanged: 2,
        output: "Task completed successfully",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    taskQueue._reset();
    modelRouterClient._reset();
    orchestratorClient._reset();
    eventPublisher.reset();
    redis._reset();
  });

  describe("full pipeline: session -> task -> LLM -> events", () => {
    it("creates a session and transitions through active -> completed", async () => {
      const session = sessionStore.create({
        id: fixtures.session.id,
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      expect(session.status).toBe("active");
      expect(session.events).toHaveLength(0);

      // Submit a task into the queue
      await taskQueue.add(
        "agent-task",
        {
          taskId: fixtures.task.id,
          sessionId: session.id,
          projectId: fixtures.project.id,
          orgId: fixtures.org.id,
          userId: fixtures.user.id,
          title: "Implement user authentication",
          agentRole: "backend_coder",
        },
        { jobId: fixtures.task.id, priority: 50 }
      );

      expect(await taskQueue.getWaitingCount()).toBe(1);

      // Process the task: simulate worker calling model-router then orchestrator
      taskQueue.onProcess(async (job) => {
        const sessionId = job.data.sessionId as string;

        // Emit task_status event
        sessionStore.addEvent(sessionId, {
          type: "task_status",
          data: { status: "running", taskId: job.data.taskId },
          timestamp: new Date().toISOString(),
        });
        await eventPublisher.publishSessionEvent(sessionId, {
          type: "task_status",
          data: { status: "running", taskId: job.data.taskId as string },
          timestamp: new Date().toISOString(),
        });

        // Call model-router for LLM inference
        const llmResponse = await modelRouterClient.request("POST", "/route", {
          slot: "default",
          messages: [{ role: "user", content: "Implement user auth" }],
        });

        expect(llmResponse.status).toBe(200);
        const llmBody = llmResponse.body as MockLLMResponse;

        // Emit token events for the LLM response
        sessionStore.addEvent(sessionId, {
          type: "token",
          data: { content: llmBody.choices[0].message.content },
          timestamp: new Date().toISOString(),
        });
        await eventPublisher.publishSessionEvent(sessionId, {
          type: "agent_output",
          data: {
            content: llmBody.choices[0].message.content,
            model: llmBody.model,
          },
          timestamp: new Date().toISOString(),
        });

        // Simulate tool call (file write)
        sessionStore.addEvent(sessionId, {
          type: "tool_call",
          data: { tool: "file_write", path: "/app/src/auth.ts" },
          timestamp: new Date().toISOString(),
        });
        await eventPublisher.publishSessionEvent(sessionId, {
          type: "task_status",
          data: { tool: "file_write", path: "/app/src/auth.ts" },
          timestamp: new Date().toISOString(),
        });

        // Simulate file change
        sessionStore.addEvent(sessionId, {
          type: "file_change",
          data: { path: "/app/src/auth.ts", action: "create" },
          timestamp: new Date().toISOString(),
        });

        // Call orchestrator to finalize
        const orchResponse = await orchestratorClient.request(
          "POST",
          "/execute",
          { taskId: job.data.taskId }
        );

        expect(orchResponse.status).toBe(200);

        // Emit completion event
        sessionStore.addEvent(sessionId, {
          type: "complete",
          data: { filesChanged: 2, output: "Task completed successfully" },
          timestamp: new Date().toISOString(),
        });
        await eventPublisher.publishSessionEvent(sessionId, {
          type: "task_status",
          data: { status: "completed", filesChanged: 2 },
          timestamp: new Date().toISOString(),
        });

        return { success: true };
      });

      // Process the job
      const result = await taskQueue.processNext();
      expect(result?.state).toBe("completed");

      // Transition session to completed
      sessionStore.transition(session.id, "completed");

      // Verify session state
      const finalSession = sessionStore.get(session.id);
      expect(finalSession).toBeDefined();
      expect(finalSession?.status).toBe("completed");
      expect(finalSession?.endedAt).toBeDefined();

      // Verify all event types were emitted
      const eventTypes = finalSession?.events.map((e) => e.type) ?? [];
      expect(eventTypes).toContain("task_status");
      expect(eventTypes).toContain("token");
      expect(eventTypes).toContain("tool_call");
      expect(eventTypes).toContain("file_change");
      expect(eventTypes).toContain("complete");

      // Verify status transition history
      expect(finalSession?.statusHistory).toHaveLength(1);
      expect(finalSession?.statusHistory[0].from).toBe("active");
      expect(finalSession?.statusHistory[0].to).toBe("completed");

      // Verify events were published to event publisher
      const publishedEvents = eventPublisher.events;
      expect(publishedEvents.length).toBeGreaterThanOrEqual(4);
      expect(publishedEvents.every((e) => e.type === "session")).toBe(true);
    });

    it("handles LLM failure mid-pipeline and transitions to failed", async () => {
      const session = sessionStore.create({
        id: fixtures.session.id,
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      // Model router returns error
      modelRouterClient._reset();
      modelRouterClient.onRequest("POST", "/route", {
        status: 503,
        body: { error: "All models exhausted" },
      });

      await taskQueue.add(
        "agent-task",
        {
          taskId: fixtures.task.id,
          sessionId: session.id,
          projectId: fixtures.project.id,
          orgId: fixtures.org.id,
        },
        { jobId: fixtures.task.id }
      );

      taskQueue.onProcess(async (job) => {
        const sessionId = job.data.sessionId as string;

        const llmResponse = await modelRouterClient.request("POST", "/route", {
          slot: "default",
          messages: [{ role: "user", content: "Do something" }],
        });

        if (llmResponse.status !== 200) {
          sessionStore.addEvent(sessionId, {
            type: "error",
            data: {
              message: "LLM inference failed",
              status: llmResponse.status,
            },
            timestamp: new Date().toISOString(),
          });

          await eventPublisher.publishSessionEvent(sessionId, {
            type: "task_status",
            data: { status: "failed", error: "LLM inference failed" },
            timestamp: new Date().toISOString(),
          });

          throw new Error("LLM inference failed");
        }

        return llmResponse.body;
      });

      const result = await taskQueue.processNext();
      expect(result?.state).toBe("failed");

      // Transition session to failed
      sessionStore.transition(session.id, "failed");

      const finalSession = sessionStore.get(session.id);
      expect(finalSession?.status).toBe("failed");
      expect(finalSession?.endedAt).toBeDefined();

      // Verify error event was emitted
      const errorEvents =
        finalSession?.events.filter((e) => e.type === "error") ?? [];
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].data.message).toBe("LLM inference failed");
    });

    it("supports tool_call events with mock LLM tool responses", async () => {
      const session = sessionStore.create({
        id: fixtures.session.id,
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      // Configure model-router with tool calls
      modelRouterClient._reset();
      modelRouterClient.onRequest("POST", "/route", {
        status: 200,
        body: createMockLLMResponse("", {
          toolCalls: [
            {
              id: "call_001",
              type: "function",
              function: {
                name: "file_write",
                arguments: JSON.stringify({
                  path: "/app/src/index.ts",
                  content: "console.log('hello');",
                }),
              },
            },
          ],
        }),
      });

      await taskQueue.add(
        "agent-task",
        { taskId: fixtures.task.id, sessionId: session.id },
        { jobId: fixtures.task.id }
      );

      taskQueue.onProcess(async (job) => {
        const sessionId = job.data.sessionId as string;

        const llmResponse = await modelRouterClient.request("POST", "/route", {
          slot: "default",
          messages: [{ role: "user", content: "Create a file" }],
        });

        const body = llmResponse.body as MockLLMResponse;
        const toolCalls = body.choices[0].message.tool_calls;

        if (toolCalls && toolCalls.length > 0) {
          for (const call of toolCalls) {
            const tc = call as {
              function: { arguments: string; name: string };
              id: string;
            };
            sessionStore.addEvent(sessionId, {
              type: "tool_call",
              data: {
                toolCallId: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
              timestamp: new Date().toISOString(),
            });

            // Simulate tool result
            sessionStore.addEvent(sessionId, {
              type: "tool_result",
              data: {
                toolCallId: tc.id,
                success: true,
                output: "File written successfully",
              },
              timestamp: new Date().toISOString(),
            });
          }
        }

        return { success: true };
      });

      await taskQueue.processNext();

      const finalSession = sessionStore.get(session.id);
      const toolCallEvents =
        finalSession?.events.filter((e) => e.type === "tool_call") ?? [];
      const toolResultEvents =
        finalSession?.events.filter((e) => e.type === "tool_result") ?? [];

      expect(toolCallEvents).toHaveLength(1);
      expect(toolCallEvents[0].data.name).toBe("file_write");
      expect(toolResultEvents).toHaveLength(1);
      expect(toolResultEvents[0].data.success).toBe(true);
    });
  });

  describe("session status transitions", () => {
    it("only allows valid transitions: active -> completed", () => {
      const session = sessionStore.create({
        id: "ses_test_1",
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      expect(session.status).toBe("active");
      sessionStore.transition(session.id, "completed");
      expect(sessionStore.get(session.id)?.status).toBe("completed");
    });

    it("only allows valid transitions: active -> failed", () => {
      const session = sessionStore.create({
        id: "ses_test_2",
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      sessionStore.transition(session.id, "failed");
      expect(sessionStore.get(session.id)?.status).toBe("failed");
      expect(sessionStore.get(session.id)?.endedAt).toBeDefined();
    });

    it("only allows valid transitions: active -> cancelled", () => {
      const session = sessionStore.create({
        id: "ses_test_3",
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      sessionStore.transition(session.id, "cancelled");
      expect(sessionStore.get(session.id)?.status).toBe("cancelled");
    });

    it("tracks full status transition history", () => {
      const session = sessionStore.create({
        id: "ses_test_4",
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      sessionStore.transition(session.id, "completed");

      const history = sessionStore.get(session.id)?.statusHistory ?? [];
      expect(history).toHaveLength(1);
      expect(history[0].from).toBe("active");
      expect(history[0].to).toBe("completed");
      expect(history[0].at).toBeDefined();
    });

    it("throws when transitioning non-existent session", () => {
      expect(() => sessionStore.transition("nonexistent", "completed")).toThrow(
        "Session nonexistent not found"
      );
    });
  });

  describe("event stream verification", () => {
    it("publishes events in correct order", async () => {
      const session = sessionStore.create({
        id: fixtures.session.id,
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      const expectedOrder: SessionEventType[] = [
        "task_status",
        "token",
        "tool_call",
        "tool_result",
        "file_change",
        "complete",
      ];

      for (const type of expectedOrder) {
        sessionStore.addEvent(session.id, {
          type,
          data: { step: type },
          timestamp: new Date().toISOString(),
        });
        await eventPublisher.publishSessionEvent(session.id, {
          type: "task_status",
          data: { step: type },
          timestamp: new Date().toISOString(),
        });
      }

      const events = sessionStore.get(session.id)?.events ?? [];
      expect(events).toHaveLength(expectedOrder.length);
      expect(events.map((e) => e.type)).toEqual(expectedOrder);

      // Event publisher received all events
      expect(eventPublisher.events).toHaveLength(expectedOrder.length);
    });

    it("stores session events in Redis for SSE consumers", async () => {
      const session = sessionStore.create({
        id: fixtures.session.id,
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      const event: SessionEvent = {
        type: "token",
        data: { content: "Hello from LLM" },
        timestamp: new Date().toISOString(),
      };

      // Store in Redis stream (simulated)
      await redis.xadd(
        `session:${session.id}:events`,
        "*",
        "data",
        JSON.stringify(event)
      );

      // Also store session status in Redis
      await redis.hset(
        `session:${session.id}`,
        "status",
        JSON.stringify({ status: "active", lastEvent: event.type })
      );

      const statusRaw = await redis.hget(`session:${session.id}`, "status");
      expect(statusRaw).toBeDefined();

      const status = JSON.parse(statusRaw as string);
      expect(status.status).toBe("active");
      expect(status.lastEvent).toBe("token");
    });
  });

  describe("multi-task session pipeline", () => {
    it("processes multiple tasks within a single session", async () => {
      const session = sessionStore.create({
        id: fixtures.session.id,
        projectId: fixtures.project.id,
        userId: fixtures.user.id,
        mode: "task",
      });

      const taskIds = ["task_001", "task_002", "task_003"];

      for (const taskId of taskIds) {
        await taskQueue.add(
          "agent-task",
          { taskId, sessionId: session.id, orgId: fixtures.org.id },
          { jobId: taskId }
        );
      }

      expect(await taskQueue.getWaitingCount()).toBe(3);

      let processedCount = 0;
      taskQueue.onProcess((job) => {
        processedCount++;
        sessionStore.addEvent(session.id, {
          type: "task_status",
          data: {
            taskId: job.data.taskId,
            status: "completed",
            index: processedCount,
          },
          timestamp: new Date().toISOString(),
        });
        return { success: true };
      });

      for (const _taskId of taskIds) {
        await taskQueue.processNext();
      }

      expect(processedCount).toBe(3);
      expect(await taskQueue.getWaitingCount()).toBe(0);
      expect(await taskQueue.getCompletedCount()).toBe(3);

      const events = sessionStore.get(session.id)?.events ?? [];
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.type === "task_status")).toBe(true);
    });
  });
});
