import {
  creditBalances,
  creditReservations,
  creditTransactions,
  db,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq, sql } from "drizzle-orm";

const logger = createLogger("orchestrator:credits");

export interface CreditEstimate {
  estimatedCredits: number;
  mode: string;
  tier: "ask" | "simple" | "plan" | "medium" | "complex";
}

/** Cost tiers in credits. */
const COST_TIERS: Record<string, number> = {
  ask: 2,
  simple: 5,
  plan: 10,
  medium: 25,
  complex: 75,
};

/**
 * CreditTracker manages real-time credit tracking during agent execution.
 * It handles reservation, consumption, and refund of credits.
 */
export class CreditTracker {
  private readonly orgId: string;
  private readonly sessionId: string;
  private readonly taskId: string;
  private reservationId: string | null = null;
  private reservedCredits = 0;
  private consumedCredits = 0;
  private readonly eventPublisher: EventPublisher;

  constructor(orgId: string, sessionId: string, taskId: string) {
    this.orgId = orgId;
    this.sessionId = sessionId;
    this.taskId = taskId;
    this.eventPublisher = new EventPublisher();
  }

  /**
   * Estimate credit cost for a task based on its mode.
   */
  static estimateCost(mode: string, description: string): CreditEstimate {
    const descLen = description.length;

    let tier: CreditEstimate["tier"];
    if (mode === "ask") {
      tier = "ask";
    } else if (mode === "plan") {
      tier = "plan";
    } else if (descLen < 100) {
      tier = "simple";
    } else if (descLen < 500) {
      tier = "medium";
    } else {
      tier = "complex";
    }

    return {
      mode,
      estimatedCredits: COST_TIERS[tier] ?? 5,
      tier,
    };
  }

  /**
   * Reserve credits before task execution.
   * Returns true if sufficient credits are available.
   */
  async reserve(credits: number): Promise<boolean> {
    try {
      const result = await db.transaction(async (tx) => {
        const balanceRows = await tx
          .select()
          .from(creditBalances)
          .where(eq(creditBalances.orgId, this.orgId))
          .for("update");

        const balance = balanceRows[0];
        if (!balance) {
          logger.warn({ orgId: this.orgId }, "No credit balance found");
          return false;
        }

        const available = balance.balance - balance.reserved;
        if (available < credits) {
          logger.warn(
            { orgId: this.orgId, available, requested: credits },
            "Insufficient credits"
          );
          return false;
        }

        // Create reservation matching schema: id, orgId, taskId, amount, expiresAt
        const reservationId = generateId("cres");
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min timeout
        await tx.insert(creditReservations).values({
          id: reservationId,
          orgId: this.orgId,
          taskId: this.taskId,
          amount: credits,
          expiresAt,
        });

        // Increment reserved amount
        await tx
          .update(creditBalances)
          .set({ reserved: sql`${creditBalances.reserved} + ${credits}` })
          .where(eq(creditBalances.orgId, this.orgId));

        this.reservationId = reservationId;
        this.reservedCredits = credits;
        return true;
      });

      if (result) {
        logger.info(
          { orgId: this.orgId, reservationId: this.reservationId, credits },
          "Credits reserved"
        );
      }

      return result;
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to reserve credits");
      return false;
    }
  }

  /**
   * Track credit consumption during execution.
   */
  async trackConsumption(tokensUsed: number): Promise<void> {
    const creditsForTokens = Math.ceil(tokensUsed / 1000);
    this.consumedCredits += creditsForTokens;

    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.CREDIT_UPDATE,
      data: {
        consumed: creditsForTokens,
        totalConsumed: this.consumedCredits,
        reserved: this.reservedCredits,
        remaining: this.reservedCredits - this.consumedCredits,
      },
      timestamp: new Date().toISOString(),
    });

    if (this.consumedCredits >= this.reservedCredits * 0.9) {
      logger.warn(
        { consumed: this.consumedCredits, reserved: this.reservedCredits },
        "Approaching credit limit"
      );
    }
  }

  /**
   * Finalize credits after task completion.
   */
  async finalize(): Promise<{ consumed: number; refunded: number }> {
    const refundAmount = Math.max(
      0,
      this.reservedCredits - this.consumedCredits
    );

    try {
      await db.transaction(async (tx) => {
        // Get current balance for balanceAfter calculation
        const balanceRows = await tx
          .select()
          .from(creditBalances)
          .where(eq(creditBalances.orgId, this.orgId));
        const currentBalance = balanceRows[0]?.balance ?? 0;

        // Deduct consumed credits
        await tx
          .update(creditBalances)
          .set({
            balance: sql`${creditBalances.balance} - ${this.consumedCredits}`,
            reserved: sql`${creditBalances.reserved} - ${this.reservedCredits}`,
          })
          .where(eq(creditBalances.orgId, this.orgId));

        // Record transaction (matching schema: id, orgId, type, amount, balanceAfter, description)
        await tx.insert(creditTransactions).values({
          id: generateId("ctx"),
          orgId: this.orgId,
          amount: -this.consumedCredits,
          balanceAfter: currentBalance - this.consumedCredits,
          type: "consumption",
          taskId: this.taskId,
          description: `Session ${this.sessionId}`,
        });

        // Close reservation (use "committed" which is a valid enum value)
        if (this.reservationId) {
          await tx
            .update(creditReservations)
            .set({ status: "committed" })
            .where(eq(creditReservations.id, this.reservationId));
        }
      });

      logger.info(
        {
          orgId: this.orgId,
          consumed: this.consumedCredits,
          refunded: refundAmount,
        },
        "Credits finalized"
      );
      return { consumed: this.consumedCredits, refunded: refundAmount };
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to finalize credits");
      return { consumed: this.consumedCredits, refunded: 0 };
    }
  }

  /**
   * Refund all reserved credits (on task cancellation).
   */
  async refundAll(): Promise<void> {
    if (!this.reservationId) {
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const balanceRows = await tx
          .select()
          .from(creditBalances)
          .where(eq(creditBalances.orgId, this.orgId));
        const currentBalance = balanceRows[0]?.balance ?? 0;

        await tx
          .update(creditBalances)
          .set({
            reserved: sql`${creditBalances.reserved} - ${this.reservedCredits}`,
          })
          .where(eq(creditBalances.orgId, this.orgId));

        await tx
          .update(creditReservations)
          .set({ status: "released" })
          .where(eq(creditReservations.id, this.reservationId!));

        await tx.insert(creditTransactions).values({
          id: generateId("ctx"),
          orgId: this.orgId,
          amount: 0,
          balanceAfter: currentBalance,
          type: "refund",
          taskId: this.taskId,
          description: `Refund for cancelled session ${this.sessionId}`,
        });
      });

      logger.info(
        { orgId: this.orgId, refunded: this.reservedCredits },
        "Credits refunded"
      );
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to refund credits");
    }
  }

  getConsumed(): number {
    return this.consumedCredits;
  }

  getReserved(): number {
    return this.reservedCredits;
  }

  getRemaining(): number {
    return this.reservedCredits - this.consumedCredits;
  }
}
