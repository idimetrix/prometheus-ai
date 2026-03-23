import { describe, expect, it } from "vitest";
import {
  createTestOrg,
  createTestProject,
  createTestSession,
  createTestTask,
  createTestUser,
} from "../factories";
import {
  createMockContext,
  createMockEventPublisher,
  createMockRedis,
} from "../mocks";

// Top-level regex constants for prefix matching
const ORG_PREFIX_RE = /^org_/;
const USR_PREFIX_RE = /^usr_/;
const PRJ_PREFIX_RE = /^prj_/;
const SES_PREFIX_RE = /^ses_/;
const TSK_PREFIX_RE = /^tsk_/;
const REQ_PREFIX_RE = /^req_/;

// ============================================================================
// Factory functions
// ============================================================================

describe("createTestOrg", () => {
  it("produces an org with a prefixed id", () => {
    const org = createTestOrg();
    expect(org.id).toMatch(ORG_PREFIX_RE);
    expect(org.name).toBe("Test Org");
    expect(org.slug).toBe("test-org");
    expect(org.plan).toBe("pro");
  });

  it("generates unique IDs on each call", () => {
    const org1 = createTestOrg();
    const org2 = createTestOrg();
    expect(org1.id).not.toBe(org2.id);
  });

  it("allows overriding defaults", () => {
    const org = createTestOrg({
      id: "org_custom",
      name: "Custom Org",
      plan: "enterprise",
    });
    expect(org.id).toBe("org_custom");
    expect(org.name).toBe("Custom Org");
    expect(org.plan).toBe("enterprise");
    expect(org.slug).toBe("test-org"); // not overridden
  });
});

describe("createTestUser", () => {
  it("produces a user with prefixed id and orgId", () => {
    const user = createTestUser();
    expect(user.id).toMatch(USR_PREFIX_RE);
    expect(user.orgId).toMatch(ORG_PREFIX_RE);
    expect(user.email).toBe("test@example.com");
    expect(user.name).toBe("Test User");
    expect(user.role).toBe("admin");
  });

  it("generates unique IDs on each call", () => {
    const u1 = createTestUser();
    const u2 = createTestUser();
    expect(u1.id).not.toBe(u2.id);
  });

  it("allows overriding specific fields", () => {
    const user = createTestUser({
      email: "custom@example.com",
      role: "member",
    });
    expect(user.email).toBe("custom@example.com");
    expect(user.role).toBe("member");
    expect(user.id).toMatch(USR_PREFIX_RE); // not overridden
  });
});

describe("createTestProject", () => {
  it("produces a project with prefixed id", () => {
    const project = createTestProject();
    expect(project.id).toMatch(PRJ_PREFIX_RE);
    expect(project.orgId).toMatch(ORG_PREFIX_RE);
    expect(project.name).toBe("Test Project");
    expect(project.repoUrl).toBe("https://github.com/test/repo");
    expect(project.status).toBe("active");
  });

  it("allows overriding status", () => {
    const project = createTestProject({ status: "archived" });
    expect(project.status).toBe("archived");
  });
});

describe("createTestSession", () => {
  it("produces a session with prefixed ids", () => {
    const session = createTestSession();
    expect(session.id).toMatch(SES_PREFIX_RE);
    expect(session.projectId).toMatch(PRJ_PREFIX_RE);
    expect(session.userId).toMatch(USR_PREFIX_RE);
    expect(session.status).toBe("active");
    expect(session.mode).toBe("task");
  });

  it("allows overriding mode", () => {
    const session = createTestSession({ mode: "fleet" });
    expect(session.mode).toBe("fleet");
  });

  it("allows overriding all fields", () => {
    const session = createTestSession({
      id: "ses_custom",
      projectId: "prj_custom",
      userId: "usr_custom",
      status: "paused",
      mode: "ask",
    });
    expect(session.id).toBe("ses_custom");
    expect(session.projectId).toBe("prj_custom");
    expect(session.userId).toBe("usr_custom");
    expect(session.status).toBe("paused");
    expect(session.mode).toBe("ask");
  });
});

describe("createTestTask", () => {
  it("produces a task with prefixed ids", () => {
    const task = createTestTask();
    expect(task.id).toMatch(TSK_PREFIX_RE);
    expect(task.sessionId).toMatch(SES_PREFIX_RE);
    expect(task.projectId).toMatch(PRJ_PREFIX_RE);
    expect(task.title).toBe("Test Task");
    expect(task.status).toBe("pending");
    expect(task.agentRole).toBe("backend_coder");
  });

  it("allows overriding agent role", () => {
    const task = createTestTask({ agentRole: "frontend_coder" });
    expect(task.agentRole).toBe("frontend_coder");
  });
});

// ============================================================================
// Mock Redis
// ============================================================================

describe("createMockRedis", () => {
  describe("key/value operations", () => {
    it("get returns null for missing key", async () => {
      const redis = createMockRedis();
      expect(await redis.get("missing")).toBeNull();
    });

    it("set and get round-trip", async () => {
      const redis = createMockRedis();
      await redis.set("key1", "value1");
      expect(await redis.get("key1")).toBe("value1");
    });

    it("set returns OK", async () => {
      const redis = createMockRedis();
      expect(await redis.set("k", "v")).toBe("OK");
    });

    it("del removes keys and returns count", async () => {
      const redis = createMockRedis();
      await redis.set("a", "1");
      await redis.set("b", "2");
      const removed = await redis.del("a", "b", "c");
      expect(removed).toBe(2);
      expect(await redis.get("a")).toBeNull();
      expect(await redis.get("b")).toBeNull();
    });

    it("keys returns matching keys by glob pattern", async () => {
      const redis = createMockRedis();
      await redis.set("session:1:data", "a");
      await redis.set("session:2:data", "b");
      await redis.set("user:1:data", "c");
      const result = await redis.keys("session:*:data");
      expect(result).toHaveLength(2);
      expect(result).toContain("session:1:data");
      expect(result).toContain("session:2:data");
    });

    it("mget returns values for multiple keys", async () => {
      const redis = createMockRedis();
      await redis.set("a", "1");
      await redis.set("c", "3");
      const result = await redis.mget("a", "b", "c");
      expect(result).toEqual(["1", null, "3"]);
    });

    it("incr increments and creates keys", async () => {
      const redis = createMockRedis();
      expect(await redis.incr("counter")).toBe(1);
      expect(await redis.incr("counter")).toBe(2);
      expect(await redis.incr("counter")).toBe(3);
    });
  });

  describe("hash operations", () => {
    it("hset and hget round-trip", async () => {
      const redis = createMockRedis();
      await redis.hset("hash1", "field1", "value1");
      expect(await redis.hget("hash1", "field1")).toBe("value1");
    });

    it("hget returns null for missing field", async () => {
      const redis = createMockRedis();
      expect(await redis.hget("hash1", "missing")).toBeNull();
    });

    it("hgetall returns all fields", async () => {
      const redis = createMockRedis();
      await redis.hset("h", "a", "1");
      await redis.hset("h", "b", "2");
      const all = await redis.hgetall("h");
      expect(all).toEqual({ a: "1", b: "2" });
    });

    it("hgetall returns empty object for missing key", async () => {
      const redis = createMockRedis();
      expect(await redis.hgetall("missing")).toEqual({});
    });

    it("hsetnx only sets if field does not exist", async () => {
      const redis = createMockRedis();
      expect(await redis.hsetnx("h", "f", "first")).toBe(1);
      expect(await redis.hsetnx("h", "f", "second")).toBe(0);
      expect(await redis.hget("h", "f")).toBe("first");
    });

    it("hdel removes fields and returns count", async () => {
      const redis = createMockRedis();
      await redis.hset("h", "a", "1");
      await redis.hset("h", "b", "2");
      expect(await redis.hdel("h", "a", "c")).toBe(1);
      expect(await redis.hget("h", "a")).toBeNull();
      expect(await redis.hget("h", "b")).toBe("2");
    });
  });

  describe("pub/sub operations", () => {
    it("publish delivers to subscribers", async () => {
      const redis = createMockRedis();
      const received: string[] = [];
      await redis.subscribe("ch1", (_channel, message) => {
        received.push(message);
      });
      await redis.publish("ch1", "hello");
      expect(received).toEqual(["hello"]);
    });

    it("publish returns subscriber count", async () => {
      const redis = createMockRedis();
      await redis.subscribe("ch1", () => {
        // intentional no-op handler for test
      });
      await redis.subscribe("ch1", () => {
        // intentional no-op handler for test
      });
      const count = await redis.publish("ch1", "msg");
      expect(count).toBe(2);
    });

    it("unsubscribe removes all handlers for a channel", async () => {
      const redis = createMockRedis();
      const received: string[] = [];
      await redis.subscribe("ch1", (_ch, msg) => received.push(msg));
      await redis.unsubscribe("ch1");
      await redis.publish("ch1", "after-unsub");
      expect(received).toEqual([]);
    });
  });

  describe("pipeline operations", () => {
    it("runs batched commands", async () => {
      const redis = createMockRedis();
      const results = await redis
        .pipeline()
        .set("k1", "v1")
        .set("k2", "v2")
        .get("k1")
        .exec();

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual([null, "OK"]);
      expect(results[1]).toEqual([null, "OK"]);
      expect(results[2]).toEqual([null, "v1"]);
    });
  });

  describe("lifecycle operations", () => {
    it("disconnect clears all data", async () => {
      const redis = createMockRedis();
      await redis.set("k", "v");
      await redis.hset("h", "f", "v");
      await redis.disconnect();
      expect(await redis.get("k")).toBeNull();
      expect(await redis.hgetall("h")).toEqual({});
    });

    it("_reset clears data without destroying the mock", async () => {
      const redis = createMockRedis();
      await redis.set("k", "v");
      redis._reset();
      expect(await redis.get("k")).toBeNull();
      // Mock is still functional
      await redis.set("k2", "v2");
      expect(await redis.get("k2")).toBe("v2");
    });
  });
});

// ============================================================================
// Mock Context
// ============================================================================

describe("createMockContext", () => {
  it("has required properties with generated IDs", () => {
    const ctx = createMockContext();
    expect(ctx.userId).toMatch(USR_PREFIX_RE);
    expect(ctx.orgId).toMatch(ORG_PREFIX_RE);
    expect(ctx.requestId).toMatch(REQ_PREFIX_RE);
    expect(ctx.sessionId).toBeUndefined();
    expect(ctx.db).toBeDefined();
    expect(ctx.redis).toBeDefined();
  });

  it("allows overriding specific properties", () => {
    const ctx = createMockContext({
      userId: "usr_custom",
      orgId: "org_custom",
      sessionId: "ses_custom",
    });
    expect(ctx.userId).toBe("usr_custom");
    expect(ctx.orgId).toBe("org_custom");
    expect(ctx.sessionId).toBe("ses_custom");
  });

  it("provides a mock db with chainable methods", () => {
    const ctx = createMockContext();
    const db = ctx.db as Record<string, unknown>;
    expect(db.select).toBeDefined();
    expect(db.insert).toBeDefined();
    expect(db.update).toBeDefined();
    expect(db.delete).toBeDefined();
    expect(db.transaction).toBeDefined();
  });

  it("provides a functional mock redis", async () => {
    const ctx = createMockContext();
    const redis = ctx.redis as ReturnType<typeof createMockRedis>;
    await redis.set("test", "value");
    expect(await redis.get("test")).toBe("value");
  });
});

// ============================================================================
// Mock Event Publisher
// ============================================================================

describe("createMockEventPublisher", () => {
  it("starts with empty events", () => {
    const publisher = createMockEventPublisher();
    expect(publisher.events).toEqual([]);
  });

  it("records session events", async () => {
    const publisher = createMockEventPublisher();
    await publisher.publishSessionEvent("ses_123", {
      type: "agent_output",
      data: { content: "Hello" },
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.type).toBe("session");
    expect(publisher.events[0]?.channel).toBe("session:ses_123:events");
  });

  it("records fleet events", async () => {
    const publisher = createMockEventPublisher();
    await publisher.publishFleetEvent("org_123", {
      type: "task_dispatched",
      data: { taskId: "tsk_1" },
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.type).toBe("fleet");
    expect(publisher.events[0]?.channel).toBe("fleet:events");
  });

  it("records notification events", async () => {
    const publisher = createMockEventPublisher();
    await publisher.publishNotification("usr_123", {
      type: "task_complete",
      title: "Task Done",
      message: "Your task is complete",
    });
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.type).toBe("notification");
    expect(publisher.events[0]?.channel).toBe("user:usr_123:notifications");
  });

  it("records queue position events", async () => {
    const publisher = createMockEventPublisher();
    await publisher.publishQueuePosition("ses_123", {
      taskId: "tsk_1",
      position: 3,
      estimatedWaitSeconds: 120,
      totalInQueue: 10,
    });
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.type).toBe("queue_position");
  });

  it("getEventsByType filters correctly", async () => {
    const publisher = createMockEventPublisher();
    await publisher.publishSessionEvent("ses_1", {
      type: "agent_output",
      data: {},
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    await publisher.publishFleetEvent("org_1", {
      type: "dispatch",
      data: {},
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    await publisher.publishSessionEvent("ses_2", {
      type: "error",
      data: {},
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(publisher.getEventsByType("session")).toHaveLength(2);
    expect(publisher.getEventsByType("fleet")).toHaveLength(1);
    expect(publisher.getEventsByType("notification")).toHaveLength(0);
  });

  it("reset clears all recorded events", async () => {
    const publisher = createMockEventPublisher();
    await publisher.publishSessionEvent("ses_1", {
      type: "agent_output",
      data: {},
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    expect(publisher.events).toHaveLength(1);
    publisher.reset();
    expect(publisher.events).toHaveLength(0);
  });

  it("preserves event order", async () => {
    const publisher = createMockEventPublisher();
    await publisher.publishSessionEvent("ses_1", {
      type: "agent_output",
      data: { order: 1 },
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    await publisher.publishFleetEvent("org_1", {
      type: "dispatch",
      data: { order: 2 },
      timestamp: "2025-01-01T00:00:01.000Z",
    });
    await publisher.publishNotification("usr_1", {
      type: "alert",
      title: "Alert",
      message: "msg",
      data: { order: 3 },
    });

    expect(publisher.events[0]?.type).toBe("session");
    expect(publisher.events[1]?.type).toBe("fleet");
    expect(publisher.events[2]?.type).toBe("notification");
  });
});
