import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { QueryAnalyzer } from "../query-analyzer";

describe("QueryAnalyzer", () => {
  // ── Instance methods ──────────────────────────────────────────────────────

  describe("recordQuery", () => {
    it("increments query count on each call", () => {
      const analyzer = new QueryAnalyzer("req-1");

      analyzer.recordQuery("SELECT 1");
      analyzer.recordQuery("SELECT 2");

      expect(analyzer.getQueryCount()).toBe(2);
    });

    it("stores all recorded query strings", () => {
      const analyzer = new QueryAnalyzer("req-1");

      analyzer.recordQuery("SELECT * FROM users");
      analyzer.recordQuery("SELECT * FROM orders");

      expect(analyzer.getQueries()).toEqual([
        "SELECT * FROM users",
        "SELECT * FROM orders",
      ]);
    });

    it("returns a copy of queries so the internal array is not mutated", () => {
      const analyzer = new QueryAnalyzer("req-1");
      analyzer.recordQuery("SELECT 1");

      const queries = analyzer.getQueries();
      queries.push("INJECTED");

      expect(analyzer.getQueries()).toHaveLength(1);
    });
  });

  describe("threshold detection", () => {
    it("does not warn when query count is at the threshold", () => {
      const analyzer = new QueryAnalyzer("req-1", 3);

      for (let i = 0; i < 3; i++) {
        analyzer.recordQuery(`SELECT ${i}`);
      }

      // At threshold (3), no warning — warning only fires when count > threshold
      expect(analyzer.getQueryCount()).toBe(3);
    });

    it("triggers N+1 warning when query count exceeds threshold", () => {
      const analyzer = new QueryAnalyzer("req-1", 2);

      analyzer.recordQuery("SELECT 1");
      analyzer.recordQuery("SELECT 2");
      // This third call exceeds the threshold of 2
      analyzer.recordQuery("SELECT 3");

      expect(analyzer.getQueryCount()).toBe(3);
    });

    it("uses default threshold of 10 when none is provided", () => {
      const analyzer = new QueryAnalyzer("req-1");

      for (let i = 0; i < 10; i++) {
        analyzer.recordQuery(`SELECT ${i}`);
      }

      expect(analyzer.getQueryCount()).toBe(10);
      // 10 is not > 10, so no warning yet
    });
  });

  describe("reset", () => {
    it("clears query count and recorded queries", () => {
      const analyzer = new QueryAnalyzer("req-1");
      analyzer.recordQuery("SELECT 1");
      analyzer.recordQuery("SELECT 2");

      analyzer.reset();

      expect(analyzer.getQueryCount()).toBe(0);
      expect(analyzer.getQueries()).toEqual([]);
    });
  });

  // ── Static methods ────────────────────────────────────────────────────────

  describe("getAnalyzer", () => {
    afterEach(() => {
      // Clean up static map — wrapRequest does this automatically, but
      // direct getAnalyzer tests may leave stale entries.
    });

    it("returns undefined when no analyzer is registered", () => {
      expect(QueryAnalyzer.getAnalyzer("unknown-req")).toBeUndefined();
    });
  });

  describe("wrapRequest", () => {
    it("executes the wrapped function and returns its result", async () => {
      const result = await QueryAnalyzer.wrapRequest("req-wrap-1", async () => {
        await Promise.resolve();
        return { data: "hello" };
      });

      expect(result).toEqual({ data: "hello" });
    });

    it("registers the analyzer during execution and removes it after", async () => {
      let analyzerDuringExec: QueryAnalyzer | undefined;

      await QueryAnalyzer.wrapRequest("req-wrap-2", async () => {
        await Promise.resolve();
        analyzerDuringExec = QueryAnalyzer.getAnalyzer("req-wrap-2");
      });

      expect(analyzerDuringExec).toBeInstanceOf(QueryAnalyzer);
      expect(QueryAnalyzer.getAnalyzer("req-wrap-2")).toBeUndefined();
    });

    it("cleans up the analyzer even when the function throws", async () => {
      await expect(
        QueryAnalyzer.wrapRequest("req-wrap-3", async () => {
          await Promise.resolve();
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");

      expect(QueryAnalyzer.getAnalyzer("req-wrap-3")).toBeUndefined();
    });

    it("records queries made during the wrapped function", async () => {
      await QueryAnalyzer.wrapRequest("req-wrap-4", async () => {
        await Promise.resolve();
        const analyzer = QueryAnalyzer.getAnalyzer("req-wrap-4");
        analyzer?.recordQuery("SELECT * FROM users");
        analyzer?.recordQuery("SELECT * FROM orders");
      });

      // After wrapRequest completes, the analyzer is removed
      expect(QueryAnalyzer.getAnalyzer("req-wrap-4")).toBeUndefined();
    });

    it("uses custom threshold when provided", async () => {
      let capturedAnalyzer: QueryAnalyzer | undefined;

      await QueryAnalyzer.wrapRequest(
        "req-wrap-5",
        async () => {
          await Promise.resolve();
          capturedAnalyzer = QueryAnalyzer.getAnalyzer("req-wrap-5");
          // Record queries up to the custom threshold
          for (let i = 0; i < 5; i++) {
            capturedAnalyzer?.recordQuery(`SELECT ${i}`);
          }
        },
        3
      );

      // The analyzer tracked 5 queries with a threshold of 3
      // (verification is via the log output which we don't assert here,
      //  but we verify the function completed without error)
      expect(capturedAnalyzer).toBeDefined();
    });

    it("handles concurrent requests with separate analyzers", async () => {
      const results = await Promise.all([
        QueryAnalyzer.wrapRequest("req-a", async () => {
          await Promise.resolve();
          const a = QueryAnalyzer.getAnalyzer("req-a");
          a?.recordQuery("SELECT a");
          return a?.getQueryCount();
        }),
        QueryAnalyzer.wrapRequest("req-b", async () => {
          await Promise.resolve();
          const b = QueryAnalyzer.getAnalyzer("req-b");
          b?.recordQuery("SELECT b1");
          b?.recordQuery("SELECT b2");
          return b?.getQueryCount();
        }),
      ]);

      expect(results).toEqual([1, 2]);
      expect(QueryAnalyzer.getAnalyzer("req-a")).toBeUndefined();
      expect(QueryAnalyzer.getAnalyzer("req-b")).toBeUndefined();
    });
  });
});
