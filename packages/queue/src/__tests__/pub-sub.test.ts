import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockPublish = vi.fn().mockResolvedValue(1);

vi.mock("../connection", () => ({
  createRedisConnection: () => ({
    publish: mockPublish,
  }),
}));

import type { SessionEvent } from "../pub-sub";
import { EventPublisher } from "../pub-sub";

describe("EventPublisher", () => {
  let publisher: EventPublisher;

  beforeEach(() => {
    vi.clearAllMocks();
    publisher = new EventPublisher();
  });

  // ── publishSessionEvent ──────────────────────────────────────────────────

  describe("publishSessionEvent", () => {
    it("publishes to the correct session channel", async () => {
      const event: SessionEvent = {
        type: "task_status",
        data: { taskId: "task_1", status: "running" },
        timestamp: new Date().toISOString(),
      };

      await publisher.publishSessionEvent("ses_123", event);

      expect(mockPublish).toHaveBeenCalledWith(
        "session:ses_123:events",
        expect.any(String)
      );
    });

    it("serializes event data as JSON", async () => {
      const event: SessionEvent = {
        type: "agent:output",
        data: { content: "Hello world" },
        agentRole: "backend_coder",
        timestamp: "2025-01-01T00:00:00.000Z",
      };

      await publisher.publishSessionEvent("ses_1", event);

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.type).toBe("agent:output");
      expect(publishedData.data.content).toBe("Hello world");
      expect(publishedData.agentRole).toBe("backend_coder");
    });

    it("includes agentRole when provided", async () => {
      const event: SessionEvent = {
        type: "reasoning",
        data: { content: "Thinking..." },
        agentRole: "discovery",
        timestamp: new Date().toISOString(),
      };

      await publisher.publishSessionEvent("ses_1", event);

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.agentRole).toBe("discovery");
    });

    it("works without agentRole", async () => {
      const event: SessionEvent = {
        type: "task_status",
        data: { taskId: "task_1", status: "completed" },
        timestamp: new Date().toISOString(),
      };

      await publisher.publishSessionEvent("ses_1", event);

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.agentRole).toBeUndefined();
    });
  });

  // ── publishFleetEvent ────────────────────────────────────────────────────

  describe("publishFleetEvent", () => {
    it("publishes to fleet:events channel", async () => {
      const event: SessionEvent = {
        type: "agent:status",
        data: { agentId: "agt_1", status: "working" },
        timestamp: new Date().toISOString(),
      };

      await publisher.publishFleetEvent("org_123", event);

      expect(mockPublish).toHaveBeenCalledWith(
        "fleet:events",
        expect.any(String)
      );
    });

    it("includes orgId in the published event data", async () => {
      const event: SessionEvent = {
        type: "agent:status",
        data: { agentId: "agt_1" },
        timestamp: "2025-06-01T00:00:00.000Z",
      };

      await publisher.publishFleetEvent("org_456", event);

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.orgId).toBe("org_456");
      expect(publishedData.type).toBe("agent:status");
      expect(publishedData.data.agentId).toBe("agt_1");
    });

    it("merges orgId with event without overwriting other fields", async () => {
      const event: SessionEvent = {
        type: "task_status",
        data: { taskId: "task_1", status: "completed" },
        agentRole: "orchestrator",
        timestamp: new Date().toISOString(),
      };

      await publisher.publishFleetEvent("org_1", event);

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.orgId).toBe("org_1");
      expect(publishedData.agentRole).toBe("orchestrator");
      expect(publishedData.data.taskId).toBe("task_1");
    });
  });

  // ── publishNotification ──────────────────────────────────────────────────

  describe("publishNotification", () => {
    it("publishes to user notification channel", async () => {
      await publisher.publishNotification("user_1", {
        type: "task_complete",
        title: "Task Done",
        message: "Your task has been completed successfully.",
      });

      expect(mockPublish).toHaveBeenCalledWith(
        "user:user_1:notifications",
        expect.any(String)
      );
    });

    it("includes timestamp in notification", async () => {
      await publisher.publishNotification("user_1", {
        type: "credits_low",
        title: "Low Credits",
        message: "You have 5 credits remaining.",
      });

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.timestamp).toBeDefined();
      expect(() => new Date(publishedData.timestamp)).not.toThrow();
    });

    it("passes through notification data field", async () => {
      await publisher.publishNotification("user_1", {
        type: "task_complete",
        title: "Done",
        message: "Task completed",
        data: { taskId: "task_1", creditsUsed: 5 },
      });

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.data.taskId).toBe("task_1");
      expect(publishedData.data.creditsUsed).toBe(5);
    });

    it("works without optional data field", async () => {
      await publisher.publishNotification("user_1", {
        type: "weekly_summary",
        title: "Weekly Summary",
        message: "You completed 10 tasks this week.",
      });

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.type).toBe("weekly_summary");
      expect(publishedData.data).toBeUndefined();
    });
  });

  // ── publishQueuePosition ─────────────────────────────────────────────────

  describe("publishQueuePosition", () => {
    it("publishes queue_position event to session channel", async () => {
      await publisher.publishQueuePosition("ses_1", {
        taskId: "task_1",
        position: 3,
        estimatedWaitSeconds: 180,
        totalInQueue: 5,
      });

      expect(mockPublish).toHaveBeenCalledWith(
        "session:ses_1:events",
        expect.any(String)
      );
    });

    it("formats event with correct structure", async () => {
      await publisher.publishQueuePosition("ses_1", {
        taskId: "task_1",
        position: 2,
        estimatedWaitSeconds: 120,
        totalInQueue: 4,
      });

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.type).toBe("queue_position");
      expect(publishedData.data.taskId).toBe("task_1");
      expect(publishedData.data.position).toBe(2);
      expect(publishedData.data.estimatedWaitSeconds).toBe(120);
      expect(publishedData.data.totalInQueue).toBe(4);
      expect(publishedData.timestamp).toBeDefined();
    });

    it("includes position 0 for active tasks", async () => {
      await publisher.publishQueuePosition("ses_1", {
        taskId: "task_active",
        position: 0,
        estimatedWaitSeconds: 0,
        totalInQueue: 3,
      });

      const publishedData = JSON.parse(mockPublish.mock.calls[0]?.[1]);
      expect(publishedData.data.position).toBe(0);
      expect(publishedData.data.estimatedWaitSeconds).toBe(0);
    });
  });

  // ── constructor ──────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("accepts custom redis instance", () => {
      const customRedis = { publish: vi.fn().mockResolvedValue(1) } as any;
      const customPublisher = new EventPublisher(customRedis);

      customPublisher.publishSessionEvent("ses_1", {
        type: "test",
        data: {},
        timestamp: new Date().toISOString(),
      });

      expect(customRedis.publish).toHaveBeenCalled();
    });
  });
});
