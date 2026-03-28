import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:budget-guard");

/** Warning threshold — pause when within 90% of any limit */
const WARNING_THRESHOLD = 0.9;

export interface BudgetSession {
  /** Current credits consumed in USD */
  creditsConsumed?: number;
  /** Current iteration count */
  iterationCount?: number;
  /** Maximum credits in USD */
  maxCreditsUsd?: number | null;
  /** Maximum duration in minutes */
  maxDurationMinutes?: number | null;
  /** Maximum iterations before auto-pause */
  maxIterations?: number | null;
  /** Session start time */
  startedAt: Date;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * BudgetGuard enforces resource limits on long-running sessions.
 * Checks iteration count, credit consumption, and elapsed duration
 * against configured maximums.
 */
export class BudgetGuard {
  /**
   * Check whether the session is within its configured budget limits.
   * Returns { allowed: false, reason } if any limit has been exceeded.
   */
  checkBudget(session: BudgetSession): BudgetCheckResult {
    // Check iteration limit
    if (
      session.maxIterations != null &&
      session.iterationCount != null &&
      session.iterationCount >= session.maxIterations
    ) {
      const reason = `Iteration limit reached: ${session.iterationCount}/${session.maxIterations}`;
      logger.warn({ reason }, "Budget exceeded");
      return { allowed: false, reason };
    }

    // Check credit limit
    if (
      session.maxCreditsUsd != null &&
      session.creditsConsumed != null &&
      session.creditsConsumed >= session.maxCreditsUsd
    ) {
      const reason = `Credit limit reached: $${session.creditsConsumed.toFixed(2)}/$${session.maxCreditsUsd.toFixed(2)}`;
      logger.warn({ reason }, "Budget exceeded");
      return { allowed: false, reason };
    }

    // Check duration limit
    if (session.maxDurationMinutes != null) {
      const elapsedMs = Date.now() - session.startedAt.getTime();
      const elapsedMinutes = elapsedMs / 60_000;

      if (elapsedMinutes >= session.maxDurationMinutes) {
        const reason = `Duration limit reached: ${Math.round(elapsedMinutes)}/${session.maxDurationMinutes} minutes`;
        logger.warn({ reason }, "Budget exceeded");
        return { allowed: false, reason };
      }
    }

    return { allowed: true };
  }

  /**
   * Returns true if the session is within 90% of any configured limit.
   * Useful for showing warnings before hard limits are hit.
   */
  shouldPause(session: BudgetSession): boolean {
    // Check iteration warning threshold
    if (
      session.maxIterations != null &&
      session.iterationCount != null &&
      session.iterationCount >= session.maxIterations * WARNING_THRESHOLD
    ) {
      logger.info(
        {
          iterationCount: session.iterationCount,
          maxIterations: session.maxIterations,
        },
        "Approaching iteration limit"
      );
      return true;
    }

    // Check credit warning threshold
    if (
      session.maxCreditsUsd != null &&
      session.creditsConsumed != null &&
      session.creditsConsumed >= session.maxCreditsUsd * WARNING_THRESHOLD
    ) {
      logger.info(
        {
          creditsConsumed: session.creditsConsumed,
          maxCreditsUsd: session.maxCreditsUsd,
        },
        "Approaching credit limit"
      );
      return true;
    }

    // Check duration warning threshold
    if (session.maxDurationMinutes != null) {
      const elapsedMs = Date.now() - session.startedAt.getTime();
      const elapsedMinutes = elapsedMs / 60_000;

      if (elapsedMinutes >= session.maxDurationMinutes * WARNING_THRESHOLD) {
        logger.info(
          {
            elapsedMinutes: Math.round(elapsedMinutes),
            maxDurationMinutes: session.maxDurationMinutes,
          },
          "Approaching duration limit"
        );
        return true;
      }
    }

    return false;
  }
}
