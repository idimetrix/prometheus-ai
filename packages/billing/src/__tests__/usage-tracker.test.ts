import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue(undefined),
});

const selectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
};

mockSelect.mockReturnValue(selectChain);

vi.mock("@prometheus/db", () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    select: (...args: unknown[]) => mockSelect(...args),
  },
  modelUsage: {
    orgId: "orgId",
    model: "model",
    tokensIn: "tokensIn",
    tokensOut: "tokensOut",
    costUsd: "costUsd",
    createdAt: "createdAt",
    taskId: "taskId",
  },
  usageRollups: {},
  creditTransactions: {
    orgId: "orgId",
    type: "type",
    amount: "amount",
    createdAt: "createdAt",
  },
}));

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock123`),
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { UsageRecord } from "../usage-tracker";
import { UsageTracker } from "../usage-tracker";

describe("UsageTracker", () => {
  let tracker: UsageTracker;

  const baseRecord: UsageRecord = {
    orgId: "org_1",
    sessionId: "ses_1",
    taskId: "task_1",
    provider: "ollama",
    model: "qwen3-coder",
    tokensIn: 500,
    tokensOut: 200,
    costUsd: 0.0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new UsageTracker();
    // Reset the select chain mocks
    selectChain.from.mockReturnThis();
    selectChain.where.mockReturnThis();
    selectChain.groupBy.mockReturnThis();
    selectChain.orderBy.mockReturnThis();
  });

  // ── recordUsage ──────────────────────────────────────────────────────────

  describe("recordUsage", () => {
    it("inserts record into model_usage table", async () => {
      await tracker.recordUsage(baseRecord);
      expect(mockInsert).toHaveBeenCalled();
    });

    it("generates unique ID with mu_ prefix", async () => {
      const { generateId } = await import("@prometheus/utils");
      await tracker.recordUsage(baseRecord);
      expect(generateId).toHaveBeenCalledWith("mu");
    });

    it("records all fields from the usage record", async () => {
      await tracker.recordUsage(baseRecord);
      const insertCall = mockInsert.mock.results[0]?.value;
      expect(insertCall.values).toHaveBeenCalled();
    });

    it("handles zero-cost local model usage", async () => {
      const localRecord = { ...baseRecord, costUsd: 0.0, provider: "ollama" };
      await tracker.recordUsage(localRecord);
      expect(mockInsert).toHaveBeenCalled();
    });

    it("handles expensive cloud model usage", async () => {
      const cloudRecord = {
        ...baseRecord,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        costUsd: 0.05,
      };
      await tracker.recordUsage(cloudRecord);
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── getUsageSummary ──────────────────────────────────────────────────────

  describe("getUsageSummary", () => {
    const start = new Date("2025-01-01");
    const end = new Date("2025-01-31");

    it("aggregates total tokens and cost", async () => {
      // First select call returns summary
      selectChain.where.mockResolvedValueOnce([
        {
          totalTokensIn: 10_000,
          totalTokensOut: 5000,
          totalCost: 0.5,
          count: 25,
        },
      ]);
      // Second select call returns by-model breakdown
      selectChain.groupBy.mockResolvedValueOnce([
        { model: "qwen3-coder", tokens: 12_000, cost: 0.0, count: 20 },
        { model: "claude-sonnet", tokens: 3000, cost: 0.5, count: 5 },
      ]);

      const result = await tracker.getUsageSummary("org_1", start, end);

      expect(result.totalTokens).toBe(15_000); // 10000 + 5000
      expect(result.totalCostUsd).toBe(0.5);
      expect(result.taskCount).toBe(25);
    });

    it("returns by-model breakdown", async () => {
      selectChain.where.mockResolvedValueOnce([
        {
          totalTokensIn: 5000,
          totalTokensOut: 2000,
          totalCost: 0.25,
          count: 10,
        },
      ]);
      selectChain.groupBy.mockResolvedValueOnce([
        { model: "qwen3-coder", tokens: 5000, cost: 0.0, count: 8 },
        { model: "claude-sonnet", tokens: 2000, cost: 0.25, count: 2 },
      ]);

      const result = await tracker.getUsageSummary("org_1", start, end);

      expect(result.byModel["qwen3-coder"]).toBeDefined();
      expect(result.byModel["qwen3-coder"]?.tokens).toBe(5000);
      expect(result.byModel["claude-sonnet"]?.cost).toBe(0.25);
    });

    it("returns zeros when no usage data exists", async () => {
      selectChain.where.mockResolvedValueOnce([
        {
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalCost: 0,
          count: 0,
        },
      ]);
      selectChain.groupBy.mockResolvedValueOnce([]);

      const result = await tracker.getUsageSummary("org_1", start, end);

      expect(result.totalTokens).toBe(0);
      expect(result.totalCostUsd).toBe(0);
      expect(result.taskCount).toBe(0);
      expect(Object.keys(result.byModel)).toHaveLength(0);
    });

    it("handles null summary row gracefully", async () => {
      selectChain.where.mockResolvedValueOnce([undefined]);
      selectChain.groupBy.mockResolvedValueOnce([]);

      const result = await tracker.getUsageSummary("org_1", start, end);
      expect(result.totalTokens).toBe(0);
    });
  });

  // ── calculateMargin ──────────────────────────────────────────────────────

  describe("calculateMargin", () => {
    const start = new Date("2025-01-01");
    const end = new Date("2025-01-31");

    it("computes revenue vs cost and margin", async () => {
      // credit consumption query
      selectChain.where.mockResolvedValueOnce([{ consumed: 100 }]);
      // getUsageSummary inner calls
      selectChain.where.mockResolvedValueOnce([
        {
          totalTokensIn: 50_000,
          totalTokensOut: 20_000,
          totalCost: 5.0,
          count: 50,
        },
      ]);
      selectChain.groupBy.mockResolvedValueOnce([]);

      const result = await tracker.calculateMargin("org_1", start, end);

      // 100 credits * $0.10 = $10 revenue
      expect(result.creditRevenue).toBe(10);
      expect(result.actualCost).toBe(5);
      expect(result.margin).toBe(5);
      expect(result.marginPercent).toBe(50);
    });

    it("returns zero margin when no credits consumed", async () => {
      selectChain.where.mockResolvedValueOnce([{ consumed: 0 }]);
      selectChain.where.mockResolvedValueOnce([
        {
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalCost: 0,
          count: 0,
        },
      ]);
      selectChain.groupBy.mockResolvedValueOnce([]);

      const result = await tracker.calculateMargin("org_1", start, end);

      expect(result.creditRevenue).toBe(0);
      expect(result.margin).toBe(0);
      expect(result.marginPercent).toBe(0);
    });

    it("handles negative margin (cost exceeds revenue)", async () => {
      selectChain.where.mockResolvedValueOnce([{ consumed: 10 }]);
      selectChain.where.mockResolvedValueOnce([
        {
          totalTokensIn: 100_000,
          totalTokensOut: 50_000,
          totalCost: 5.0,
          count: 10,
        },
      ]);
      selectChain.groupBy.mockResolvedValueOnce([]);

      const result = await tracker.calculateMargin("org_1", start, end);

      // 10 * $0.10 = $1 revenue, $5 cost = -$4 margin
      expect(result.creditRevenue).toBe(1);
      expect(result.actualCost).toBe(5);
      expect(result.margin).toBe(-4);
    });
  });

  // ── createDailyRollup ────────────────────────────────────────────────────

  describe("createDailyRollup", () => {
    it("creates a rollup record for the specified date", async () => {
      // getUsageSummary inner calls
      selectChain.where.mockResolvedValueOnce([
        {
          totalTokensIn: 5000,
          totalTokensOut: 2000,
          totalCost: 0.25,
          count: 10,
        },
      ]);
      selectChain.groupBy.mockResolvedValueOnce([]);

      await tracker.createDailyRollup("org_1", new Date("2025-06-15"));
      expect(mockInsert).toHaveBeenCalled();
    });
  });
});
