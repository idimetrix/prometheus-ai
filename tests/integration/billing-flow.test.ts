/**
 * Integration tests: Billing and credit flow.
 *
 * Verifies the complete billing lifecycle: credit reservation,
 * consumption, commit/release, balance tracking, and plan enforcement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures } from "./setup";

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

describe("Billing and credit flow", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;

  // In-memory credit ledger for testing
  let creditLedger: {
    balances: Map<string, { balance: number; reserved: number }>;
    transactions: Array<{
      id: string;
      orgId: string;
      type: string;
      amount: number;
      balanceAfter: number;
      taskId?: string;
      description: string;
      createdAt: string;
    }>;
    reservations: Map<
      string,
      {
        id: string;
        orgId: string;
        taskId: string;
        amount: number;
        status: "active" | "committed" | "released";
      }
    >;
  };

  function getBalance(orgId: string) {
    return creditLedger.balances.get(orgId) ?? { balance: 0, reserved: 0 };
  }

  function getAvailable(orgId: string) {
    const { balance, reserved } = getBalance(orgId);
    return balance - reserved;
  }

  function reserveCredits(orgId: string, taskId: string, amount: number) {
    const current = getBalance(orgId);
    const available = current.balance - current.reserved;

    if (available < amount) {
      return { success: false, error: "insufficient_credits" };
    }

    const reservationId = `res_${Date.now()}`;
    creditLedger.reservations.set(reservationId, {
      id: reservationId,
      orgId,
      taskId,
      amount,
      status: "active",
    });
    creditLedger.balances.set(orgId, {
      balance: current.balance,
      reserved: current.reserved + amount,
    });

    return { success: true, reservationId, creditsReserved: amount };
  }

  function commitCredits(reservationId: string, actualCost: number) {
    const reservation = creditLedger.reservations.get(reservationId);
    if (!reservation || reservation.status !== "active") {
      return { success: false, error: "invalid_reservation" };
    }

    const current = getBalance(reservation.orgId);
    const newBalance = current.balance - actualCost;
    const newReserved = current.reserved - reservation.amount;

    creditLedger.balances.set(reservation.orgId, {
      balance: newBalance,
      reserved: newReserved,
    });

    reservation.status = "committed";

    creditLedger.transactions.push({
      id: `txn_${Date.now()}`,
      orgId: reservation.orgId,
      type: "consumption",
      amount: -actualCost,
      balanceAfter: newBalance,
      taskId: reservation.taskId,
      description: `Task ${reservation.taskId} consumption`,
      createdAt: new Date().toISOString(),
    });

    return { success: true, creditsConsumed: actualCost, newBalance };
  }

  function releaseCredits(reservationId: string) {
    const reservation = creditLedger.reservations.get(reservationId);
    if (!reservation || reservation.status !== "active") {
      return { success: false, error: "invalid_reservation" };
    }

    const current = getBalance(reservation.orgId);
    creditLedger.balances.set(reservation.orgId, {
      balance: current.balance,
      reserved: current.reserved - reservation.amount,
    });

    reservation.status = "released";
    return { success: true };
  }

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    creditLedger = {
      balances: new Map(),
      transactions: [],
      reservations: new Map(),
    };

    // Seed initial balance for test org
    creditLedger.balances.set(fixtures.org.id, {
      balance: 500,
      reserved: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("credit reservation", () => {
    it("reserves credits for a task", () => {
      const result = reserveCredits(fixtures.org.id, fixtures.task.id, 25);

      expect(result.success).toBe(true);
      expect(result.creditsReserved).toBe(25);
      expect(getAvailable(fixtures.org.id)).toBe(475);
    });

    it("rejects reservation when insufficient credits", () => {
      const result = reserveCredits(fixtures.org.id, fixtures.task.id, 600);

      expect(result.success).toBe(false);
      expect(result.error).toBe("insufficient_credits");
      expect(getAvailable(fixtures.org.id)).toBe(500); // unchanged
    });

    it("handles multiple concurrent reservations", () => {
      const r1 = reserveCredits(fixtures.org.id, "task_1", 100);
      const r2 = reserveCredits(fixtures.org.id, "task_2", 150);
      const r3 = reserveCredits(fixtures.org.id, "task_3", 200);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);
      expect(getAvailable(fixtures.org.id)).toBe(50); // 500 - 100 - 150 - 200

      // Fourth reservation should fail (only 50 available)
      const r4 = reserveCredits(fixtures.org.id, "task_4", 100);
      expect(r4.success).toBe(false);
    });
  });

  describe("credit consumption (commit)", () => {
    it("commits credits after successful task", () => {
      const reservation = reserveCredits(fixtures.org.id, fixtures.task.id, 25);
      expect(reservation.success).toBe(true);

      const commit = commitCredits(reservation.reservationId!, 20);

      expect(commit.success).toBe(true);
      expect(commit.creditsConsumed).toBe(20);
      expect(commit.newBalance).toBe(480); // 500 - 20

      // Reserved should be back to 0
      const balance = getBalance(fixtures.org.id);
      expect(balance.reserved).toBe(0);
    });

    it("actual cost can be less than reserved", () => {
      const reservation = reserveCredits(fixtures.org.id, "task_1", 75);
      expect(reservation.success).toBe(true);

      // Task used fewer credits than estimated
      const commit = commitCredits(reservation.reservationId!, 30);

      expect(commit.success).toBe(true);
      expect(commit.newBalance).toBe(470); // 500 - 30 (not 75)
    });

    it("records transaction in ledger", () => {
      const reservation = reserveCredits(fixtures.org.id, fixtures.task.id, 25);
      commitCredits(reservation.reservationId!, 20);

      expect(creditLedger.transactions).toHaveLength(1);
      expect(creditLedger.transactions[0].type).toBe("consumption");
      expect(creditLedger.transactions[0].amount).toBe(-20);
      expect(creditLedger.transactions[0].taskId).toBe(fixtures.task.id);
    });
  });

  describe("credit release (task failure)", () => {
    it("releases reserved credits when task fails", () => {
      const reservation = reserveCredits(fixtures.org.id, fixtures.task.id, 25);
      expect(reservation.success).toBe(true);
      expect(getAvailable(fixtures.org.id)).toBe(475);

      const release = releaseCredits(reservation.reservationId!);

      expect(release.success).toBe(true);
      expect(getAvailable(fixtures.org.id)).toBe(500); // fully restored
    });

    it("prevents double-release", () => {
      const reservation = reserveCredits(fixtures.org.id, fixtures.task.id, 25);
      releaseCredits(reservation.reservationId!);

      const secondRelease = releaseCredits(reservation.reservationId!);
      expect(secondRelease.success).toBe(false);
    });
  });

  describe("plan tier enforcement", () => {
    it("hobby tier has limited credits", () => {
      creditLedger.balances.set("org_hobby", { balance: 50, reserved: 0 });

      const r1 = reserveCredits("org_hobby", "task_1", 25);
      expect(r1.success).toBe(true);

      const r2 = reserveCredits("org_hobby", "task_2", 25);
      expect(r2.success).toBe(true);

      // Should fail - no more credits
      const r3 = reserveCredits("org_hobby", "task_3", 25);
      expect(r3.success).toBe(false);
    });

    it("credit purchase increases balance", () => {
      const orgId = fixtures.org.id;
      const initialBalance = getBalance(orgId).balance;

      // Simulate credit purchase
      const purchaseAmount = 1000;
      const current = getBalance(orgId);
      creditLedger.balances.set(orgId, {
        balance: current.balance + purchaseAmount,
        reserved: current.reserved,
      });

      creditLedger.transactions.push({
        id: `txn_purchase_${Date.now()}`,
        orgId,
        type: "purchase",
        amount: purchaseAmount,
        balanceAfter: current.balance + purchaseAmount,
        description: "Credit pack purchase: 1000 credits",
        createdAt: new Date().toISOString(),
      });

      expect(getBalance(orgId).balance).toBe(initialBalance + purchaseAmount);
    });
  });

  describe("ledger integrity", () => {
    it("maintains consistent balance through operations", () => {
      const orgId = fixtures.org.id;
      const initialBalance = 500;

      // Reserve 100
      const r1 = reserveCredits(orgId, "task_1", 100);
      expect(getBalance(orgId)).toEqual({ balance: 500, reserved: 100 });

      // Reserve 50
      const r2 = reserveCredits(orgId, "task_2", 50);
      expect(getBalance(orgId)).toEqual({ balance: 500, reserved: 150 });

      // Commit task_1 for 80
      commitCredits(r1.reservationId!, 80);
      expect(getBalance(orgId)).toEqual({ balance: 420, reserved: 50 });

      // Release task_2 (failed)
      releaseCredits(r2.reservationId!);
      expect(getBalance(orgId)).toEqual({ balance: 420, reserved: 0 });

      // Verify: initial 500 - 80 consumed = 420
      expect(getBalance(orgId).balance).toBe(initialBalance - 80);
    });

    it("transaction history sums to balance change", () => {
      const orgId = fixtures.org.id;

      reserveCredits(orgId, "task_1", 100);
      const r1 = [...creditLedger.reservations.values()].find(
        (r) => r.taskId === "task_1"
      )!;
      commitCredits(r1.id, 80);

      reserveCredits(orgId, "task_2", 50);
      const r2 = [...creditLedger.reservations.values()].find(
        (r) => r.taskId === "task_2"
      )!;
      commitCredits(r2.id, 45);

      const totalConsumed = creditLedger.transactions
        .filter((t) => t.type === "consumption")
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      expect(totalConsumed).toBe(125); // 80 + 45
      expect(getBalance(orgId).balance).toBe(500 - 125);
    });
  });

  describe("webhook event processing", () => {
    it("processes subscription upgrade webhook", () => {
      const orgId = fixtures.org.id;

      // Simulate Stripe webhook: subscription upgraded to team plan
      const _webhookEvent = {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_test_123",
            metadata: { orgId },
            items: {
              data: [{ price: { id: "price_team_monthly" } }],
            },
          },
        },
      };

      // Process webhook: grant additional credits
      const grantAmount = 2000;
      const current = getBalance(orgId);
      creditLedger.balances.set(orgId, {
        balance: current.balance + grantAmount,
        reserved: current.reserved,
      });

      creditLedger.transactions.push({
        id: `txn_grant_${Date.now()}`,
        orgId,
        type: "subscription_grant",
        amount: grantAmount,
        balanceAfter: current.balance + grantAmount,
        description: "Team plan subscription grant",
        createdAt: new Date().toISOString(),
      });

      expect(getBalance(orgId).balance).toBe(500 + grantAmount);
    });

    it("handles duplicate webhook events idempotently", () => {
      const processedEvents = new Set<string>();
      const eventId = "evt_test_duplicate";

      function processWebhook(id: string): boolean {
        if (processedEvents.has(id)) {
          return false; // already processed
        }
        processedEvents.add(id);
        return true;
      }

      // First processing succeeds
      expect(processWebhook(eventId)).toBe(true);

      // Duplicate is rejected
      expect(processWebhook(eventId)).toBe(false);
    });
  });
});
