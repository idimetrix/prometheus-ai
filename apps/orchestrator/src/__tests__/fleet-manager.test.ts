import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockPublishSessionEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@prometheus/queue", () => ({
  EventPublisher: class {
    publishSessionEvent = mockPublishSessionEvent;
  },
  QueueEvents: {
    AGENT_STATUS: "agent:status",
  },
}));

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn(
    (prefix: string) =>
      `${prefix}_mock_${Math.random().toString(36).slice(2, 8)}`
  ),
}));

// Mock AgentLoop
const mockPause = vi.fn().mockResolvedValue(undefined);
const mockResume = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockGetCreditsConsumed = vi.fn().mockReturnValue(10);
const mockExecuteTask = vi.fn().mockResolvedValue({
  success: true,
  output: "Task completed",
  filesChanged: ["src/index.ts"],
  tokensUsed: { input: 500, output: 200 },
  toolCalls: 3,
  steps: 5,
  creditsConsumed: 10,
});

vi.mock("../agent-loop", () => ({
  AgentLoop: class {
    executeTask = mockExecuteTask;
    pause = mockPause;
    resume = mockResume;
    stop = mockStop;
    getCreditsConsumed = mockGetCreditsConsumed;
  },
}));

// Mock ParallelScheduler
vi.mock("../parallel/scheduler", () => ({
  ParallelScheduler: class {
    schedule = vi.fn().mockImplementation((tasks) => ({
      waves: [tasks], // Single wave with all tasks
      criticalPath: tasks.map((t: { id: string }) => t.id),
      estimatedDuration: "5m",
    }));
  },
}));

import { FleetManager } from "../fleet-manager";
import type { SchedulableTask } from "../parallel/scheduler";

describe("FleetManager", () => {
  let fleet: FleetManager;

  beforeEach(() => {
    vi.clearAllMocks();
    fleet = new FleetManager({
      sessionId: "ses_1",
      projectId: "proj_1",
      orgId: "org_1",
      userId: "user_1",
      planTier: "pro",
    });
  });

  describe("executeTasks", () => {
    it("executes tasks and returns results", async () => {
      const tasks: SchedulableTask[] = [
        {
          id: "t1",
          title: "Task 1",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "medium",
        },
        {
          id: "t2",
          title: "Task 2",
          agentRole: "frontend_coder",
          dependencies: [],
          effort: "small",
        },
      ];

      const results = await fleet.executeTasks(tasks, "blueprint content");

      expect(results).toHaveLength(2);
      expect(results[0]?.success).toBe(true);
      expect(results[1]?.success).toBe(true);
      expect(mockExecuteTask).toHaveBeenCalledTimes(2);
    });

    it("handles task execution failures gracefully", async () => {
      mockExecuteTask.mockRejectedValueOnce(new Error("Agent crashed"));

      const tasks: SchedulableTask[] = [
        {
          id: "t1",
          title: "Failing Task",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "medium",
        },
      ];

      const results = await fleet.executeTasks(tasks, "");
      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.error).toContain("Agent crashed");
    });

    it("publishes fleet status events", async () => {
      const tasks: SchedulableTask[] = [
        {
          id: "t1",
          title: "Task 1",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "small",
        },
      ];

      await fleet.executeTasks(tasks, "");
      expect(mockPublishSessionEvent).toHaveBeenCalled();
    });
  });

  describe("tier limits", () => {
    it("pro tier allows up to 5 parallel agents", async () => {
      const tasks: SchedulableTask[] = Array.from({ length: 8 }, (_, i) => ({
        id: `t${i}`,
        title: `Task ${i}`,
        agentRole: "backend_coder",
        dependencies: [],
        effort: "small",
      }));

      // The fleet should chunk tasks into groups of 5 (pro tier limit)
      const results = await fleet.executeTasks(tasks, "");
      expect(results).toHaveLength(8);
      // All should still complete, just chunked
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("hobby tier allows only 1 parallel agent", async () => {
      const hobbyFleet = new FleetManager({
        sessionId: "ses_2",
        projectId: "proj_1",
        orgId: "org_1",
        userId: "user_1",
        planTier: "hobby",
      });

      const tasks: SchedulableTask[] = [
        {
          id: "t1",
          title: "Task 1",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "small",
        },
        {
          id: "t2",
          title: "Task 2",
          agentRole: "frontend_coder",
          dependencies: [],
          effort: "small",
        },
      ];

      const results = await hobbyFleet.executeTasks(tasks, "");
      // Both should complete (just one at a time)
      expect(results).toHaveLength(2);
    });

    it("unknown tier defaults to 1 parallel agent", async () => {
      const unknownFleet = new FleetManager({
        sessionId: "ses_3",
        projectId: "proj_1",
        orgId: "org_1",
        userId: "user_1",
        planTier: "nonexistent",
      });

      const tasks: SchedulableTask[] = [
        {
          id: "t1",
          title: "Task 1",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "small",
        },
      ];

      const results = await unknownFleet.executeTasks(tasks, "");
      expect(results).toHaveLength(1);
    });
  });

  describe("getStatus", () => {
    it("returns initial empty status", () => {
      const status = fleet.getStatus();
      expect(status.sessionId).toBe("ses_1");
      expect(status.totalAgents).toBe(0);
      expect(status.running).toBe(0);
      expect(status.completed).toBe(0);
      expect(status.failed).toBe(0);
      expect(status.queued).toBe(0);
      expect(status.agents).toHaveLength(0);
      expect(status.totalCreditsConsumed).toBe(0);
    });

    it("reflects agent statuses after execution", async () => {
      const tasks: SchedulableTask[] = [
        {
          id: "t1",
          title: "Task 1",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "small",
        },
      ];

      await fleet.executeTasks(tasks, "");
      const status = fleet.getStatus();
      expect(status.totalAgents).toBe(1);
      expect(status.completed).toBe(1);
    });
  });

  describe("stopAll", () => {
    it("stops all running/paused agents", async () => {
      const tasks: SchedulableTask[] = [
        {
          id: "t1",
          title: "Task 1",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "small",
        },
      ];

      await fleet.executeTasks(tasks, "");
      await fleet.stopAll();

      expect(mockPublishSessionEvent).toHaveBeenCalled();
    });
  });
});
