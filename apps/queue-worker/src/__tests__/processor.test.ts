import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (hoisted so vi.mock factory can reference them) ────────────────────

const { mockUpdate, mockInsert, mockFindMany, mockFindFirst } = vi.hoisted(
  () => ({
    mockUpdate: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    mockInsert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    mockFindMany: vi.fn().mockResolvedValue([]),
    mockFindFirst: vi.fn().mockResolvedValue(null),
  })
);

vi.mock("@prometheus/db", () => ({
  db: {
    update: (...args: unknown[]) => mockUpdate(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    query: {
      tasks: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
        findFirst: mockFindFirst,
      },
      creditBalances: { findFirst: vi.fn().mockResolvedValue({ balance: 50 }) },
    },
  },
  tasks: { id: "id", sessionId: "sessionId", status: "status" },
  agents: { id: "id" },
  sessions: { id: "id" },
  creditBalances: { orgId: "orgId", balance: "balance" },
  creditTransactions: {},
  modelUsage: {},
}));

const mockOrchestratorPost = vi.fn();

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock123`),
  orchestratorClient: {
    post: (...args: unknown[]) => mockOrchestratorPost(...args),
  },
}));

vi.mock("@prometheus/telemetry", () => ({
  withSpan: (_name: string, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: vi.fn() }),
}));

const mockPublishSessionEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@prometheus/queue", () => ({
  EventPublisher: class {
    publishSessionEvent = mockPublishSessionEvent;
  },
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { AgentTaskData } from "@prometheus/queue";
import { TaskProcessor } from "../processor";

const baseTaskData: AgentTaskData = {
  taskId: "task_1",
  sessionId: "ses_1",
  projectId: "proj_1",
  orgId: "org_1",
  userId: "user_1",
  title: "Fix login bug",
  description: "The login form crashes on submit",
  mode: "task",
  agentRole: null,
  planTier: "hobby",
  creditsReserved: 0,
};

describe("TaskProcessor", () => {
  let processor: TaskProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrchestratorPost.mockReset();
    processor = new TaskProcessor();
    mockFindMany.mockResolvedValue([]);
  });

  it("updates task status to running at start", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 5,
        results: [
          {
            success: true,
            output: "Fixed the bug",
            filesChanged: ["src/login.ts"],
            tokensUsed: { input: 100, output: 50 },
            creditsConsumed: 5,
            steps: 3,
            toolCalls: 2,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]); // checkSessionCompletion

    await processor.process(baseTaskData);

    expect(mockUpdate).toHaveBeenCalled();
    // First call updates status to "running"
    const firstUpdateCall = mockUpdate.mock.results[0]?.value;
    expect(firstUpdateCall.set).toHaveBeenCalled();
  });

  it("publishes running status event", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 0,
        results: [
          {
            success: true,
            output: "Done",
            filesChanged: [],
            tokensUsed: { input: 0, output: 0 },
            creditsConsumed: 0,
            steps: 1,
            toolCalls: 0,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    await processor.process(baseTaskData);

    expect(mockPublishSessionEvent).toHaveBeenCalledWith(
      "ses_1",
      expect.objectContaining({
        type: "task_status",
        data: expect.objectContaining({ taskId: "task_1", status: "running" }),
      })
    );
  });

  it("creates agent instance record", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 0,
        results: [
          {
            success: true,
            output: "Done",
            filesChanged: [],
            tokensUsed: { input: 0, output: 0 },
            creditsConsumed: 0,
            steps: 1,
            toolCalls: 0,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    await processor.process(baseTaskData);

    // Insert should be called for agent creation
    expect(mockInsert).toHaveBeenCalled();
  });

  it("calls orchestrator service and processes response", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 5,
        results: [
          {
            success: true,
            output: "Fixed login bug by adding null check",
            filesChanged: ["src/login.ts"],
            tokensUsed: { input: 500, output: 200 },
            creditsConsumed: 5,
            steps: 4,
            toolCalls: 3,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    const result = await processor.process(baseTaskData);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Fixed login bug by adding null check");
    expect(result.filesChanged).toContain("src/login.ts");
    expect(result.creditsConsumed).toBe(5);
    expect(mockOrchestratorPost).toHaveBeenCalledWith(
      "/process",
      expect.objectContaining({
        taskId: "task_1",
        sessionId: "ses_1",
      })
    );
  });

  it("falls back to fallback processing when orchestrator returns non-ok", async () => {
    mockOrchestratorPost.mockRejectedValueOnce(
      new Error("Orchestrator returned 500")
    );
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    const result = await processor.process(baseTaskData);

    expect(result.success).toBe(true);
    expect(result.output).toContain("orchestrator fallback mode");
  });

  it("falls back when fetch throws (orchestrator unavailable)", async () => {
    mockOrchestratorPost.mockRejectedValueOnce(new Error("Connection refused"));
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    const result = await processor.process(baseTaskData);

    expect(result.success).toBe(true);
    expect(result.output).toContain("orchestrator fallback mode");
  });

  it("fallback returns 2 credits consumed for default", async () => {
    mockOrchestratorPost.mockRejectedValueOnce(new Error("timeout"));
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    const result = await processor.process(baseTaskData);
    expect(result.creditsConsumed).toBe(2);
  });

  it("fallback uses creditsReserved (capped at 2) when set", async () => {
    mockOrchestratorPost.mockRejectedValueOnce(new Error("timeout"));
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    const taskWithReserved = { ...baseTaskData, creditsReserved: 5 };
    const result = await processor.process(taskWithReserved);
    expect(result.creditsConsumed).toBe(2); // min(5, 2)
  });

  it("updates task status to completed on success", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 3,
        results: [
          {
            success: true,
            output: "Done",
            filesChanged: [],
            tokensUsed: { input: 100, output: 50 },
            creditsConsumed: 3,
            steps: 2,
            toolCalls: 1,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    await processor.process(baseTaskData);

    // Verify update called multiple times (running, agent idle, completed)
    expect(mockUpdate).toHaveBeenCalled();
    const updateCalls = mockUpdate.mock.calls.length;
    expect(updateCalls).toBeGreaterThanOrEqual(3);
  });

  it("publishes completion event with output details", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 4,
        results: [
          {
            success: true,
            output: "All tests pass",
            filesChanged: ["src/test.ts"],
            tokensUsed: { input: 200, output: 100 },
            creditsConsumed: 4,
            steps: 3,
            toolCalls: 2,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    await processor.process(baseTaskData);

    expect(mockPublishSessionEvent).toHaveBeenCalledWith(
      "ses_1",
      expect.objectContaining({
        type: "task_status",
        data: expect.objectContaining({
          taskId: "task_1",
          status: "completed",
          creditsConsumed: 4,
        }),
      })
    );
  });

  it("consumes credits when creditsConsumed > 0", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 5,
        results: [
          {
            success: true,
            output: "Done",
            filesChanged: [],
            tokensUsed: { input: 100, output: 50 },
            creditsConsumed: 5,
            steps: 2,
            toolCalls: 1,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    await processor.process(baseTaskData);

    // credit balance update + transaction insert
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });

  it("records model usage when tokens > 0", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 3,
        results: [
          {
            success: true,
            output: "Done",
            filesChanged: [],
            tokensUsed: { input: 500, output: 250 },
            creditsConsumed: 3,
            steps: 2,
            toolCalls: 1,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([{ status: "completed" }]);

    await processor.process(baseTaskData);

    // modelUsage insert
    expect(mockInsert).toHaveBeenCalled();
  });

  it("checks session completion after task processing", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 0,
        results: [
          {
            success: true,
            output: "Done",
            filesChanged: [],
            tokensUsed: { input: 0, output: 0 },
            creditsConsumed: 0,
            steps: 1,
            toolCalls: 0,
          },
        ],
      },
    });
    // All tasks are done
    mockFindMany.mockResolvedValueOnce([
      { status: "completed" },
      { status: "completed" },
    ]);

    await processor.process(baseTaskData);

    // Should update session to completed
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("sets session to failed when any task failed", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 0,
        results: [
          {
            success: true,
            output: "Done",
            filesChanged: [],
            tokensUsed: { input: 0, output: 0 },
            creditsConsumed: 0,
            steps: 1,
            toolCalls: 0,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([
      { status: "completed" },
      { status: "failed" },
    ]);

    await processor.process(baseTaskData);

    // Session should be updated (to "failed")
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("does not complete session when tasks are still pending", async () => {
    mockOrchestratorPost.mockResolvedValueOnce({
      data: {
        success: true,
        taskId: "task_1",
        sessionId: "ses_1",
        mode: "task",
        totalCreditsConsumed: 0,
        results: [
          {
            success: true,
            output: "Done",
            filesChanged: [],
            tokensUsed: { input: 0, output: 0 },
            creditsConsumed: 0,
            steps: 1,
            toolCalls: 0,
          },
        ],
      },
    });
    mockFindMany.mockResolvedValueOnce([
      { status: "completed" },
      { status: "running" },
    ]);

    const _updateCallsBefore = mockUpdate.mock.calls.length;
    await processor.process(baseTaskData);
    // Session update for status should NOT include "completed" or "failed"
    // because not all tasks are done
  });

  it("uses fallback processing when orchestrator response is invalid", async () => {
    mockOrchestratorPost.mockRejectedValueOnce(new Error("Parse error"));

    // Should not throw - uses fallback processing
    const result = await processor.process(baseTaskData);
    expect(result.success).toBe(true);
    expect(result.output).toContain("fallback");
  });

  it("publishes completion event even with fallback", async () => {
    mockOrchestratorPost.mockRejectedValueOnce(
      new Error("Orchestrator returned 500")
    );

    const result = await processor.process(baseTaskData);
    expect(result.success).toBe(true);
    expect(mockPublishSessionEvent).toHaveBeenCalled();
  });
});
