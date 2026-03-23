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
  stripeId?: string;
  taskId?: string;
  triggerSource?: string;
  type: "purchase" | "consumption" | "refund" | "bonus" | "subscription_grant";
  userId?: string;
}

export interface CreditBalance {
  available: number;
  balance: number;
  reserved: number;
}

export interface ReservationResult {
  amount: number;
  expiresAt: Date;
  reservationId: string;
}

export interface AuditedTransaction {
  amount: number;
  balanceAfter: number;
  balanceBefore: number;
  createdAt: Date;
  description: string;
  id: string;
  orgId: string;
  stripeId: string | null;
  taskId: string | null;
  triggerSource: string | null;
  type: string;
  userId: string | null;
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
    amount: number,
    ttlMs = 2 * 60 * 60 * 1000 // 2 hours default
  ): Promise<ReservationResult> {
    // Ensure row exists
    await this.getBalance(orgId);

    const expiresAt = new Date(Date.now() + ttlMs);

    // Use a serialised transaction with SELECT ... FOR UPDATE to prevent
    // concurrent over-booking. The row-level lock ensures that only one
    // reservation can succeed at a time for a given org.
    const result = await db.transaction(async (tx) => {
      // Lock the balance row for update — blocks concurrent reservations
      const [locked] = await tx
        .select()
        .from(creditBalances)
        .where(eq(creditBalances.orgId, orgId))
        .for("update");

      if (!locked) {
        throw new Error(`No credit balance found for org ${orgId}`);
      }

      const available = locked.balance - locked.reserved;
      if (available < amount) {
        throw new Error(
          `Insufficient credits: need ${amount}, have ${available} available`
        );
      }

      // Reservation ceiling check: cannot reserve more than total balance
      if (locked.reserved + amount > locked.balance) {
        throw new Error(
          `Reservation ceiling exceeded: balance=${locked.balance}, already reserved=${locked.reserved}, requested=${amount}`
        );
      }

      // Increment reserved amount
      await tx
        .update(creditBalances)
        .set({
          reserved: sql`${creditBalances.reserved} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.orgId, orgId));

      const reservationId = generateId("res");

      await tx.insert(creditReservations).values({
        id: reservationId,
        orgId,
        taskId,
        amount,
        status: "active",
        expiresAt,
      });

      return { reservationId, amount, expiresAt };
    });

    logger.info(
      { orgId, taskId, amount, reservationId: result.reservationId, expiresAt },
      "Credits reserved"
    );
    return result;
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
    // Ensure balance row exists and get balance before
    const currentBalance = await this.getBalance(operation.orgId);

    await db
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} + ${operation.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, operation.orgId));

    const newBalance = await this.getBalance(operation.orgId);

    // Append-only transaction record with full audit trail
    await db.insert(creditTransactions).values({
      id: generateId("ctx"),
      orgId: operation.orgId,
      type: operation.type,
      amount: operation.amount,
      balanceBefore: currentBalance.balance,
      balanceAfter: newBalance.balance,
      taskId: operation.taskId ?? null,
      userId: operation.userId ?? null,
      triggerSource: operation.triggerSource ?? null,
      stripeId: operation.stripeId ?? null,
      description: operation.description,
    });

    logger.info(
      {
        orgId: operation.orgId,
        amount: operation.amount,
        type: operation.type,
        balanceBefore: currentBalance.balance,
        balanceAfter: newBalance.balance,
      },
      "Credits added"
    );
  }

  async consumeCredits(operation: CreditOperation): Promise<void> {
    // Get balance before for audit trail
    const balanceBefore = await this.getBalance(operation.orgId);

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

    // Append-only transaction with full audit trail
    await db.insert(creditTransactions).values({
      id: generateId("ctx"),
      orgId: operation.orgId,
      type: "consumption",
      amount: -operation.amount,
      balanceBefore: balanceBefore.balance,
      balanceAfter: updated.balance,
      taskId: operation.taskId ?? null,
      userId: operation.userId ?? null,
      triggerSource: operation.triggerSource ?? null,
      stripeId: operation.stripeId ?? null,
      description: operation.description,
    });

    logger.info(
      {
        orgId: operation.orgId,
        amount: operation.amount,
        balanceBefore: balanceBefore.balance,
        balanceAfter: updated.balance,
      },
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

  // -----------------------------------------------------------------------
  // Transaction chain tracing for dispute resolution (Task 9.5)
  // -----------------------------------------------------------------------

  async traceTransactionChain(taskId: string): Promise<AuditedTransaction[]> {
    const rows = await db.query.creditTransactions.findMany({
      where: eq(creditTransactions.taskId, taskId),
      orderBy: (ct, { asc }) => [asc(ct.createdAt)],
    });

    return rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      type: row.type,
      amount: row.amount,
      balanceBefore: row.balanceBefore ?? 0,
      balanceAfter: row.balanceAfter,
      taskId: row.taskId,
      userId: row.userId ?? null,
      triggerSource: row.triggerSource ?? null,
      stripeId: row.stripeId ?? null,
      description: row.description,
      createdAt: row.createdAt,
    }));
  }

  async traceOrgTransactions(
    orgId: string,
    startDate: Date,
    endDate: Date
  ): Promise<AuditedTransaction[]> {
    const rows = await db.query.creditTransactions.findMany({
      where: and(
        eq(creditTransactions.orgId, orgId),
        sql`${creditTransactions.createdAt} >= ${startDate}`,
        sql`${creditTransactions.createdAt} <= ${endDate}`
      ),
      orderBy: (ct, { asc }) => [asc(ct.createdAt)],
    });

    return rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      type: row.type,
      amount: row.amount,
      balanceBefore: row.balanceBefore ?? 0,
      balanceAfter: row.balanceAfter,
      taskId: row.taskId,
      userId: row.userId ?? null,
      triggerSource: row.triggerSource ?? null,
      stripeId: row.stripeId ?? null,
      description: row.description,
      createdAt: row.createdAt,
    }));
  }

  async verifyTransactionIntegrity(orgId: string): Promise<{
    consistent: boolean;
    gapCount: number;
    gaps: Array<{
      afterTxId: string;
      beforeTxId: string;
      expected: number;
      actual: number;
    }>;
  }> {
    const rows = await db.query.creditTransactions.findMany({
      where: eq(creditTransactions.orgId, orgId),
      orderBy: (ct, { asc }) => [asc(ct.createdAt)],
    });

    const gaps: Array<{
      afterTxId: string;
      beforeTxId: string;
      expected: number;
      actual: number;
    }> = [];

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (
        prev &&
        curr &&
        curr.balanceBefore != null &&
        prev.balanceAfter !== curr.balanceBefore
      ) {
        gaps.push({
          afterTxId: prev.id,
          beforeTxId: curr.id,
          expected: prev.balanceAfter,
          actual: curr.balanceBefore,
        });
      }
    }

    return {
      consistent: gaps.length === 0,
      gapCount: gaps.length,
      gaps,
    };
  }

  // -----------------------------------------------------------------------
  // Background expiry job
  // -----------------------------------------------------------------------

  private expiryInterval: ReturnType<typeof setInterval> | null = null;

  startExpiryJob(intervalMs = 60_000): void {
    if (this.expiryInterval) {
      return;
    }

    logger.info(
      { intervalMs },
      "Starting credit reservation expiry background job"
    );

    this.expiryInterval = setInterval(() => {
      this.cleanupExpiredReservations().catch((err) => {
        logger.error({ error: String(err) }, "Expiry job failed");
      });
    }, intervalMs);
  }

  stopExpiryJob(): void {
    if (this.expiryInterval) {
      clearInterval(this.expiryInterval);
      this.expiryInterval = null;
      logger.info("Stopped credit reservation expiry background job");
    }
  }
}
