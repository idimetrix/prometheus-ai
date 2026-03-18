import {
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  type PlanSlug,
  PRICING_TIERS,
  TASK_MODE_COSTS,
  type TaskMode,
} from "./products";

const logger = createLogger("billing:credits");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditOperation {
  amount: number;
  description: string;
  orgId: string;
  taskId?: string;
  type: "purchase" | "consumption" | "refund" | "bonus" | "subscription_grant";
}

export interface CreditBalance {
  available: number;
  balance: number;
  reserved: number;
}

export interface ReservationResult {
  amount: number;
  reservationId: string;
}

// ---------------------------------------------------------------------------
// CreditService
// ---------------------------------------------------------------------------

export class CreditService {
  // -----------------------------------------------------------------------
  // Balance operations
  // -----------------------------------------------------------------------

  async getBalance(orgId: string): Promise<CreditBalance> {
    let balance = await db.query.creditBalances.findFirst({
      where: eq(creditBalances.orgId, orgId),
    });

    if (!balance) {
      // Initialize with default hobby credits
      const [inserted] = await db
        .insert(creditBalances)
        .values({ orgId, balance: 50, reserved: 0 })
        .onConflictDoNothing()
        .returning();

      // If insert was a no-op due to race, re-read
      if (inserted) {
        balance = inserted;
      } else {
        balance = await db.query.creditBalances.findFirst({
          where: eq(creditBalances.orgId, orgId),
        });
      }
    }

    return {
      balance: balance?.balance ?? 0,
      reserved: balance?.reserved ?? 0,
      available: (balance?.balance ?? 0) - (balance?.reserved ?? 0),
    };
  }

  /**
   * Check if an org has enough available credits for the given amount.
   */
  async hasEnoughCredits(orgId: string, amount: number): Promise<boolean> {
    const balance = await this.getBalance(orgId);
    return balance.available >= amount;
  }

  // -----------------------------------------------------------------------
  // Reservation: reserve credits on task submit
  // Uses database-level atomicity via a conditional UPDATE that only succeeds
  // if `balance - reserved >= amount`. This prevents concurrent over-booking.
  // -----------------------------------------------------------------------

  async reserveCredits(
    orgId: string,
    taskId: string,
    amount: number
  ): Promise<ReservationResult> {
    // Ensure row exists
    await this.getBalance(orgId);

    // Atomic conditional update — prevents overselling under concurrency.
    // The WHERE clause guarantees we only reserve if sufficient credits exist.
    const [updated] = await db
      .update(creditBalances)
      .set({
        reserved: sql`${creditBalances.reserved} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creditBalances.orgId, orgId),
          sql`${creditBalances.balance} - ${creditBalances.reserved} >= ${amount}`
        )
      )
      .returning();

    if (!updated) {
      const balance = await this.getBalance(orgId);
      throw new Error(
        `Insufficient credits: need ${amount}, have ${balance.available} available`
      );
    }

    const reservationId = generateId("res");

    await db.insert(creditReservations).values({
      id: reservationId,
      orgId,
      taskId,
      amount,
      status: "active",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2-hour expiry
    });

    logger.info({ orgId, taskId, amount, reservationId }, "Credits reserved");
    return { reservationId, amount };
  }

  // -----------------------------------------------------------------------
  // Consumption: commit reservation on task completion.
  // If actualCost < reserved, automatically refunds the difference.
  // -----------------------------------------------------------------------

  async commitReservation(
    reservationId: string,
    actualCost?: number
  ): Promise<void> {
    const reservation = await db.query.creditReservations.findFirst({
      where: eq(creditReservations.id, reservationId),
    });

    if (!reservation || reservation.status !== "active") {
      throw new Error(`Reservation ${reservationId} not found or not active`);
    }

    const consumed = actualCost ?? reservation.amount;
    const refundAmount = reservation.amount - consumed;

    // Deduct consumed from balance, release full reservation
    await db
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} - ${consumed}`,
        reserved: sql`GREATEST(${creditBalances.reserved} - ${reservation.amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, reservation.orgId));

    // Mark reservation as committed
    await db
      .update(creditReservations)
      .set({ status: "committed" })
      .where(eq(creditReservations.id, reservationId));

    // Record consumption transaction
    const balanceAfter = await this.getBalance(reservation.orgId);
    await db.insert(creditTransactions).values({
      id: generateId("ctx"),
      orgId: reservation.orgId,
      type: "consumption",
      amount: -consumed,
      balanceAfter: balanceAfter.balance,
      taskId: reservation.taskId,
      description: `Task execution: ${reservation.taskId}`,
    });

    // If actual < reserved, record refund transaction
    if (refundAmount > 0) {
      await db.insert(creditTransactions).values({
        id: generateId("ctx"),
        orgId: reservation.orgId,
        type: "refund",
        amount: refundAmount,
        balanceAfter: balanceAfter.balance,
        taskId: reservation.taskId,
        description: `Partial refund: reserved ${reservation.amount}, used ${consumed}`,
      });

      logger.info(
        { reservationId, refundAmount, orgId: reservation.orgId },
        "Partial credit refund issued"
      );
    }

    logger.info(
      { reservationId, consumed, orgId: reservation.orgId },
      "Credit reservation committed"
    );
  }

  // -----------------------------------------------------------------------
  // Release: refund full reservation on task failure
  // -----------------------------------------------------------------------

  async releaseReservation(reservationId: string): Promise<void> {
    const reservation = await db.query.creditReservations.findFirst({
      where: eq(creditReservations.id, reservationId),
    });

    if (!reservation || reservation.status !== "active") {
      return; // Idempotent — already released or committed
    }

    await db
      .update(creditBalances)
      .set({
        reserved: sql`GREATEST(${creditBalances.reserved} - ${reservation.amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, reservation.orgId));

    await db
      .update(creditReservations)
      .set({ status: "released" })
      .where(eq(creditReservations.id, reservationId));

    logger.info(
      { reservationId, orgId: reservation.orgId },
      "Credit reservation released"
    );
  }

  // -----------------------------------------------------------------------
  // Monthly credit grant: called when invoice.paid webhook fires
  // -----------------------------------------------------------------------

  async grantMonthlyCredits(orgId: string, planTier: PlanSlug): Promise<void> {
    const tier = PRICING_TIERS[planTier];
    if (!tier || tier.creditsIncluded == null || tier.creditsIncluded <= 0) {
      logger.warn({ orgId, planTier }, "No credits to grant for this plan");
      return;
    }

    await this.addCredits({
      orgId,
      amount: tier.creditsIncluded,
      type: "subscription_grant",
      description: `Monthly ${tier.name} plan credit grant (${tier.creditsIncluded} credits)`,
    });

    logger.info(
      { orgId, planTier, credits: tier.creditsIncluded },
      "Monthly credits granted"
    );
  }

  // -----------------------------------------------------------------------
  // Credit pack purchase: called after checkout.session.completed
  // -----------------------------------------------------------------------

  async grantCreditPurchase(
    orgId: string,
    credits: number,
    description: string
  ): Promise<void> {
    await this.addCredits({
      orgId,
      amount: credits,
      type: "purchase",
      description,
    });
  }

  // -----------------------------------------------------------------------
  // Add / consume / refund credits
  // -----------------------------------------------------------------------

  async addCredits(operation: CreditOperation): Promise<void> {
    // Ensure balance row exists
    await this.getBalance(operation.orgId);

    await db
      .update(creditBalances)
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

    logger.info(
      {
        orgId: operation.orgId,
        amount: operation.amount,
        type: operation.type,
      },
      "Credits added"
    );
  }

  async consumeCredits(operation: CreditOperation): Promise<void> {
    // Atomic balance check + deduction
    const [updated] = await db
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} - ${operation.amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creditBalances.orgId, operation.orgId),
          sql`${creditBalances.balance} - ${creditBalances.reserved} >= ${operation.amount}`
        )
      )
      .returning();

    if (!updated) {
      throw new Error("Insufficient credits for consumption");
    }

    await db.insert(creditTransactions).values({
      id: generateId("ctx"),
      orgId: operation.orgId,
      type: "consumption",
      amount: -operation.amount,
      balanceAfter: updated.balance,
      taskId: operation.taskId ?? null,
      description: operation.description,
    });

    logger.info(
      { orgId: operation.orgId, amount: operation.amount },
      "Credits consumed"
    );
  }

  async refundCredits(
    orgId: string,
    taskId: string,
    amount: number,
    reason: string
  ): Promise<void> {
    await this.addCredits({
      orgId,
      amount,
      type: "refund",
      taskId,
      description: `Refund: ${reason}`,
    });
  }

  // -----------------------------------------------------------------------
  // Per-task cost estimation
  // -----------------------------------------------------------------------

  estimateTaskCost(
    mode: string,
    _complexity?: "simple" | "medium" | "complex"
  ): number {
    // If mode directly maps to a known cost, use it
    if (mode in TASK_MODE_COSTS) {
      return TASK_MODE_COSTS[mode as TaskMode];
    }

    // Fallback: map complexity strings to TASK_MODE_COSTS
    const complexityMap: Record<string, TaskMode> = {
      simple: "simple",
      medium: "medium",
      complex: "complex",
    };

    const mapped = _complexity ? complexityMap[_complexity] : undefined;
    if (mapped) {
      return TASK_MODE_COSTS[mapped];
    }

    // Default to medium cost
    return TASK_MODE_COSTS.medium;
  }

  /**
   * Validate that an org can execute a task, checking both credits and plan limits.
   */
  async validateTaskExecution(
    orgId: string,
    mode: TaskMode,
    planTier: PlanSlug
  ): Promise<{
    allowed: boolean;
    cost: number;
    balance: CreditBalance;
    reason?: string;
  }> {
    const cost = await this.estimateTaskCost(mode);
    const balance = await this.getBalance(orgId);

    // Check plan-level monthly credit limit
    const tier = PRICING_TIERS[planTier];
    if (tier.creditsIncluded != null && balance.balance <= 0) {
      return {
        allowed: false,
        cost,
        balance,
        reason:
          "No credits remaining. Purchase a credit pack or upgrade your plan.",
      };
    }

    // Check available credits
    if (balance.available < cost) {
      return {
        allowed: false,
        cost,
        balance,
        reason: `Insufficient credits: need ${cost}, have ${balance.available} available.`,
      };
    }

    return { allowed: true, cost, balance };
  }

  // -----------------------------------------------------------------------
  // Expired reservation cleanup
  // -----------------------------------------------------------------------

  async cleanupExpiredReservations(): Promise<number> {
    const now = new Date();

    const expired = await db.query.creditReservations.findMany({
      where: and(
        eq(creditReservations.status, "active"),
        lt(creditReservations.expiresAt, now)
      ),
    });

    let released = 0;
    for (const reservation of expired) {
      await this.releaseReservation(reservation.id);
      released++;
    }

    if (released > 0) {
      logger.info(
        { count: released },
        "Expired credit reservations cleaned up"
      );
    }

    return released;
  }

  // -----------------------------------------------------------------------
  // Transaction history
  // -----------------------------------------------------------------------

  async getTransactionHistory(
    orgId: string,
    limit = 50,
    offset = 0
  ): Promise<(typeof creditTransactions.$inferSelect)[]> {
    const rows = await db.query.creditTransactions.findMany({
      where: eq(creditTransactions.orgId, orgId),
      orderBy: (ct, { desc }) => [desc(ct.createdAt)],
      limit,
      offset,
    });
    return rows;
  }
}
