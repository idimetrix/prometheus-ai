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
    publishSessionEvent = (...args: unknown[]) =>
      mockPublishSessionEvent(...args);
  },
  QueueEvents: {
    CREDIT_UPDATE: "credit:update",
  },
}));

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock123`),
}));

// Use a shared object to avoid hoisting issues
const dbMocks = {
  txSelectResult: [{ balance: 1000, reserved: 100 }] as Array<{
    balance: number;
    reserved: number;
  }>,
  transactionError: null as Error | null,
};

vi.mock("@prometheus/db", () => {
  return {
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        if (dbMocks.transactionError) {
          throw dbMocks.transactionError;
        }
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi
                  .fn()
                  .mockImplementation(async () => dbMocks.txSelectResult),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return await fn(tx);
      }),
    },
    creditBalances: {
      orgId: "orgId",
      balance: "balance",
      reserved: "reserved",
    },
    creditReservations: {
      id: "id",
      orgId: "orgId",
      taskId: "taskId",
      status: "status",
    },
    creditTransactions: { id: "id", orgId: "orgId" },
  };
});

import { CreditTracker } from "../credit-tracker";

describe("CreditTracker", () => {
  let tracker: CreditTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.txSelectResult = [{ balance: 1000, reserved: 100 }];
    dbMocks.transactionError = null;
    tracker = new CreditTracker("org_1", "ses_1", "task_1");
  });

  describe("estimateCost (static)", () => {
    it("estimates 'ask' tier for ask mode", () => {
      const result = CreditTracker.estimateCost("ask", "What is X?");
      expect(result.tier).toBe("ask");
      expect(result.estimatedCredits).toBe(2);
      expect(result.mode).toBe("ask");
    });

    it("estimates 'plan' tier for plan mode", () => {
      const result = CreditTracker.estimateCost("plan", "Create a plan");
      expect(result.tier).toBe("plan");
      expect(result.estimatedCredits).toBe(10);
    });

    it("estimates 'simple' for short descriptions in task mode", () => {
      const result = CreditTracker.estimateCost("task", "Fix the bug");
      expect(result.tier).toBe("simple");
      expect(result.estimatedCredits).toBe(5);
    });

    it("estimates 'medium' for medium descriptions (100-500 chars)", () => {
      const desc = "a".repeat(200);
      const result = CreditTracker.estimateCost("task", desc);
      expect(result.tier).toBe("medium");
      expect(result.estimatedCredits).toBe(25);
    });

    it("estimates 'complex' for long descriptions (>500 chars)", () => {
      const desc = "a".repeat(600);
      const result = CreditTracker.estimateCost("task", desc);
      expect(result.tier).toBe("complex");
      expect(result.estimatedCredits).toBe(75);
    });
  });

  describe("reserve", () => {
    it("reserves credits when sufficient balance exists", async () => {
      // Default mock returns balance: 1000, reserved: 100 -> available: 900
      const success = await tracker.reserve(50);
      expect(success).toBe(true);
      expect(tracker.getReserved()).toBe(50);
    });

    it("fails to reserve when insufficient credits", async () => {
      dbMocks.txSelectResult = [{ balance: 10, reserved: 8 }];

      const success = await tracker.reserve(50);
      expect(success).toBe(false);
    });

    it("fails when no credit balance exists", async () => {
      dbMocks.txSelectResult = [];

      const success = await tracker.reserve(10);
      expect(success).toBe(false);
    });

    it("handles database errors gracefully", async () => {
      dbMocks.transactionError = new Error("DB connection lost");
      const success = await tracker.reserve(10);
      expect(success).toBe(false);
    });
  });

  describe("trackConsumption", () => {
    it("increments consumed credits based on token usage", async () => {
      await tracker.trackConsumption(5000); // 5000 tokens = 5 credits
      expect(tracker.getConsumed()).toBe(5);
    });

    it("publishes credit update events", async () => {
      await tracker.trackConsumption(1000);
      expect(mockPublishSessionEvent).toHaveBeenCalledWith(
        "ses_1",
        expect.objectContaining({
          type: "credit:update",
          data: expect.objectContaining({
            consumed: 1,
            totalConsumed: 1,
          }),
        })
      );
    });

    it("accumulates consumption across multiple calls", async () => {
      await tracker.trackConsumption(2000);
      await tracker.trackConsumption(3000);
      expect(tracker.getConsumed()).toBe(5); // 2 + 3
    });
  });

  describe("getters", () => {
    it("getRemaining returns reserved minus consumed", async () => {
      await tracker.reserve(100);
      await tracker.trackConsumption(30_000); // 30 credits
      expect(tracker.getReserved()).toBe(100);
      expect(tracker.getConsumed()).toBe(30);
      expect(tracker.getRemaining()).toBe(70);
    });
  });

  describe("finalize", () => {
    it("returns consumed and refunded amounts", async () => {
      await tracker.reserve(100);
      await tracker.trackConsumption(20_000); // 20 credits
      const result = await tracker.finalize();
      expect(result.consumed).toBe(20);
      expect(result.refunded).toBe(80);
    });

    it("handles finalize failure gracefully", async () => {
      await tracker.reserve(100);
      await tracker.trackConsumption(10_000);
      // Next transaction call will fail
      dbMocks.transactionError = new Error("DB error");

      const result = await tracker.finalize();
      expect(result.consumed).toBe(10);
      expect(result.refunded).toBe(0); // 0 on error
    });
  });

  describe("refundAll", () => {
    it("does nothing when no reservation exists", async () => {
      const { db } = await import("@prometheus/db");
      vi.mocked(db.transaction).mockClear();
      await tracker.refundAll();
      // Should not call transaction since no reservation
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("handles refund failure gracefully", async () => {
      await tracker.reserve(50);
      dbMocks.transactionError = new Error("Refund failed");
      // Should not throw
      await expect(tracker.refundAll()).resolves.toBeUndefined();
    });
  });
});
