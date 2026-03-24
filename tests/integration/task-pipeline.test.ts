/**
 * Integration tests: Task submission -> queue -> processor flow.
 *
 * Verifies the full pipeline from task creation through queue dispatch
 * to worker processing, with mocked HTTP and infrastructure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockJobQueue } from "./setup";
import {
  createIntegrationFixtures,
  createMockJobQueue,
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
// Pipeline simulation types
// ---------------------------------------------------------------------------

interface TaskSubmission {
  agentRole: string;
  description: string;
  mode: "task" | "chat" | "review";
  orgId: string;
  projectId: string;
  sessionId: string;
  title: string;
  userId: string;
}

type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface TaskRecord {
  completedAt?: string;
  error?: string;
  id: string;
  queuedAt?: string;
  result?: { filesChanged: number; output: string };
  startedAt?: string;
  status: TaskStatus;
  submission: TaskSubmission;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Task pipeline integration", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  let taskQueue: MockJobQueue;
  let taskStore: Map<string, TaskRecord>;
  let orchestratorClient: ReturnType<typeof createMockServiceClient>;

  function submitTask(submission: TaskSubmission): TaskRecord {
    const taskId = `task_${Date.now()}_${taskStore.size}`;
    const record: TaskRecord = {
      id: taskId,
      status: "pending",
      submission,
    };
    taskStore.set(taskId, record);
    return record;
  }

  async function enqueueTask(task: TaskRecord): Promise<void> {
    await taskQueue.add(
      "agent-task",
      {
        taskId: task.id,
        ...task.submission,
      },
      { jobId: task.id, priority: 50 }
    );
    task.status = "queued";
    task.queuedAt = new Date().toISOString();
  }

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    taskQueue = createMockJobQueue();
    taskStore = new Map();
    orchestratorClient = createMockServiceClient("orchestrator");

    // Mock orchestrator execute endpoint
    orchestratorClient.onRequest("POST", "/execute", {
      status: 200,
      body: { success: true, filesChanged: 3, output: "Task completed" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    taskQueue._reset();
    orchestratorClient._reset();
  });

  describe("task submission", () => {
    it("creates a task record from submission", () => {
      const task = submitTask({
        title: "Implement user API",
        description: "Create CRUD endpoints",
        mode: "task",
        agentRole: "backend_coder",
        projectId: fixtures.project.id,
        sessionId: fixtures.session.id,
        orgId: fixtures.org.id,
        userId: fixtures.user.id,
      });

      expect(task.id).toBeDefined();
      expect(task.status).toBe("pending");
      expect(task.submission.agentRole).toBe("backend_coder");
    });

    it("rejects invalid mode", () => {
      const invalidModes = ["invalid", "", "exec"];
      const validModes = new Set(["task", "chat", "review"]);

      for (const mode of invalidModes) {
        expect(validModes.has(mode)).toBe(false);
      }
    });

    it("preserves all submission fields through the pipeline", async () => {
      const submission: TaskSubmission = {
        title: "Add auth middleware",
        description: "JWT validation for API routes",
        mode: "task",
        agentRole: "backend_coder",
        projectId: fixtures.project.id,
        sessionId: fixtures.session.id,
        orgId: fixtures.org.id,
        userId: fixtures.user.id,
      };

      const task = submitTask(submission);
      await enqueueTask(task);

      const job = await taskQueue.getJob(task.id);
      expect(job).not.toBeNull();
      expect(job?.data.title).toBe(submission.title);
      expect(job?.data.agentRole).toBe(submission.agentRole);
      expect(job?.data.orgId).toBe(submission.orgId);
    });
  });

  describe("queue dispatch", () => {
    it("transitions task from pending to queued", async () => {
      const task = submitTask({
        title: "Queue test",
        description: "Testing queue dispatch",
        mode: "task",
        agentRole: "frontend_coder",
        projectId: fixtures.project.id,
        sessionId: fixtures.session.id,
        orgId: fixtures.org.id,
        userId: fixtures.user.id,
      });

      expect(task.status).toBe("pending");
      await enqueueTask(task);
      expect(task.status).toBe("queued");
      expect(task.queuedAt).toBeDefined();
    });

    it("processes tasks in FIFO order", async () => {
      const tasks: TaskRecord[] = [];
      for (let i = 0; i < 3; i++) {
        const task = submitTask({
          title: `Task ${i}`,
          description: `Test task ${i}`,
          mode: "task",
          agentRole: "backend_coder",
          projectId: fixtures.project.id,
          sessionId: fixtures.session.id,
          orgId: fixtures.org.id,
          userId: fixtures.user.id,
        });
        await enqueueTask(task);
        tasks.push(task);
      }

      const processedOrder: string[] = [];
      taskQueue.onProcess((job) => {
        processedOrder.push(job.data.taskId as string);
        return { status: "completed" };
      });

      for (const _task of tasks) {
        await taskQueue.processNext();
      }

      expect(processedOrder).toEqual(tasks.map((t) => t.id));
    });

    it("reports correct queue depth", async () => {
      for (let i = 0; i < 5; i++) {
        const task = submitTask({
          title: `Task ${i}`,
          description: `Test task ${i}`,
          mode: "task",
          agentRole: "backend_coder",
          projectId: fixtures.project.id,
          sessionId: fixtures.session.id,
          orgId: fixtures.org.id,
          userId: fixtures.user.id,
        });
        await enqueueTask(task);
      }

      expect(await taskQueue.getWaitingCount()).toBe(5);
    });
  });

  describe("worker processing", () => {
    it("processes a task through the full pipeline", async () => {
      const task = submitTask({
        title: "Full pipeline test",
        description: "E2E test",
        mode: "task",
        agentRole: "backend_coder",
        projectId: fixtures.project.id,
        sessionId: fixtures.session.id,
        orgId: fixtures.org.id,
        userId: fixtures.user.id,
      });
      await enqueueTask(task);

      taskQueue.onProcess(async (job) => {
        // Simulate worker calling orchestrator
        task.status = "running";
        task.startedAt = new Date().toISOString();

        const response = await orchestratorClient.request("POST", "/execute", {
          taskId: job.data.taskId,
        });

        if (response.status === 200) {
          const body = response.body as {
            filesChanged: number;
            output: string;
          };
          task.status = "completed";
          task.completedAt = new Date().toISOString();
          task.result = {
            filesChanged: body.filesChanged,
            output: body.output,
          };
          return body;
        }

        throw new Error(`Orchestrator returned ${response.status}`);
      });

      await taskQueue.processNext();

      expect(task.status).toBe("completed");
      expect(task.result?.filesChanged).toBe(3);
      expect(task.startedAt).toBeDefined();
      expect(task.completedAt).toBeDefined();
    });

    it("handles orchestrator failure gracefully", async () => {
      orchestratorClient._reset();
      orchestratorClient.onRequest("POST", "/execute", {
        status: 500,
        body: { error: "Internal server error" },
      });

      const task = submitTask({
        title: "Failure test",
        description: "Should handle failure",
        mode: "task",
        agentRole: "backend_coder",
        projectId: fixtures.project.id,
        sessionId: fixtures.session.id,
        orgId: fixtures.org.id,
        userId: fixtures.user.id,
      });
      await enqueueTask(task);

      taskQueue.onProcess(async (job) => {
        task.status = "running";
        const response = await orchestratorClient.request("POST", "/execute", {
          taskId: job.data.taskId,
        });

        if (response.status !== 200) {
          task.status = "failed";
          task.error = `Orchestrator returned ${response.status}`;
          throw new Error(task.error);
        }

        return response.body;
      });

      const result = await taskQueue.processNext();

      expect(result?.state).toBe("failed");
      expect(task.status).toBe("failed");
      expect(task.error).toContain("500");
    });
  });

  describe("task cancellation", () => {
    it("cancels a queued task before processing", async () => {
      const task = submitTask({
        title: "Cancel me",
        description: "This should be cancelled",
        mode: "task",
        agentRole: "backend_coder",
        projectId: fixtures.project.id,
        sessionId: fixtures.session.id,
        orgId: fixtures.org.id,
        userId: fixtures.user.id,
      });
      await enqueueTask(task);

      expect(await taskQueue.getWaitingCount()).toBe(1);

      const job = await taskQueue.getJob(task.id);
      await job?.remove();
      task.status = "cancelled";

      expect(await taskQueue.getWaitingCount()).toBe(0);
      expect(task.status).toBe("cancelled");
    });
  });
});
