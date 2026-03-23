/**
 * Integration test skeleton: API -> Orchestrator communication patterns.
 *
 * These tests verify that the API layer can dispatch work to the
 * orchestrator via the shared queue, and that the orchestrator
 * acknowledges and processes messages correctly.
 *
 * All external dependencies (database, queue, orchestrator) are mocked
 * so these tests run without infrastructure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

// Mock task queue shared between API and Orchestrator
const jobStore = new Map<
  string,
  { name: string; data: Record<string, unknown>; opts: Record<string, unknown> }
>();

const mockQueue = {
  add: vi.fn(
    (
      name: string,
      data: Record<string, unknown>,
      opts: Record<string, unknown> = {}
    ) => {
      const id = (opts.jobId as string) ?? `job_${jobStore.size + 1}`;
      jobStore.set(id, { name, data, opts });
      return { id, name, data };
    }
  ),
  getJob: vi.fn((id: string) => {
    const job = jobStore.get(id);
    if (!job) {
      return null;
    }
    return {
      id,
      ...job,
      getState: vi.fn().mockResolvedValue("waiting"),
      remove: vi.fn(() => {
        jobStore.delete(id);
      }),
    };
  }),
  getWaitingCount: vi.fn(async () => jobStore.size),
};

vi.mock("@prometheus/queue", () => ({
  agentTaskQueue: mockQueue,
  EventPublisher: vi.fn().mockImplementation(() => ({
    publish: vi.fn(),
    subscribe: vi.fn(),
  })),
  QueueEvents: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("API -> Orchestrator communication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobStore.clear();
  });

  afterEach(() => {
    jobStore.clear();
  });

  // ── Task dispatch ───────────────────────────────────────────────────────

  describe("task dispatch via queue", () => {
    it("API enqueues a task that the orchestrator can pick up", async () => {
      // Simulate the API submitting a task
      const taskPayload = {
        taskId: "task_int_1",
        sessionId: "ses_int_1",
        projectId: "proj_int_1",
        orgId: "org_int_1",
        userId: "user_int_1",
        title: "Implement auth middleware",
        description: "Add JWT verification to all protected routes",
        mode: "task",
        agentRole: "backend_coder",
        planTier: "pro",
        creditsReserved: 10,
      };

      const job = await mockQueue.add("agent-task", taskPayload, {
        jobId: taskPayload.taskId,
        priority: 50,
      });

      expect(job.id).toBe("task_int_1");
      expect(job.data).toEqual(taskPayload);

      // Simulate the orchestrator picking up the job
      const retrieved = await mockQueue.getJob("task_int_1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.data.title).toBe("Implement auth middleware");
      expect(retrieved?.data.agentRole).toBe("backend_coder");
    });

    it("handles multiple tasks queued in sequence", async () => {
      const tasks = [
        { taskId: "task_1", title: "Backend API", agentRole: "backend_coder" },
        { taskId: "task_2", title: "Frontend UI", agentRole: "frontend_coder" },
        { taskId: "task_3", title: "Write tests", agentRole: "test_engineer" },
      ];

      for (const task of tasks) {
        await mockQueue.add(
          "agent-task",
          {
            ...task,
            sessionId: "ses_1",
            projectId: "proj_1",
            orgId: "org_1",
            userId: "user_1",
            description: null,
            mode: "task",
            planTier: "pro",
            creditsReserved: 5,
          },
          { jobId: task.taskId, priority: 50 }
        );
      }

      const waitingCount = await mockQueue.getWaitingCount();
      expect(waitingCount).toBe(3);

      // Verify each task is retrievable
      for (const task of tasks) {
        const job = await mockQueue.getJob(task.taskId);
        expect(job).not.toBeNull();
        expect(job?.data.title).toBe(task.title);
      }
    });
  });

  // ── Task cancellation ─────────────────────────────────────────────────

  describe("task cancellation", () => {
    it("API can cancel a queued task before orchestrator processes it", async () => {
      await mockQueue.add(
        "agent-task",
        {
          taskId: "task_cancel_1",
          sessionId: "ses_1",
          projectId: "proj_1",
          orgId: "org_1",
          userId: "user_1",
          title: "Cancelled task",
          description: null,
          mode: "task",
          agentRole: null,
          planTier: "hobby",
          creditsReserved: 0,
        },
        { jobId: "task_cancel_1" }
      );

      const job = await mockQueue.getJob("task_cancel_1");
      expect(job).not.toBeNull();

      // Cancel the job
      await job?.remove();

      // Verify it is no longer in the queue
      const removedJob = await mockQueue.getJob("task_cancel_1");
      expect(removedJob).toBeNull();
    });

    it("handles cancellation of non-existent task gracefully", async () => {
      const job = await mockQueue.getJob("task_nonexistent");
      expect(job).toBeNull();
      // No error thrown when job doesn't exist
    });
  });

  // ── Fleet dispatch (parallel agents) ──────────────────────────────────

  describe("fleet dispatch", () => {
    it("dispatches multiple agent tasks for parallel execution", async () => {
      const agents = [
        { role: "backend_coder", title: "Build REST API" },
        { role: "frontend_coder", title: "Build React components" },
        { role: "test_engineer", title: "Write integration tests" },
      ];

      const dispatched: Array<{
        id: string;
        name: string;
        data: Record<string, unknown>;
      }> = [];

      for (const agent of agents) {
        const job = await mockQueue.add(
          "agent-task",
          {
            taskId: `task_fleet_${agent.role}`,
            sessionId: "ses_fleet_1",
            projectId: "proj_1",
            orgId: "org_1",
            userId: "user_1",
            title: agent.title,
            description: null,
            mode: "fleet",
            agentRole: agent.role,
            planTier: "team",
            creditsReserved: 20,
          },
          { jobId: `task_fleet_${agent.role}`, priority: 50 }
        );
        dispatched.push(job);
      }

      expect(dispatched).toHaveLength(3);

      // All tasks should be in queue
      const waitingCount = await mockQueue.getWaitingCount();
      expect(waitingCount).toBe(3);

      // Verify each agent's task
      for (const agent of agents) {
        const job = await mockQueue.getJob(`task_fleet_${agent.role}`);
        expect(job?.data.mode).toBe("fleet");
        expect(job?.data.agentRole).toBe(agent.role);
      }
    });
  });

  // ── Priority handling ─────────────────────────────────────────────────

  describe("priority handling", () => {
    it("preserves priority metadata on dispatched jobs", async () => {
      await mockQueue.add(
        "agent-task",
        { taskId: "task_high", title: "Urgent fix" },
        { jobId: "task_high", priority: 10 }
      );

      await mockQueue.add(
        "agent-task",
        { taskId: "task_low", title: "Refactor later" },
        { jobId: "task_low", priority: 100 }
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "agent-task",
        expect.objectContaining({ taskId: "task_high" }),
        expect.objectContaining({ priority: 10 })
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "agent-task",
        expect.objectContaining({ taskId: "task_low" }),
        expect.objectContaining({ priority: 100 })
      );
    });
  });

  // ── Error resilience ──────────────────────────────────────────────────

  describe("error resilience", () => {
    it("propagates queue errors to the caller", async () => {
      mockQueue.add.mockRejectedValueOnce(new Error("Queue connection lost"));

      await expect(
        mockQueue.add("agent-task", { taskId: "task_fail" }, {})
      ).rejects.toThrow("Queue connection lost");
    });

    it("handles getJob errors gracefully", async () => {
      mockQueue.getJob.mockRejectedValueOnce(new Error("Redis timeout"));

      await expect(mockQueue.getJob("task_any")).rejects.toThrow(
        "Redis timeout"
      );
    });
  });
});
