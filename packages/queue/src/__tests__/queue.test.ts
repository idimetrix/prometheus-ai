import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("ioredis", () => {
  class MockIORedis {
    publish = vi.fn().mockResolvedValue(1);
    incr = vi.fn().mockResolvedValue(1);
    xadd = vi.fn().mockResolvedValue("1-0");
    xrange = vi.fn().mockResolvedValue([]);
    xlen = vi.fn().mockResolvedValue(0);
    del = vi.fn().mockResolvedValue(1);
    get = vi.fn().mockResolvedValue(null);
    zadd = vi.fn().mockResolvedValue(1);
    zcard = vi.fn().mockResolvedValue(0);
    zrange = vi.fn().mockResolvedValue([]);
    zremrangebyscore = vi.fn().mockResolvedValue(0);
    pexpire = vi.fn().mockResolvedValue(1);
    pipeline = vi.fn(() => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 0],
        [null, 0],
      ]),
    }));
  }
  return { default: MockIORedis };
});

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { createRedisConnection } from "../connection";
import { EventStream } from "../event-stream";
import { QueueEvents } from "../events";
import {
  getConcurrencyForTier,
  routeTaskToQueue,
  TIER_CONCURRENCY,
  TIER_PRIORITY,
} from "../priority";
import {
  DEFAULT_DLQ_CONFIG,
  getPriorityForTier,
  getRateLimitForTier,
  JobPriority,
  RateLimits,
  RetryPolicies,
} from "../types";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Redis Connection", () => {
  it("creates a redis connection using createRedisConnection", () => {
    const conn = createRedisConnection();
    expect(conn).toBeDefined();
  });

  it("returns an object with standard redis methods", () => {
    const conn = createRedisConnection();
    expect(typeof conn.publish).toBe("function");
  });
});

describe("QueueEvents constants", () => {
  it("has AGENT_OUTPUT event", () => {
    expect(QueueEvents.AGENT_OUTPUT).toBe("agent:output");
  });

  it("has AGENT_STATUS event", () => {
    expect(QueueEvents.AGENT_STATUS).toBe("agent:status");
  });

  it("has TASK_STATUS event", () => {
    expect(QueueEvents.TASK_STATUS).toBe("task:status");
  });

  it("has FILE_CHANGE event", () => {
    expect(QueueEvents.FILE_CHANGE).toBe("file:change");
  });

  it("has ERROR event", () => {
    expect(QueueEvents.ERROR).toBe("error");
  });

  it("has all expected events defined", () => {
    const expectedKeys = [
      "AGENT_OUTPUT",
      "AGENT_STATUS",
      "FILE_CHANGE",
      "PLAN_UPDATE",
      "TASK_STATUS",
      "QUEUE_POSITION",
      "CREDIT_UPDATE",
      "CHECKPOINT",
      "ERROR",
      "REASONING",
      "TERMINAL_OUTPUT",
      "BROWSER_SCREENSHOT",
      "SESSION_RESUME",
    ];
    for (const key of expectedKeys) {
      expect(QueueEvents).toHaveProperty(key);
    }
  });
});

describe("JobPriority", () => {
  it("defines CRITICAL as highest priority (1)", () => {
    expect(JobPriority.CRITICAL).toBe(1);
  });

  it("defines HIGH as 2", () => {
    expect(JobPriority.HIGH).toBe(2);
  });

  it("defines NORMAL as 5", () => {
    expect(JobPriority.NORMAL).toBe(5);
  });

  it("defines LOW as 10", () => {
    expect(JobPriority.LOW).toBe(10);
  });

  it("orders priorities correctly: CRITICAL < HIGH < NORMAL < LOW", () => {
    expect(JobPriority.CRITICAL).toBeLessThan(JobPriority.HIGH);
    expect(JobPriority.HIGH).toBeLessThan(JobPriority.NORMAL);
    expect(JobPriority.NORMAL).toBeLessThan(JobPriority.LOW);
  });
});

describe("RetryPolicies", () => {
  it("critical policy has 10 attempts with exponential backoff", () => {
    expect(RetryPolicies.critical.attempts).toBe(10);
    expect(RetryPolicies.critical.backoff.type).toBe("exponential");
    expect(RetryPolicies.critical.backoff.delay).toBe(10_000);
  });

  it("standard policy has 5 attempts", () => {
    expect(RetryPolicies.standard.attempts).toBe(5);
    expect(RetryPolicies.standard.backoff.delay).toBe(5000);
  });

  it("light policy has 3 attempts with shorter delay", () => {
    expect(RetryPolicies.light.attempts).toBe(3);
    expect(RetryPolicies.light.backoff.delay).toBe(2000);
  });

  it("oneShot policy has 1 attempt and no delay", () => {
    expect(RetryPolicies.oneShot.attempts).toBe(1);
    expect(RetryPolicies.oneShot.backoff.delay).toBe(0);
  });
});

describe("RateLimits", () => {
  it("defines rate limits for all plan tiers", () => {
    const tiers = ["hobby", "starter", "pro", "team", "studio", "enterprise"];
    for (const tier of tiers) {
      expect(RateLimits[tier]).toBeDefined();
      expect(RateLimits[tier]?.max).toBeGreaterThan(0);
      expect(RateLimits[tier]?.windowMs).toBeGreaterThan(0);
    }
  });

  it("enterprise has highest rate limit", () => {
    const enterpriseMax = RateLimits.enterprise?.max ?? 0;
    const hobbyMax = RateLimits.hobby?.max ?? 0;
    expect(enterpriseMax).toBeGreaterThan(hobbyMax);
  });

  it("getRateLimitForTier returns correct config for known tiers", () => {
    const proLimit = getRateLimitForTier("pro" as never);
    expect(proLimit.max).toBe(50);
  });

  it("getRateLimitForTier falls back to hobby for unknown tiers", () => {
    const limit = getRateLimitForTier("unknown_tier" as never);
    expect(limit.max).toBe(RateLimits.hobby?.max);
  });
});

describe("getPriorityForTier", () => {
  it("returns CRITICAL for enterprise", () => {
    expect(getPriorityForTier("enterprise" as never)).toBe(
      JobPriority.CRITICAL
    );
  });

  it("returns HIGH for studio", () => {
    expect(getPriorityForTier("studio" as never)).toBe(JobPriority.HIGH);
  });

  it("returns NORMAL for pro", () => {
    expect(getPriorityForTier("pro" as never)).toBe(JobPriority.NORMAL);
  });

  it("returns LOW for hobby", () => {
    expect(getPriorityForTier("hobby" as never)).toBe(JobPriority.LOW);
  });

  it("defaults to NORMAL for unknown tiers", () => {
    expect(getPriorityForTier("mystery" as never)).toBe(JobPriority.NORMAL);
  });
});

describe("DEFAULT_DLQ_CONFIG", () => {
  it("has 5 max retries", () => {
    expect(DEFAULT_DLQ_CONFIG.maxRetries).toBe(5);
  });

  it("uses -dlq suffix", () => {
    expect(DEFAULT_DLQ_CONFIG.queueSuffix).toBe("-dlq");
  });

  it("has 7-day TTL", () => {
    expect(DEFAULT_DLQ_CONFIG.ttlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("TIER_PRIORITY", () => {
  it("enterprise has lowest value (highest priority)", () => {
    expect(TIER_PRIORITY.enterprise).toBe(1);
  });

  it("hobby has highest value (lowest priority)", () => {
    expect(TIER_PRIORITY.hobby).toBe(100);
  });

  it("priorities increase from enterprise to hobby", () => {
    expect(TIER_PRIORITY.enterprise).toBeLessThan(
      TIER_PRIORITY.studio ?? Number.POSITIVE_INFINITY
    );
    expect(TIER_PRIORITY.studio).toBeLessThan(
      TIER_PRIORITY.team ?? Number.POSITIVE_INFINITY
    );
  });
});

describe("TIER_CONCURRENCY", () => {
  it("enterprise has highest concurrency", () => {
    expect(TIER_CONCURRENCY.enterprise).toBe(50);
  });

  it("hobby has lowest concurrency", () => {
    expect(TIER_CONCURRENCY.hobby).toBe(1);
  });

  it("getConcurrencyForTier returns correct value", () => {
    expect(getConcurrencyForTier("pro")).toBe(5);
  });

  it("getConcurrencyForTier defaults to 1 for unknown tiers", () => {
    expect(getConcurrencyForTier("nonexistent")).toBe(1);
  });
});

describe("routeTaskToQueue", () => {
  it("routes enterprise to priority queue", () => {
    const result = routeTaskToQueue("enterprise");
    expect(result.queueName).toBe("tasks:priority");
    expect(result.priority).toBe(1);
    expect(result.concurrency).toBe(50);
  });

  it("routes studio to priority queue", () => {
    const result = routeTaskToQueue("studio");
    expect(result.queueName).toBe("tasks:priority");
    expect(result.priority).toBe(5);
  });

  it("routes pro to standard queue", () => {
    const result = routeTaskToQueue("pro");
    expect(result.queueName).toBe("tasks:standard");
    expect(result.priority).toBe(20);
  });

  it("routes hobby to default queue", () => {
    const result = routeTaskToQueue("hobby");
    expect(result.queueName).toBe("tasks:default");
    expect(result.priority).toBe(100);
  });

  it("routes unknown tiers to default queue", () => {
    const result = routeTaskToQueue("unknown");
    expect(result.queueName).toBe("tasks:default");
  });
});

describe("EventStream", () => {
  let stream: EventStream;

  beforeEach(() => {
    stream = new EventStream();
  });

  it("creates an EventStream instance", () => {
    expect(stream).toBeDefined();
  });

  it("append returns a stream entry ID", async () => {
    const entryId = await stream.append("ses_1", {
      type: "test",
      data: { foo: "bar" },
      timestamp: new Date().toISOString(),
    });
    expect(typeof entryId).toBe("string");
  });

  it("readAfter returns an array", async () => {
    const events = await stream.readAfter("ses_1", "0");
    expect(Array.isArray(events)).toBe(true);
  });

  it("readRange returns an array", async () => {
    const events = await stream.readRange("ses_1");
    expect(Array.isArray(events)).toBe(true);
  });
});
