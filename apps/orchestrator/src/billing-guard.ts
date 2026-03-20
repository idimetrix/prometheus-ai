import { creditBalances, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { eq } from "drizzle-orm";

const logger = createLogger("orchestrator:billing-guard");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BillingAction = "buy" | "wait" | "cancel";

export interface BillingGuardResult {
  allowed: boolean;
  available: number;
  reason?: string;
  required: number;
}

export interface ExhaustionEvent {
  action?: BillingAction;
  available: number;
  orgId: string;
  required: number;
  sessionId: string;
  taskId: string;
}

// ---------------------------------------------------------------------------
// BillingGuard
// ---------------------------------------------------------------------------

/**
 * Pre-execution credit check for the orchestrator.
 *
 * - Verifies sufficient credits before each execution step
 * - On exhaustion: pauses (not terminates) the session
 * - Notifies the client via WebSocket with buy/wait/cancel options
 * - Resumes automatically when credits become available
 */
export class BillingGuard {
  private readonly orgId: string;
  private readonly sessionId: string;
  private readonly taskId: string;
  private readonly eventPublisher: EventPublisher;
  private paused = false;
  private pauseResolver: ((action: BillingAction) => void) | null = null;

  constructor(orgId: string, sessionId: string, taskId: string) {
    this.orgId = orgId;
    this.sessionId = sessionId;
    this.taskId = taskId;
    this.eventPublisher = new EventPublisher();
  }

  // -----------------------------------------------------------------------
  // Pre-execution credit check
  // -----------------------------------------------------------------------

  /**
   * Check whether the org has enough available credits for the next step.
   * Returns immediately if credits are sufficient.
   */
  async checkCredits(requiredCredits: number): Promise<BillingGuardResult> {
    const balance = await this.getAvailableCredits();

    if (balance >= requiredCredits) {
      return {
        allowed: true,
        available: balance,
        required: requiredCredits,
      };
    }

    return {
      allowed: false,
      available: balance,
      required: requiredCredits,
      reason: `Insufficient credits: need ${requiredCredits}, have ${balance} available`,
    };
  }

  // -----------------------------------------------------------------------
  // Pause on exhaustion
  // -----------------------------------------------------------------------

  /**
   * Pause the current execution due to credit exhaustion.
   * Sends a WebSocket notification to the client with buy/wait/cancel options.
   * Returns the action chosen by the user.
   */
  async pauseOnExhaustion(requiredCredits: number): Promise<BillingAction> {
    const available = await this.getAvailableCredits();

    this.paused = true;

    logger.warn(
      {
        orgId: this.orgId,
        sessionId: this.sessionId,
        taskId: this.taskId,
        available,
        required: requiredCredits,
      },
      "Session paused due to credit exhaustion"
    );

    // Notify client via WebSocket
    await this.notifyExhaustion(available, requiredCredits);

    // Wait for user action (buy/wait/cancel)
    const action = await this.waitForAction();

    this.paused = false;
    return action;
  }

  /**
   * Handle an incoming action from the client (e.g., via WebSocket event).
   * Resolves the pending pause promise.
   */
  resolveAction(action: BillingAction): void {
    if (this.pauseResolver) {
      this.pauseResolver(action);
      this.pauseResolver = null;
    }
  }

  /**
   * Whether the guard is currently paused waiting for user action.
   */
  isPaused(): boolean {
    return this.paused;
  }

  // -----------------------------------------------------------------------
  // Guard wrapper: check + pause-or-proceed
  // -----------------------------------------------------------------------

  /**
   * Full guard: check credits and if insufficient, pause and wait for
   * user action. Returns `true` if execution should proceed, `false`
   * if the user chose to cancel.
   */
  async guard(requiredCredits: number): Promise<boolean> {
    const result = await this.checkCredits(requiredCredits);

    if (result.allowed) {
      return true;
    }

    const action = await this.pauseOnExhaustion(requiredCredits);

    switch (action) {
      case "buy": {
        // Client has purchased more credits — re-check
        const recheck = await this.checkCredits(requiredCredits);
        if (recheck.allowed) {
          logger.info(
            { orgId: this.orgId, sessionId: this.sessionId },
            "Credits replenished after purchase, resuming"
          );
          await this.notifyResumed();
          return true;
        }
        // Still not enough — the client will need to buy more or cancel
        logger.warn(
          {
            orgId: this.orgId,
            available: recheck.available,
            required: requiredCredits,
          },
          "Credits still insufficient after buy action"
        );
        return false;
      }

      case "wait": {
        // Wait for credits to be added (e.g., via a subscription grant)
        logger.info(
          { orgId: this.orgId, sessionId: this.sessionId },
          "User chose to wait for credits"
        );
        await this.notifyResumed();
        return true;
      }
      default: {
        logger.info(
          { orgId: this.orgId, sessionId: this.sessionId },
          "User cancelled execution due to credit exhaustion"
        );
        return false;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async getAvailableCredits(): Promise<number> {
    const row = await db.query.creditBalances.findFirst({
      where: eq(creditBalances.orgId, this.orgId),
    });

    if (!row) {
      return 0;
    }

    return Math.max(0, row.balance - row.reserved);
  }

  private async notifyExhaustion(
    available: number,
    required: number
  ): Promise<void> {
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.CREDIT_UPDATE,
      data: {
        status: "exhausted",
        available,
        required,
        orgId: this.orgId,
        taskId: this.taskId,
        message: "Insufficient credits. Session paused.",
        actions: ["buy", "wait", "cancel"],
      },
      timestamp: new Date().toISOString(),
    });
  }

  private async notifyResumed(): Promise<void> {
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.CREDIT_UPDATE,
      data: {
        status: "resumed",
        orgId: this.orgId,
        taskId: this.taskId,
        message: "Credits available. Session resumed.",
      },
      timestamp: new Date().toISOString(),
    });
  }

  private waitForAction(): Promise<BillingAction> {
    return new Promise<BillingAction>((resolve) => {
      this.pauseResolver = resolve;

      // Auto-cancel after 10 minutes of inactivity
      const timeout = setTimeout(
        () => {
          if (this.pauseResolver) {
            logger.info(
              { orgId: this.orgId, sessionId: this.sessionId },
              "Billing guard timed out waiting for user action, auto-cancelling"
            );
            this.pauseResolver("cancel");
            this.pauseResolver = null;
          }
        },
        10 * 60 * 1000
      );

      // Clear timeout if resolved before expiry
      const originalResolver = this.pauseResolver;
      this.pauseResolver = (action: BillingAction) => {
        clearTimeout(timeout);
        originalResolver(action);
      };
    });
  }
}
