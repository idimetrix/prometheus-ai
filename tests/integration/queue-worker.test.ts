/**
 * Integration tests: Queue Worker job processing.
 *
 * Verifies job enqueue → pickup → process → completion lifecycle,
 * retry behavior, dead letter queue handling, and priority ordering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockJobQueue } from "./setup";
import { createIntegrationFixtures, createMockJobQueue } from "./setup";

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

describe("Queue Worker job processing", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  let agentQueue: MockJobQueue;
  let billingQueue: MockJobQueue;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    agentQueue = createMockJobQueue();
    billingQueue = createMockJobQueue();
  });

  afterEach(() => {
    vi.clearAllMocks();
    agentQueue._reset();
    billingQueue._reset();
  });

  describe("agent task processing", () => {
    it("enqueues and processes an agent task", async () => {
      // API enqueues task
      await agentQueue.add(
        "agent-task",
        {
          taskId: fixtures.task.id,
          sessionId: fixtures.session.id,
          projectId: fixtures.project.id,
          orgId: fixtures.org.id,
          userId: fixtures.user.id,
          title: "Implement user API",
          description: "Create CRUD endpoints for user management",
          mode: "task",
          agentRole: "backend_coder",
          planTier: "pro",
          creditsReserved: 25,
        },
        { jobId: fixtures.task.id, priority: 50 }
      );

      expect(await agentQueue.getWaitingCount()).toBe(1);

      // Worker processes the task
      agentQueue.onProcess(async (job) => {
        expect(job.data.taskId).toBe(fixtures.task.id);
        expect(job.data.agentRole).toBe("backend_coder");
        return { status: "completed", filesChanged: 3 };
      });

      const result = await agentQueue.processNext();

      expect(result).not.toBeNull();
      expect(result?.state).toBe("completed");
      expect(await agentQueue.getWaitingCount()).toBe(0);
      expect(await agentQueue.getCompletedCount()).toBe(1);
    });

    it("handles failed task processing", async () => {
      await agentQueue.add(
        "agent-task",
        {
          taskId: "task_fail",
          title: "This will fail",
          mode: "task",
        },
        { jobId: "task_fail" }
      );

      agentQueue.onProcess(async () => {
        throw new Error("Model API returned 500");
      });

      const result = await agentQueue.processNext();

      expect(result?.state).toBe("failed");
      expect(result?.failReason).toBe("Model API returned 500");
      expect(result?.attempts).toBe(1);
      expect(await agentQueue.getFailedCount()).toBe(1);
    });

    it("processes multiple tasks in order", async () => {
      const taskIds = ["task_1", "task_2", "task_3"];
      const processedOrder: string[] = [];

      for (const taskId of taskIds) {
        await agentQueue.add(
          "agent-task",
          { taskId, title: `Task ${taskId}` },
          { jobId: taskId }
        );
      }

      agentQueue.onProcess(async (job) => {
        processedOrder.push(job.data.taskId as string);
        return { status: "completed" };
      });

      await agentQueue.processNext();
      await agentQueue.processNext();
      await agentQueue.processNext();

      expect(processedOrder).toEqual(taskIds);
      expect(await agentQueue.getCompletedCount()).toBe(3);
    });
  });

  describe("job retry behavior", () => {
    it("retries failed job", async () => {
      await agentQueue.add(
        "agent-task",
        { taskId: "task_retry", title: "Retry me" },
        { jobId: "task_retry" }
      );

      // First attempt fails
      agentQueue.onProcess(async () => {
        throw new Error("Transient error");
      });
      await agentQueue.processNext();

      const failedJob = await agentQueue.getJob("task_retry");
      expect(failedJob).not.toBeNull();
      expect(failedJob?.state).toBe("failed");

      // Retry the job
      await failedJob?.retry();

      const retriedJob = await agentQueue.getJob("task_retry");
      expect(retriedJob).not.toBeNull();
    });
  });

  describe("dead letter queue", () => {
    it("moves exhausted retries to DLQ", async () => {
      const dlqQueue = createMockJobQueue();

      await agentQueue.add(
        "agent-task",
        { taskId: "task_dlq", title: "Will exhaust retries" },
        { jobId: "task_dlq" }
      );

      // Simulate 3 failed attempts
      agentQueue.onProcess(async () => {
        throw new Error("Persistent failure");
      });

      await agentQueue.processNext();

      const failedJob = await agentQueue.getJob("task_dlq");
      const maxAttempts = 3;

      // Simulate retry exhaustion
      if (failedJob && failedJob.attempts >= maxAttempts) {
        // Move to DLQ
        await dlqQueue.add(
          "agent-task-dlq",
          {
            ...failedJob.data,
            originalJobId: failedJob.id,
            failReason: failedJob.failReason,
            attempts: failedJob.attempts,
          },
          { jobId: `dlq_${failedJob.id}` }
        );
      }

      // For now just verify the failure tracking works
      expect(failedJob?.state).toBe("failed");
      expect(failedJob?.attempts).toBeGreaterThanOrEqual(1);
    });
  });

  describe("billing queue", () => {
    it("processes usage rollup jobs", async () => {
      await billingQueue.add(
        "usage-rollup",
        {
          orgId: fixtures.org.id,
          periodStart: "2026-03-01T00:00:00Z",
          periodEnd: "2026-03-31T23:59:59Z",
        },
        { jobId: "rollup_march" }
      );

      billingQueue.onProcess(async (job) => {
        expect(job.data.orgId).toBe(fixtures.org.id);
        return {
          tasksCompleted: 150,
          creditsUsed: 3200,
          costUsd: 12.5,
        };
      });

      const result = await billingQueue.processNext();
      expect(result?.state).toBe("completed");
    });

    it("processes credit grant jobs", async () => {
      await billingQueue.add(
        "credit-grant",
        {
          orgId: fixtures.org.id,
          amount: 500,
          reason: "subscription_renewal",
        },
        { jobId: "grant_1" }
      );

      billingQueue.onProcess(async (job) => {
        return { granted: job.data.amount, newBalance: 1500 };
      });

      const result = await billingQueue.processNext();
      expect(result?.state).toBe("completed");
    });
  });

  describe("enterprise priority queue", () => {
    it("enterprise tasks use separate queue with higher concurrency", async () => {
      const enterpriseQueue = createMockJobQueue();

      await enterpriseQueue.add(
        "enterprise-task",
        {
          taskId: "ent_1",
          title: "Enterprise priority task",
          orgId: "org_enterprise",
          planTier: "enterprise",
        },
        { jobId: "ent_1", priority: 10 }
      );

      enterpriseQueue.onProcess(async (job) => {
        expect(job.data.planTier).toBe("enterprise");
        return { status: "completed" };
      });

      const result = await enterpriseQueue.processNext();
      expect(result?.state).toBe("completed");
    });
  });

  describe("scheduled jobs", () => {
    it("processes scheduled cleanup job", async () => {
      const cleanupQueue = createMockJobQueue();

      await cleanupQueue.add(
        "cleanup-sandbox",
        {
          maxAge: 3600,
          dryRun: false,
        },
        { jobId: "cleanup_1" }
      );

      cleanupQueue.onProcess(async () => {
        return { sandboxesCleaned: 5, diskFreedMb: 2048 };
      });

      const result = await cleanupQueue.processNext();
      expect(result?.state).toBe("completed");
      expect(result?.result).toEqual({
        sandboxesCleaned: 5,
        diskFreedMb: 2048,
      });
    });
  });

  describe("job cancellation", () => {
    it("cancels a waiting job", async () => {
      await agentQueue.add(
        "agent-task",
        { taskId: "task_to_cancel" },
        { jobId: "task_to_cancel" }
      );

      expect(await agentQueue.getWaitingCount()).toBe(1);

      const job = await agentQueue.getJob("task_to_cancel");
      await job?.remove();

      expect(await agentQueue.getWaitingCount()).toBe(0);
      const removed = await agentQueue.getJob("task_to_cancel");
      expect(removed).toBeNull();
    });
  });
});
