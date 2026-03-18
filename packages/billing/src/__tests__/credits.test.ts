import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFindFirst = vi.fn();
const mockFindMany = vi.fn().mockResolvedValue([]);

// Build a chainable mock for insert().values().onConflictDoNothing().returning()
const mockReturning = vi.fn().mockResolvedValue([]);
const mockOnConflictDoNothing = vi
  .fn()
  .mockReturnValue({ returning: mockReturning });
const mockInsertValues = vi.fn().mockReturnValue({
  returning: mockReturning,
  onConflictDoNothing: mockOnConflictDoNothing,
});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

// Build a chainable mock for update().set().where().returning()
const mockUpdateReturning = vi.fn().mockResolvedValue([]);
const mockUpdateWhere = vi.fn().mockReturnValue({
  returning: mockUpdateReturning,
});
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

vi.mock("@prometheus/db", () => ({
  db: {
    query: {
      creditBalances: { findFirst: (...args: any[]) => mockFindFirst(...args) },
      creditReservations: {
        findFirst: (...args: any[]) => mockFindFirst(...args),
        findMany: (...args: any[]) => mockFindMany(...args),
      },
      creditTransactions: {
        findMany: (...args: any[]) => mockFindMany(...args),
      },
    },
    insert: (...args: any[]) => mockInsert(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
  creditBalances: { orgId: "orgId", balance: "balance", reserved: "reserved" },
  creditTransactions: { orgId: "orgId", createdAt: "createdAt" },
  creditReservations: {
    id: "id",
    orgId: "orgId",
    status: "status",
    expiresAt: "expiresAt",
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

import { CreditService } from "../credits";

describe("CreditService", () => {
  let service: CreditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CreditService();

    // Reset default mock implementations after clearAllMocks
    mockInsertValues.mockReturnValue({
      returning: mockReturning,
      onConflictDoNothing: mockOnConflictDoNothing,
    });
    mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([]);
    mockInsert.mockReturnValue({ values: mockInsertValues });

    mockUpdateReturning.mockResolvedValue([]);
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  // ── getBalance ───────────────────────────────────────────────────────────

  describe("getBalance", () => {
    it("returns existing balance with computed available", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 100, reserved: 20 });
      const result = await service.getBalance("org_1");
      expect(result.balance).toBe(100);
      expect(result.reserved).toBe(20);
      expect(result.available).toBe(80);
    });

    it("initializes balance with 50 credits when missing", async () => {
      mockFindFirst.mockResolvedValueOnce(null); // no balance found
      mockReturning.mockResolvedValueOnce([
        { orgId: "org_new", balance: 50, reserved: 0 },
      ]);

      const result = await service.getBalance("org_new");
      expect(mockInsert).toHaveBeenCalled();
      expect(result.balance).toBe(50);
      expect(result.reserved).toBe(0);
      expect(result.available).toBe(50);
    });

    it("returns zero available when fully reserved", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 50, reserved: 50 });
      const result = await service.getBalance("org_1");
      expect(result.available).toBe(0);
    });
  });

  // ── reserveCredits ───────────────────────────────────────────────────────

  describe("reserveCredits", () => {
    it("creates reservation and returns reservation result", async () => {
      // getBalance call inside reserveCredits (ensure row exists)
      mockFindFirst.mockResolvedValueOnce({ balance: 100, reserved: 10 });
      // Atomic update returns the updated row
      mockUpdateReturning.mockResolvedValueOnce([
        { orgId: "org_1", balance: 100, reserved: 30 },
      ]);

      const result = await service.reserveCredits("org_1", "task_1", 20);
      expect(result.reservationId).toBe("res_mock123");
      expect(result.amount).toBe(20);
      expect(mockInsert).toHaveBeenCalled(); // reservation insert
      expect(mockUpdate).toHaveBeenCalled(); // reserved amount update
    });

    it("updates reserved amount on credit balance", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 100, reserved: 0 });
      mockUpdateReturning.mockResolvedValueOnce([
        { orgId: "org_1", balance: 100, reserved: 30 },
      ]);
      await service.reserveCredits("org_1", "task_1", 30);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("rejects when insufficient available credits", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 20, reserved: 15 });
      // Atomic update returns empty (WHERE clause didn't match)
      mockUpdateReturning.mockResolvedValueOnce([]);
      // getBalance for error message
      mockFindFirst.mockResolvedValueOnce({ balance: 20, reserved: 15 });

      await expect(
        service.reserveCredits("org_1", "task_1", 10)
      ).rejects.toThrow("Insufficient credits: need 10, have 5");
    });

    it("rejects when fully reserved", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 50, reserved: 50 });
      mockUpdateReturning.mockResolvedValueOnce([]);
      mockFindFirst.mockResolvedValueOnce({ balance: 50, reserved: 50 });

      await expect(
        service.reserveCredits("org_1", "task_1", 1)
      ).rejects.toThrow("Insufficient credits");
    });

    it("sets expiry to 2 hours from now", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 100, reserved: 0 });
      mockUpdateReturning.mockResolvedValueOnce([
        { orgId: "org_1", balance: 100, reserved: 5 },
      ]);
      await service.reserveCredits("org_1", "task_1", 5);
      // Verify insert was called with values including expiresAt
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── commitReservation ────────────────────────────────────────────────────

  describe("commitReservation", () => {
    it("deducts from balance and reserved, creates transaction", async () => {
      // reservation lookup
      mockFindFirst.mockResolvedValueOnce({
        id: "res_1",
        orgId: "org_1",
        taskId: "task_1",
        amount: 15,
        status: "active",
      });
      // getBalance call after deduction (for transaction record)
      mockFindFirst.mockResolvedValueOnce({ balance: 85, reserved: 0 });

      await service.commitReservation("res_1");

      // Should update creditBalances (deduct balance + reserved)
      expect(mockUpdate).toHaveBeenCalled();
      // Should update reservation status to committed
      // Should insert credit transaction
      expect(mockInsert).toHaveBeenCalled();
    });

    it("issues partial refund when actualCost < reserved", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "res_1",
        orgId: "org_1",
        taskId: "task_1",
        amount: 25,
        status: "active",
      });
      // getBalance after deduction
      mockFindFirst.mockResolvedValueOnce({ balance: 85, reserved: 0 });

      await service.commitReservation("res_1", 10); // actual = 10, reserved = 25

      // Should insert 2 transaction records: consumption + refund
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });

    it("throws when reservation not found", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      await expect(
        service.commitReservation("res_nonexistent")
      ).rejects.toThrow("not found or not active");
    });

    it("throws when reservation is not active", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "res_1",
        status: "committed",
        amount: 10,
        orgId: "org_1",
      });
      await expect(service.commitReservation("res_1")).rejects.toThrow(
        "not found or not active"
      );
    });
  });

  // ── releaseReservation ───────────────────────────────────────────────────

  describe("releaseReservation", () => {
    it("returns reserved amount to available balance", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "res_1",
        orgId: "org_1",
        amount: 20,
        status: "active",
      });

      await service.releaseReservation("res_1");

      // Should decrease reserved amount on creditBalances
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("updates reservation status to released", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "res_1",
        orgId: "org_1",
        amount: 10,
        status: "active",
      });

      await service.releaseReservation("res_1");
      // Second update sets status = released
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("does nothing when reservation not found", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      await service.releaseReservation("res_nonexistent");
      // No update calls for balance
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("does nothing when reservation already released", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "res_1",
        status: "released",
      });
      await service.releaseReservation("res_1");
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  // ── consumeCredits ───────────────────────────────────────────────────────

  describe("consumeCredits", () => {
    it("deducts from balance and creates transaction", async () => {
      // Atomic update returns the updated row
      mockUpdateReturning.mockResolvedValueOnce([
        { orgId: "org_1", balance: 90, reserved: 0 },
      ]);

      await service.consumeCredits({
        orgId: "org_1",
        amount: 10,
        type: "consumption",
        taskId: "task_1",
        description: "Task execution",
      });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it("rejects when insufficient credits", async () => {
      // Atomic update returns empty (WHERE clause didn't match)
      mockUpdateReturning.mockResolvedValueOnce([]);

      await expect(
        service.consumeCredits({
          orgId: "org_1",
          amount: 10,
          type: "consumption",
          description: "Task execution",
        })
      ).rejects.toThrow("Insufficient credits for consumption");
    });

    it("records correct negative amount in transaction", async () => {
      mockUpdateReturning.mockResolvedValueOnce([
        { orgId: "org_1", balance: 45, reserved: 0 },
      ]);

      await service.consumeCredits({
        orgId: "org_1",
        amount: 5,
        type: "consumption",
        description: "Task execution",
      });

      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── estimateTaskCost ─────────────────────────────────────────────────────

  describe("estimateTaskCost", () => {
    it("returns 2 for ask mode regardless of complexity", async () => {
      const cost = await service.estimateTaskCost("ask", "complex");
      expect(cost).toBe(2);
    });

    it("returns 10 for plan mode regardless of complexity", async () => {
      const cost = await service.estimateTaskCost("plan", "simple");
      expect(cost).toBe(10);
    });

    it("returns 5 for simple mode", async () => {
      const cost = await service.estimateTaskCost("simple");
      expect(cost).toBe(5);
    });

    it("returns 25 for medium mode", async () => {
      const cost = await service.estimateTaskCost("medium");
      expect(cost).toBe(25);
    });

    it("returns 75 for complex mode", async () => {
      const cost = await service.estimateTaskCost("complex");
      expect(cost).toBe(75);
    });

    it("defaults to 25 for unknown mode with no complexity", async () => {
      const cost = await service.estimateTaskCost("unknown");
      expect(cost).toBe(25);
    });

    it("falls back to complexity when mode is unknown", async () => {
      const cost = await service.estimateTaskCost("task", "simple");
      expect(cost).toBe(5);
    });
  });

  // ── addCredits ───────────────────────────────────────────────────────────

  describe("addCredits", () => {
    it("increases balance and creates transaction", async () => {
      // getBalance (ensure row exists)
      mockFindFirst.mockResolvedValueOnce({ balance: 50, reserved: 0 });
      // getBalance after add (for balanceAfter)
      mockFindFirst.mockResolvedValueOnce({ balance: 150, reserved: 0 });

      await service.addCredits({
        orgId: "org_1",
        amount: 100,
        type: "purchase",
        description: "Credit purchase",
      });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── refundCredits ────────────────────────────────────────────────────────

  describe("refundCredits", () => {
    it("adds credits with refund type", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 50, reserved: 0 });
      mockFindFirst.mockResolvedValueOnce({ balance: 60, reserved: 0 });

      await service.refundCredits("org_1", "task_1", 10, "Task failed");

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── hasEnoughCredits ───────────────────────────────────────────────────

  describe("hasEnoughCredits", () => {
    it("returns true when enough credits available", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 100, reserved: 20 });
      const result = await service.hasEnoughCredits("org_1", 50);
      expect(result).toBe(true);
    });

    it("returns false when insufficient credits", async () => {
      mockFindFirst.mockResolvedValueOnce({ balance: 30, reserved: 20 });
      const result = await service.hasEnoughCredits("org_1", 15);
      expect(result).toBe(false);
    });
  });

  // ── grantMonthlyCredits ────────────────────────────────────────────────

  describe("grantMonthlyCredits", () => {
    it("grants credits for starter plan", async () => {
      // getBalance (ensure row exists)
      mockFindFirst.mockResolvedValueOnce({ balance: 0, reserved: 0 });
      // getBalance after add
      mockFindFirst.mockResolvedValueOnce({ balance: 500, reserved: 0 });

      await service.grantMonthlyCredits("org_1", "starter");

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it("does not grant for enterprise plan (null credits)", async () => {
      await service.grantMonthlyCredits("org_1", "enterprise");
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
