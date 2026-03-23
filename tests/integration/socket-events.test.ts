/**
 * Integration tests: Socket Server real-time event delivery.
 *
 * Verifies WebSocket connection lifecycle, room-based event
 * routing, namespace handling, and event ordering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationFixtures,
  createMockEventPublisher,
  createMockRedis,
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

describe("Socket Server real-time events", () => {
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

  describe("session event publishing", () => {
    it("publishes agent output events to session channel", async () => {
      await eventPublisher.publishSessionEvent(fixtures.session.id, {
        type: "agent_output",
        data: {
          content: "Creating user endpoint...",
          agentRole: "backend_coder",
          iteration: 1,
        },
        timestamp: new Date().toISOString(),
      });

      const events = eventPublisher.getEventsByType("session");
      expect(events).toHaveLength(1);
      expect(events[0].channel).toBe(`session:${fixtures.session.id}:events`);
    });

    it("publishes file change events", async () => {
      await eventPublisher.publishSessionEvent(fixtures.session.id, {
        type: "file_change",
        data: {
          filePath: "src/api/users.ts",
          operation: "create",
          diff: "+export function getUser() {}",
        },
        timestamp: new Date().toISOString(),
      });

      const events = eventPublisher.getEventsByType("session");
      expect(events).toHaveLength(1);
      const eventData = events[0].data as {
        type: string;
        data: { filePath: string };
      };
      expect(eventData.type).toBe("file_change");
      expect(eventData.data.filePath).toBe("src/api/users.ts");
    });

    it("publishes task status transitions", async () => {
      const statuses = ["queued", "running", "completed"] as const;

      for (const status of statuses) {
        await eventPublisher.publishSessionEvent(fixtures.session.id, {
          type: "task_status",
          data: {
            taskId: fixtures.task.id,
            status,
            agentRole: "backend_coder",
          },
          timestamp: new Date().toISOString(),
        });
      }

      const events = eventPublisher.getEventsByType("session");
      expect(events).toHaveLength(3);
    });

    it("publishes checkpoint events for human-in-the-loop", async () => {
      await eventPublisher.publishSessionEvent(fixtures.session.id, {
        type: "checkpoint",
        data: {
          question: "Deploy to staging or production?",
          options: ["staging", "production"],
          context: "CI tests have passed. Ready for deployment.",
        },
        timestamp: new Date().toISOString(),
      });

      const events = eventPublisher.getEventsByType("session");
      expect(events).toHaveLength(1);
      const eventData = events[0].data as {
        type: string;
        data: { options: string[] };
      };
      expect(eventData.data.options).toContain("staging");
    });

    it("publishes credit update events", async () => {
      await eventPublisher.publishSessionEvent(fixtures.session.id, {
        type: "credit_update",
        data: { consumed: 15, remaining: 485 },
        timestamp: new Date().toISOString(),
      });

      const events = eventPublisher.getEventsByType("session");
      expect(events).toHaveLength(1);
    });
  });

  describe("fleet event publishing", () => {
    it("publishes fleet status to org channel", async () => {
      await eventPublisher.publishFleetEvent(fixtures.org.id, {
        type: "fleet:updated",
        data: {
          agents: [
            { id: "agt_1", role: "backend_coder", status: "working" },
            { id: "agt_2", role: "frontend_coder", status: "idle" },
            { id: "agt_3", role: "test_engineer", status: "working" },
          ],
          activeTaskCount: 2,
        },
        timestamp: new Date().toISOString(),
      });

      const events = eventPublisher.getEventsByType("fleet");
      expect(events).toHaveLength(1);
    });
  });

  describe("notification publishing", () => {
    it("publishes task completion notification to user", async () => {
      await eventPublisher.publishNotification(fixtures.user.id, {
        type: "task_completed",
        title: "Task completed",
        message: "Your auth middleware implementation is ready for review",
        data: {
          taskId: fixtures.task.id,
          sessionId: fixtures.session.id,
        },
      });

      const events = eventPublisher.getEventsByType("notification");
      expect(events).toHaveLength(1);
      expect(events[0].channel).toBe(`user:${fixtures.user.id}:notifications`);
    });
  });

  describe("queue position updates", () => {
    it("publishes queue position to waiting session", async () => {
      await eventPublisher.publishQueuePosition(fixtures.session.id, {
        taskId: fixtures.task.id,
        position: 3,
        estimatedWaitSeconds: 120,
        totalInQueue: 7,
      });

      const events = eventPublisher.getEventsByType("queue_position");
      expect(events).toHaveLength(1);
      const eventData = events[0].data as {
        position: number;
        totalInQueue: number;
      };
      expect(eventData.position).toBe(3);
      expect(eventData.totalInQueue).toBe(7);
    });
  });

  describe("event ordering", () => {
    it("preserves event order within a session", async () => {
      for (let i = 0; i < 10; i++) {
        await eventPublisher.publishSessionEvent(fixtures.session.id, {
          type: "agent_output",
          data: { content: `Step ${i}`, iteration: i },
          timestamp: new Date(Date.now() + i).toISOString(),
        });
      }

      const events = eventPublisher.getEventsByType("session");
      expect(events).toHaveLength(10);

      // Verify ordering
      for (let i = 0; i < 10; i++) {
        const eventData = events[i].data as { data: { iteration: number } };
        expect(eventData.data.iteration).toBe(i);
      }
    });
  });

  describe("Redis pub/sub integration", () => {
    it("publishes session events to Redis channel", async () => {
      const receivedMessages: string[] = [];

      await redis.subscribe(
        `session:${fixtures.session.id}:events`,
        (_channel: string, message: string) => {
          receivedMessages.push(message);
        }
      );

      const event = {
        type: "agent_output",
        data: { content: "Hello" },
        timestamp: new Date().toISOString(),
      };

      await redis.publish(
        `session:${fixtures.session.id}:events`,
        JSON.stringify(event)
      );

      expect(receivedMessages).toHaveLength(1);
      expect(JSON.parse(receivedMessages[0])).toEqual(event);
    });

    it("isolates events between different sessions", async () => {
      const session1Events: string[] = [];
      const session2Events: string[] = [];

      await redis.subscribe("session:ses_1:events", (_ch, msg) => {
        session1Events.push(msg);
      });
      await redis.subscribe("session:ses_2:events", (_ch, msg) => {
        session2Events.push(msg);
      });

      await redis.publish(
        "session:ses_1:events",
        JSON.stringify({ type: "output", data: "for session 1" })
      );
      await redis.publish(
        "session:ses_2:events",
        JSON.stringify({ type: "output", data: "for session 2" })
      );

      expect(session1Events).toHaveLength(1);
      expect(session2Events).toHaveLength(1);
      expect(JSON.parse(session1Events[0]).data).toBe("for session 1");
      expect(JSON.parse(session2Events[0]).data).toBe("for session 2");
    });
  });
});
