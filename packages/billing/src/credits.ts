import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { db } from "@prometheus/db";
import { creditBalances, creditTransactions, creditReservations } from "@prometheus/db";
import { eq, and, sql } from "drizzle-orm";

const logger = createLogger("billing:credits");

export interface CreditOperation {
  orgId: string;
  amount: number;
  type: "purchase" | "consumption" | "refund" | "bonus" | "subscription_grant";
  taskId?: string;
  description: string;
}

export class CreditService {
  async getBalance(orgId: string): Promise<{ balance: number; reserved: number; available: number }> {
    let balance = await db.query.creditBalances.findFirst({
      where: eq(creditBalances.orgId, orgId),
    });

    if (!balance) {
      // Initialize with default hobby credits
      const [inserted] = await db.insert(creditBalances).values({
        orgId,
        balance: 50,
        reserved: 0,
      }).returning();
      balance = inserted!;
    }

    return {
      balance: balance!.balance,
      reserved: balance!.reserved,
      available: balance!.balance - balance!.reserved,
    };
  }

  async reserveCredits(orgId: string, taskId: string, amount: number): Promise<string> {
    const balance = await this.getBalance(orgId);
    if (balance.available < amount) {
      throw new Error(`Insufficient credits: need ${amount}, have ${balance.available}`);
    }

    const reservationId = generateId("res");

    await db.insert(creditReservations).values({
      id: reservationId,
      orgId,
      taskId,
      amount,
      status: "active",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hour expiry
    });

    await db.update(creditBalances)
      .set({
        reserved: sql`${creditBalances.reserved} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, orgId));

    logger.info({ orgId, taskId, amount, reservationId }, "Credits reserved");
    return reservationId;
  }

  async commitReservation(reservationId: string): Promise<void> {
    const reservation = await db.query.creditReservations.findFirst({
      where: eq(creditReservations.id, reservationId),
    });

    if (!reservation || reservation.status !== "active") {
      throw new Error(`Reservation ${reservationId} not found or not active`);
    }

    // Deduct from balance and reserved
    await db.update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} - ${reservation.amount}`,
        reserved: sql`${creditBalances.reserved} - ${reservation.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, reservation.orgId));

    // Update reservation status
    await db.update(creditReservations)
      .set({ status: "committed" })
      .where(eq(creditReservations.id, reservationId));

    // Create transaction record
    const balance = await this.getBalance(reservation.orgId);
    await db.insert(creditTransactions).values({
      id: generateId("ctx"),
      orgId: reservation.orgId,
      type: "consumption",
      amount: -reservation.amount,
      balanceAfter: balance.balance,
      taskId: reservation.taskId,
      description: `Task execution: ${reservation.taskId}`,
    });

    logger.info({ reservationId, orgId: reservation.orgId, amount: reservation.amount }, "Credit reservation committed");
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const reservation = await db.query.creditReservations.findFirst({
      where: eq(creditReservations.id, reservationId),
    });

    if (!reservation || reservation.status !== "active") {
      return;
    }

    await db.update(creditBalances)
      .set({
        reserved: sql`GREATEST(${creditBalances.reserved} - ${reservation.amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, reservation.orgId));

    await db.update(creditReservations)
      .set({ status: "released" })
      .where(eq(creditReservations.id, reservationId));

    logger.info({ reservationId }, "Credit reservation released");
  }

  async addCredits(operation: CreditOperation): Promise<void> {
    await db.update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} + ${operation.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, operation.orgId));

    const balance = await this.getBalance(operation.orgId);

    await db.insert(creditTransactions).values({
      id: generateId("ctx"),
      orgId: operation.orgId,
      type: operation.type,
      amount: operation.amount,
      balanceAfter: balance.balance,
      taskId: operation.taskId ?? null,
      description: operation.description,
    });

    logger.info({ orgId: operation.orgId, amount: operation.amount, type: operation.type }, "Credits added");
  }

  async consumeCredits(operation: CreditOperation): Promise<void> {
    const balance = await this.getBalance(operation.orgId);
    if (balance.available < operation.amount) {
      throw new Error("Insufficient credits for consumption");
    }

    await db.update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} - ${operation.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, operation.orgId));

    const newBalance = await this.getBalance(operation.orgId);

    await db.insert(creditTransactions).values({
      id: generateId("ctx"),
      orgId: operation.orgId,
      type: "consumption",
      amount: -operation.amount,
      balanceAfter: newBalance.balance,
      taskId: operation.taskId ?? null,
      description: operation.description,
    });

    logger.info({ orgId: operation.orgId, amount: operation.amount }, "Credits consumed");
  }

  async refundCredits(orgId: string, taskId: string, amount: number, reason: string): Promise<void> {
    await this.addCredits({
      orgId,
      amount,
      type: "refund",
      taskId,
      description: `Refund: ${reason}`,
    });
  }

  async estimateTaskCost(mode: string, complexity: "simple" | "medium" | "complex"): Promise<number> {
    const costs = {
      simple: 5,
      medium: 25,
      complex: 75,
    };

    let base = costs[complexity] ?? 25;

    if (mode === "ask") base = 2;
    if (mode === "plan") base = 10;

    return base;
  }
}
