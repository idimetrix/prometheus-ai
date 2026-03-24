/**
 * Integration tests: Credit reserve -> consume -> refund lifecycle.
 *
 * Verifies credit reservation, consumption, refund, balance integrity,
 * and edge cases in the billing credit system.
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

// ---------------------------------------------------------------------------
// Credit ledger system
// ---------------------------------------------------------------------------

interface CreditBalance {
  available: number;
  lifetime: number; // total credits ever granted
  reserved: number;
}

interface Reservation {
  amount: number;
  consumedAmount: number;
  createdAt: string;
  id: string;
  orgId: string;
  status: "active" | "consumed" | "refunded" | "partial_refund";
  taskId: string;
}

interface Transaction {
  amount: number;
  balanceAfter: number;
  createdAt: string;
  id: string;
  orgId: string;
  reservationId?: string;
  taskId?: string;
  type: "reserve" | "consume" | "refund" | "grant" | "partial_refund";
}

function createCreditLedger() {
  const balances = new Map<string, CreditBalance>();
  const reservations = new Map<string, Reservation>();
  const transactions: Transaction[] = [];
  let txnCounter = 0;

  function getBalance(orgId: string): CreditBalance {
    return balances.get(orgId) ?? { available: 0, reserved: 0, lifetime: 0 };
  }

  function addTransaction(
    orgId: string,
    type: Transaction["type"],
    amount: number,
    extra?: { reservationId?: string; taskId?: string }
  ): Transaction {
    const balance = getBalance(orgId);
    const txn: Transaction = {
      id: `txn_${++txnCounter}`,
      orgId,
      type,
      amount,
      balanceAfter: balance.available,
      reservationId: extra?.reservationId,
      taskId: extra?.taskId,
      createdAt: new Date().toISOString(),
    };
    transactions.push(txn);
    return txn;
  }

  return {
    grantCredits(orgId: string, amount: number): { success: boolean } {
      const current = getBalance(orgId);
      balances.set(orgId, {
        available: current.available + amount,
        reserved: current.reserved,
        lifetime: current.lifetime + amount,
      });
      addTransaction(orgId, "grant", amount);
      return { success: true };
    },

    reserve(
      orgId: string,
      taskId: string,
      amount: number
    ): { success: boolean; reservationId?: string; error?: string } {
      const balance = getBalance(orgId);
      const effectiveAvailable = balance.available - balance.reserved;

      if (effectiveAvailable < amount) {
        return { success: false, error: "insufficient_credits" };
      }

      const resId = `res_${++txnCounter}`;
      reservations.set(resId, {
        id: resId,
        orgId,
        taskId,
        amount,
        status: "active",
        consumedAmount: 0,
        createdAt: new Date().toISOString(),
      });

      balances.set(orgId, {
        ...balance,
        reserved: balance.reserved + amount,
      });

      addTransaction(orgId, "reserve", amount, {
        reservationId: resId,
        taskId,
      });
      return { success: true, reservationId: resId };
    },

    consume(
      reservationId: string,
      actualCost: number
    ): { success: boolean; newBalance?: number; error?: string } {
      const reservation = reservations.get(reservationId);
      if (!reservation || reservation.status !== "active") {
        return { success: false, error: "invalid_reservation" };
      }

      if (actualCost > reservation.amount) {
        return { success: false, error: "cost_exceeds_reservation" };
      }

      const balance = getBalance(reservation.orgId);
      const newAvailable = balance.available - actualCost;
      const newReserved = balance.reserved - reservation.amount;

      balances.set(reservation.orgId, {
        available: newAvailable,
        reserved: newReserved,
        lifetime: balance.lifetime,
      });

      reservation.status = "consumed";
      reservation.consumedAmount = actualCost;

      addTransaction(reservation.orgId, "consume", -actualCost, {
        reservationId,
        taskId: reservation.taskId,
      });

      return { success: true, newBalance: newAvailable };
    },

    refund(reservationId: string): {
      success: boolean;
      refundedAmount?: number;
      error?: string;
    } {
      const reservation = reservations.get(reservationId);
      if (!reservation) {
        return { success: false, error: "reservation_not_found" };
      }

      if (reservation.status === "refunded") {
        return { success: false, error: "already_refunded" };
      }

      const balance = getBalance(reservation.orgId);

      if (reservation.status === "active") {
        // Full refund: just release the reservation
        balances.set(reservation.orgId, {
          ...balance,
          reserved: balance.reserved - reservation.amount,
        });
        reservation.status = "refunded";
        addTransaction(reservation.orgId, "refund", reservation.amount, {
          reservationId,
        });
        return { success: true, refundedAmount: reservation.amount };
      }

      if (reservation.status === "consumed") {
        // Partial refund: return consumed credits
        balances.set(reservation.orgId, {
          ...balance,
          available: balance.available + reservation.consumedAmount,
        });
        reservation.status = "partial_refund";
        addTransaction(
          reservation.orgId,
          "partial_refund",
          reservation.consumedAmount,
          { reservationId }
        );
        return { success: true, refundedAmount: reservation.consumedAmount };
      }

      return { success: false, error: "invalid_reservation_state" };
    },

    getBalance,
    getReservation: (id: string) => reservations.get(id),
    getTransactions: (orgId: string) =>
      transactions.filter((t) => t.orgId === orgId),
    _balances: balances,
    _reservations: reservations,
    _transactions: transactions,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Helper to assert and extract reservationId from a successful reservation. */
function expectReservationId(result: {
  success: boolean;
  reservationId?: string;
}): string {
  expect(result.success).toBe(true);
  expect(result.reservationId).toBeDefined();
  return result.reservationId as string;
}

describe("Credit lifecycle integration", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  let ledger: ReturnType<typeof createCreditLedger>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures({ orgPlan: "pro" });
    ledger = createCreditLedger();
    ledger.grantCredits(fixtures.org.id, 1000);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("credit reservation", () => {
    it("reserves credits and reduces available balance", () => {
      const result = ledger.reserve(fixtures.org.id, fixtures.task.id, 100);

      expect(result.success).toBe(true);
      expect(result.reservationId).toBeDefined();

      const balance = ledger.getBalance(fixtures.org.id);
      expect(balance.available).toBe(1000); // total unchanged
      expect(balance.reserved).toBe(100);
    });

    it("rejects reservation when insufficient credits", () => {
      const result = ledger.reserve(fixtures.org.id, fixtures.task.id, 1500);

      expect(result.success).toBe(false);
      expect(result.error).toBe("insufficient_credits");
    });

    it("supports multiple concurrent reservations", () => {
      const r1 = ledger.reserve(fixtures.org.id, "task_1", 200);
      const r2 = ledger.reserve(fixtures.org.id, "task_2", 300);
      const r3 = ledger.reserve(fixtures.org.id, "task_3", 400);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);

      const balance = ledger.getBalance(fixtures.org.id);
      expect(balance.reserved).toBe(900);

      // 4th should fail (only 100 effective available)
      const r4 = ledger.reserve(fixtures.org.id, "task_4", 200);
      expect(r4.success).toBe(false);
    });
  });

  describe("credit consumption", () => {
    it("consumes credits and deducts from balance", () => {
      const reservation = ledger.reserve(
        fixtures.org.id,
        fixtures.task.id,
        100
      );
      const resId = expectReservationId(reservation);

      const result = ledger.consume(resId, 75);

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(925); // 1000 - 75

      const balance = ledger.getBalance(fixtures.org.id);
      expect(balance.reserved).toBe(0); // reservation released
      expect(balance.available).toBe(925);
    });

    it("rejects consuming more than reserved", () => {
      const reservation = ledger.reserve(fixtures.org.id, fixtures.task.id, 50);
      const resId = expectReservationId(reservation);

      const result = ledger.consume(resId, 100);
      expect(result.success).toBe(false);
      expect(result.error).toBe("cost_exceeds_reservation");
    });

    it("rejects consuming an already consumed reservation", () => {
      const reservation = ledger.reserve(
        fixtures.org.id,
        fixtures.task.id,
        100
      );
      const resId = expectReservationId(reservation);

      ledger.consume(resId, 50);
      const result = ledger.consume(resId, 25);

      expect(result.success).toBe(false);
      expect(result.error).toBe("invalid_reservation");
    });
  });

  describe("credit refund", () => {
    it("refunds an active reservation (task cancelled before execution)", () => {
      const reservation = ledger.reserve(
        fixtures.org.id,
        fixtures.task.id,
        100
      );
      const resId = expectReservationId(reservation);

      const refund = ledger.refund(resId);
      expect(refund.success).toBe(true);
      expect(refund.refundedAmount).toBe(100);

      const balance = ledger.getBalance(fixtures.org.id);
      expect(balance.available).toBe(1000); // fully restored
      expect(balance.reserved).toBe(0);
    });

    it("partially refunds a consumed reservation", () => {
      const reservation = ledger.reserve(
        fixtures.org.id,
        fixtures.task.id,
        100
      );
      const resId = expectReservationId(reservation);

      // Consume 60 credits
      ledger.consume(resId, 60);

      // Request refund after consumption
      const refund = ledger.refund(resId);
      expect(refund.success).toBe(true);
      expect(refund.refundedAmount).toBe(60); // returns consumed amount

      const balance = ledger.getBalance(fixtures.org.id);
      expect(balance.available).toBe(1000); // 940 + 60 refunded
    });

    it("rejects double refund", () => {
      const reservation = ledger.reserve(
        fixtures.org.id,
        fixtures.task.id,
        100
      );
      const resId = expectReservationId(reservation);

      ledger.refund(resId);
      const secondRefund = ledger.refund(resId);

      expect(secondRefund.success).toBe(false);
      expect(secondRefund.error).toBe("already_refunded");
    });

    it("rejects refund for non-existent reservation", () => {
      const result = ledger.refund("res_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("reservation_not_found");
    });
  });

  describe("balance integrity", () => {
    it("maintains correct balance through reserve-consume-reserve cycle", () => {
      // Reserve 200
      const r1 = ledger.reserve(fixtures.org.id, "task_1", 200);
      const r1Id = expectReservationId(r1);

      // Consume 150 of those
      ledger.consume(r1Id, 150);

      // Reserve another 300
      const r2 = ledger.reserve(fixtures.org.id, "task_2", 300);
      const r2Id = expectReservationId(r2);

      // Refund the second reservation
      ledger.refund(r2Id);

      const balance = ledger.getBalance(fixtures.org.id);
      expect(balance.available).toBe(850); // 1000 - 150
      expect(balance.reserved).toBe(0);
    });

    it("transaction log accurately reflects all operations", () => {
      const r1 = ledger.reserve(fixtures.org.id, "task_1", 100);
      const r1Id = expectReservationId(r1);
      ledger.consume(r1Id, 80);

      const r2 = ledger.reserve(fixtures.org.id, "task_2", 50);
      const r2Id = expectReservationId(r2);
      ledger.refund(r2Id);

      const txns = ledger.getTransactions(fixtures.org.id);

      // grant + reserve + consume + reserve + refund = 5 transactions
      expect(txns).toHaveLength(5);

      const types = txns.map((t) => t.type);
      expect(types).toContain("grant");
      expect(types).toContain("reserve");
      expect(types).toContain("consume");
      expect(types).toContain("refund");
    });

    it("lifetime credits only increase with grants", () => {
      const initial = ledger.getBalance(fixtures.org.id).lifetime;

      ledger.reserve(fixtures.org.id, "task_1", 100);
      expect(ledger.getBalance(fixtures.org.id).lifetime).toBe(initial);

      ledger.grantCredits(fixtures.org.id, 500);
      expect(ledger.getBalance(fixtures.org.id).lifetime).toBe(initial + 500);
    });
  });
});
