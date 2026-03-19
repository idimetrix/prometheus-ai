import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  getCached,
  getL1Cache,
  invalidateCacheKey,
  invalidateCachePattern,
  setCacheRedis,
} from "../cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRedis() {
  return {
    get: vi
      .fn<(key: string) => Promise<string | null>>()
      .mockResolvedValue(null),
    set: vi
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue("OK"),
    del: vi.fn<(...args: string[]) => Promise<unknown>>().mockResolvedValue(1),
    scan: vi
      .fn<(cursor: string, ...args: unknown[]) => Promise<[string, string[]]>>()
      .mockResolvedValue(["0", []]),
    sadd: vi
      .fn<(key: string, ...members: string[]) => Promise<unknown>>()
      .mockResolvedValue(1),
    smembers: vi.fn<(key: string) => Promise<string[]>>().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cache", () => {
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    redis = createMockRedis();
    setCacheRedis(redis);
    // Clear L1 between tests
    getL1Cache().clear();
  });

  afterEach(() => {
    setCacheRedis(null as unknown as Parameters<typeof setCacheRedis>[0]);
    getL1Cache().clear();
  });

  // ── L1 cache unit tests ─────────────────────────────────────────────────

  describe("L1Cache", () => {
    it("stores and retrieves values", () => {
      const l1 = getL1Cache();
      l1.set("key1", "value1");

      expect(l1.get("key1")).toBe("value1");
    });

    it("returns null for missing keys", () => {
      const l1 = getL1Cache();
      expect(l1.get("nonexistent")).toBeNull();
    });

    it("deletes a key", () => {
      const l1 = getL1Cache();
      l1.set("key1", "value1");
      l1.delete("key1");

      expect(l1.get("key1")).toBeNull();
    });

    it("deletes keys matching a glob pattern", () => {
      const l1 = getL1Cache();
      l1.set("db:user:1", "a");
      l1.set("db:user:2", "b");
      l1.set("db:order:1", "c");

      const deleted = l1.deletePattern("db:user:*");

      expect(deleted).toBe(2);
      expect(l1.get("db:user:1")).toBeNull();
      expect(l1.get("db:user:2")).toBeNull();
      expect(l1.get("db:order:1")).toBe("c");
    });

    it("expires entries after TTL", () => {
      const l1 = getL1Cache();
      l1.set("ttl-key", "value");

      // Fast-forward time past the 30s TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(31_000);

      expect(l1.get("ttl-key")).toBeNull();
      vi.useRealTimers();
    });

    it("evicts oldest entry when at capacity", () => {
      const l1 = getL1Cache();
      // L1 default max is 1000. Fill to capacity + 1
      for (let i = 0; i < 1001; i++) {
        l1.set(`key-${i}`, `val-${i}`);
      }

      // Oldest key should have been evicted
      expect(l1.get("key-0")).toBeNull();
      // Newest should still be present
      expect(l1.get("key-1000")).toBe("val-1000");
    });

    it("tracks size correctly", () => {
      const l1 = getL1Cache();
      l1.set("a", "1");
      l1.set("b", "2");

      expect(l1.size).toBe(2);

      l1.delete("a");
      expect(l1.size).toBe(1);

      l1.clear();
      expect(l1.size).toBe(0);
    });
  });

  // ── Multi-tier getCached ────────────────────────────────────────────────

  describe("getCached (multi-tier)", () => {
    it("serves from L1 without hitting Redis", async () => {
      // Prime L1 directly
      getL1Cache().set("db:user:1", JSON.stringify({ id: 1, source: "l1" }));
      const fetcher = vi.fn();

      const result = await getCached("user:1", fetcher);

      expect(result).toEqual({ id: 1, source: "l1" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
    });

    it("falls through to L2 on L1 miss and promotes to L1", async () => {
      const data = { id: 2, source: "l2" };
      redis.get.mockResolvedValueOnce(JSON.stringify(data));
      const fetcher = vi.fn();

      const result = await getCached("user:2", fetcher);

      expect(result).toEqual(data);
      expect(fetcher).not.toHaveBeenCalled();
      expect(redis.get).toHaveBeenCalledWith("db:user:2");

      // Should now be in L1
      const l1Value = getL1Cache().get("db:user:2");
      expect(l1Value).toBe(JSON.stringify(data));
    });

    it("falls through to fetcher on L1+L2 miss and writes both tiers", async () => {
      const data = { id: 3, source: "fetcher" };
      const fetcher = vi.fn().mockResolvedValue(data);

      const result = await getCached("user:3", fetcher);

      expect(result).toEqual(data);
      expect(fetcher).toHaveBeenCalledOnce();

      // Written to L1
      const l1Value = getL1Cache().get("db:user:3");
      expect(l1Value).toBe(JSON.stringify(data));

      // Written to L2
      expect(redis.set).toHaveBeenCalledWith(
        "db:user:3",
        JSON.stringify(data),
        "EX",
        300
      );
    });

    it("returns cached value from Redis on cache hit", async () => {
      redis.get.mockResolvedValueOnce(
        JSON.stringify({ id: 1, name: "cached" })
      );
      const fetcher = vi.fn().mockResolvedValue({ id: 1, name: "fresh" });

      const result = await getCached("user:1", fetcher);

      expect(result).toEqual({ id: 1, name: "cached" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(redis.get).toHaveBeenCalledWith("db:user:1");
    });

    it("calls fetcher and writes to Redis on cache miss", async () => {
      const data = { id: 2, name: "fresh" };
      const fetcher = vi.fn().mockResolvedValue(data);

      const result = await getCached("user:2", fetcher);

      expect(result).toEqual(data);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(redis.set).toHaveBeenCalledWith(
        "db:user:2",
        JSON.stringify(data),
        "EX",
        300
      );
    });

    it("uses custom prefix and TTL", async () => {
      const data = { ok: true };
      const fetcher = vi.fn().mockResolvedValue(data);

      await getCached("key", fetcher, { prefix: "custom", ttlSeconds: 60 });

      expect(redis.get).toHaveBeenCalledWith("custom:key");
      expect(redis.set).toHaveBeenCalledWith(
        "custom:key",
        JSON.stringify(data),
        "EX",
        60
      );
    });

    it("falls back to fetcher when Redis read fails", async () => {
      redis.get.mockRejectedValueOnce(new Error("connection refused"));
      const data = { fallback: true };
      const fetcher = vi.fn().mockResolvedValue(data);

      const result = await getCached("key", fetcher);

      expect(result).toEqual(data);
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it("still returns result when Redis write fails", async () => {
      redis.set.mockRejectedValueOnce(new Error("write error"));
      const data = { ok: true };
      const fetcher = vi.fn().mockResolvedValue(data);

      const result = await getCached("key", fetcher);

      expect(result).toEqual(data);
      // L1 should still have the value even if L2 write failed
      expect(getL1Cache().get("db:key")).toBe(JSON.stringify(data));
    });

    it("calls fetcher directly when no Redis client is configured", async () => {
      setCacheRedis(null as unknown as Parameters<typeof setCacheRedis>[0]);
      const data = { no: "redis" };
      const fetcher = vi.fn().mockResolvedValue(data);

      const result = await getCached("key", fetcher);

      expect(result).toEqual(data);
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      // L1 should still be populated
      expect(getL1Cache().get("db:key")).toBe(JSON.stringify(data));
    });
  });

  // ── invalidateCacheKey ────────────────────────────────────────────────────

  describe("invalidateCacheKey", () => {
    it("deletes from both L1 and Redis with default prefix", async () => {
      getL1Cache().set("db:user:1", "cached");

      await invalidateCacheKey("user:1");

      expect(getL1Cache().get("db:user:1")).toBeNull();
      expect(redis.del).toHaveBeenCalledWith("db:user:1");
    });

    it("deletes the key from Redis with custom prefix", async () => {
      await invalidateCacheKey("session:5", "app");

      expect(redis.del).toHaveBeenCalledWith("app:session:5");
    });

    it("clears L1 even when no Redis client is configured", async () => {
      setCacheRedis(null as unknown as Parameters<typeof setCacheRedis>[0]);
      getL1Cache().set("db:key", "value");

      await invalidateCacheKey("key");

      expect(getL1Cache().get("db:key")).toBeNull();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it("swallows Redis errors gracefully", async () => {
      redis.del.mockRejectedValueOnce(new Error("del failed"));

      await expect(invalidateCacheKey("key")).resolves.toBeUndefined();
    });
  });

  // ── invalidateCachePattern ────────────────────────────────────────────────

  describe("invalidateCachePattern", () => {
    it("clears L1 pattern and scans+deletes Redis keys", async () => {
      getL1Cache().set("db:user:1", "a");
      getL1Cache().set("db:user:2", "b");
      redis.scan
        .mockResolvedValueOnce(["42", ["db:user:1", "db:user:2"]])
        .mockResolvedValueOnce(["0", ["db:user:3"]]);

      const deleted = await invalidateCachePattern("user:*");

      expect(deleted).toBe(3);
      expect(getL1Cache().get("db:user:1")).toBeNull();
      expect(getL1Cache().get("db:user:2")).toBeNull();
      expect(redis.del).toHaveBeenCalledTimes(2);
    });

    it("returns 0 when no keys match", async () => {
      redis.scan.mockResolvedValueOnce(["0", []]);

      const deleted = await invalidateCachePattern("nonexistent:*");

      expect(deleted).toBe(0);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it("returns 0 when no Redis client is configured", async () => {
      setCacheRedis(null as unknown as Parameters<typeof setCacheRedis>[0]);

      const deleted = await invalidateCachePattern("user:*");

      expect(deleted).toBe(0);
    });

    it("returns 0 and swallows errors on scan failure", async () => {
      redis.scan.mockRejectedValueOnce(new Error("scan failed"));

      const deleted = await invalidateCachePattern("user:*");

      expect(deleted).toBe(0);
    });

    it("uses custom prefix in scan MATCH pattern", async () => {
      redis.scan.mockResolvedValueOnce(["0", []]);

      await invalidateCachePattern("sess:*", "app");

      expect(redis.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "app:sess:*",
        "COUNT",
        100
      );
    });
  });
});
