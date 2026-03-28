/**
 * Error Recovery Manager — GAP-011
 *
 * Provides a high-level error recovery pipeline that classifies errors,
 * selects recovery strategies, and executes recovery actions with
 * configurable retry policies. Built on top of the existing error-taxonomy
 * and recovery-strategy modules.
 */

import { createLogger } from "@prometheus/logger";
import {
  classifyError,
  type ErrorClassificationContext,
} from "./engine/error-taxonomy";
import {
  type RecoveryAction,
  RecoveryStrategy,
} from "./engine/recovery-strategy";

const logger = createLogger("orchestrator:error-recovery");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorType =
  | "transient"
  | "tool_failure"
  | "llm_error"
  | "sandbox_crash"
  | "budget_exceeded"
  | "unknown";

export type RecoveryStrategyChoice =
  | "retry"
  | "retry_with_backoff"
  | "rollback_and_retry"
  | "skip_step"
  | "escalate_to_human"
  | "fail";

export interface RecoveryContextInput {
  /** Additional classification context for error taxonomy */
  classificationContext?: ErrorClassificationContext;
  /** Current memory limit in MB for sandbox */
  currentMemoryLimitMb?: number;
  /** Last known checkpoint ID for rollback */
  lastCheckpointId?: string;
  /** Maximum number of recovery attempts */
  maxAttempts?: number;
  /** Current model slot */
  modelSlot?: string;
  /** Partial results accumulated before the error */
  partialResults?: string;
}

export interface RecoveryResultOutput {
  /** The chosen recovery strategy */
  action: RecoveryStrategyChoice;
  /** Human-readable description of what was done */
  description: string;
  /** The classified error type */
  errorType: ErrorType;
  /** Message to inject into agent context if retrying */
  injectedPrompt?: string;
  /** New model slot if model was upgraded */
  newModelSlot?: string;
  /** Partial output to return if failing */
  partialOutput?: string;
  /** Checkpoint ID to rollback to */
  rollbackCheckpointId?: string;
  /** Whether recovery was successful */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Error type classification
// ---------------------------------------------------------------------------

const TOOL_FAILURE_PATTERNS = [
  /tool.*fail/i,
  /tool.*error/i,
  /tool.*not.*found/i,
  /command.*failed/i,
  /exit.*code.*[1-9]/i,
  /exec.*fail/i,
];

const LLM_ERROR_PATTERNS = [
  /llm.*error/i,
  /model.*error/i,
  /completion.*fail/i,
  /inference.*fail/i,
  /context.*length/i,
  /token.*limit/i,
  /malformed.*response/i,
];

const SANDBOX_CRASH_PATTERNS = [
  /sandbox.*crash/i,
  /sandbox.*not.*found/i,
  /container.*exit/i,
  /OOM/i,
  /out.*of.*memory/i,
  /ENOMEM/i,
  /signal.*SIGKILL/i,
];

const BUDGET_PATTERNS = [
  /budget.*exceeded/i,
  /credits.*exhaust/i,
  /billing.*exhaust/i,
  /no.*credits.*remaining/i,
  /payment.*required/i,
];

const TRANSIENT_PATTERNS = [
  /rate.*limit/i,
  /too.*many.*requests/i,
  /timeout/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /503/,
  /502/,
  /504/,
];

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(message));
}

// ---------------------------------------------------------------------------
// Max attempts per strategy
// ---------------------------------------------------------------------------

const MAX_RETRY_ATTEMPTS = 3;
const MAX_ROLLBACK_ATTEMPTS = 2;

// ---------------------------------------------------------------------------
// ErrorRecoveryManager
// ---------------------------------------------------------------------------

export class ErrorRecoveryManager {
  private readonly recoveryStrategy: RecoveryStrategy;
  private readonly attemptCounts: Map<string, number> = new Map();

  constructor() {
    this.recoveryStrategy = new RecoveryStrategy();
  }

  /**
   * Classify an error into a high-level error type based on the error
   * message and optional classification context.
   */
  classifyError(error: Error, context?: ErrorClassificationContext): ErrorType {
    const message = error.message;

    if (matchesAny(message, BUDGET_PATTERNS)) {
      return "budget_exceeded";
    }
    if (matchesAny(message, SANDBOX_CRASH_PATTERNS)) {
      return "sandbox_crash";
    }
    if (matchesAny(message, LLM_ERROR_PATTERNS)) {
      return "llm_error";
    }
    if (matchesAny(message, TOOL_FAILURE_PATTERNS)) {
      return "tool_failure";
    }
    if (matchesAny(message, TRANSIENT_PATTERNS)) {
      return "transient";
    }

    // Fall back to the error taxonomy classifier
    const taxonomyCategory = classifyError(error, context);
    switch (taxonomyCategory) {
      case "transient":
        return "transient";
      case "recoverable":
        return "sandbox_crash";
      case "logic":
        return "tool_failure";
      case "fatal":
        return "budget_exceeded";
      default:
        return "unknown";
    }
  }

  /**
   * Determine the best recovery strategy based on the error type
   * and the number of previous recovery attempts for this session.
   */
  getRecoveryStrategy(
    errorType: ErrorType,
    attemptCount: number
  ): RecoveryStrategyChoice {
    switch (errorType) {
      case "transient":
        if (attemptCount >= MAX_RETRY_ATTEMPTS) {
          return "fail";
        }
        return attemptCount === 0 ? "retry" : "retry_with_backoff";

      case "tool_failure":
        if (attemptCount >= MAX_RETRY_ATTEMPTS) {
          return "escalate_to_human";
        }
        return attemptCount === 0 ? "retry" : "skip_step";

      case "llm_error":
        if (attemptCount >= MAX_RETRY_ATTEMPTS) {
          return "escalate_to_human";
        }
        return "retry_with_backoff";

      case "sandbox_crash":
        if (attemptCount >= MAX_ROLLBACK_ATTEMPTS) {
          return "fail";
        }
        return "rollback_and_retry";

      case "budget_exceeded":
        return "fail";

      default:
        if (attemptCount >= MAX_RETRY_ATTEMPTS) {
          return "fail";
        }
        return "retry_with_backoff";
    }
  }

  /**
   * Execute the full recovery pipeline: classify the error, determine
   * the strategy, and execute recovery actions.
   */
  recover(
    sessionId: string,
    error: Error,
    context: RecoveryContextInput = {}
  ): RecoveryResultOutput {
    const attemptKey = `${sessionId}`;
    const attemptCount = this.attemptCounts.get(attemptKey) ?? 0;
    this.attemptCounts.set(attemptKey, attemptCount + 1);

    const errorType = this.classifyError(error, context.classificationContext);
    const strategy = this.getRecoveryStrategy(errorType, attemptCount);

    logger.info(
      {
        sessionId,
        errorType,
        strategy,
        attemptCount,
        errorMessage: error.message,
      },
      "Executing error recovery"
    );

    // Use the existing RecoveryStrategy for taxonomy-based recovery
    const taxonomyAction = this.recoveryStrategy.recover({
      error,
      sessionId,
      attemptCount,
      classificationContext: context.classificationContext,
      currentMemoryLimitMb: context.currentMemoryLimitMb,
    });

    // Map the taxonomy action to our higher-level result
    const result = this.buildRecoveryResult(
      errorType,
      strategy,
      taxonomyAction,
      context,
      attemptCount
    );

    if (strategy === "fail" || strategy === "escalate_to_human") {
      // Reset attempt counter on terminal states
      this.attemptCounts.delete(attemptKey);
    }

    logger.info(
      {
        sessionId,
        success: result.success,
        action: result.action,
        description: result.description,
      },
      "Error recovery completed"
    );

    return result;
  }

  /**
   * Reset the attempt counter for a session (e.g., after a successful execution).
   */
  resetAttempts(sessionId: string): void {
    this.attemptCounts.delete(sessionId);
  }

  /**
   * Get the current attempt count for a session.
   */
  getAttemptCount(sessionId: string): number {
    return this.attemptCounts.get(sessionId) ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildRecoveryResult(
    errorType: ErrorType,
    strategy: RecoveryStrategyChoice,
    taxonomyAction: RecoveryAction,
    context: RecoveryContextInput,
    attemptCount: number
  ): RecoveryResultOutput {
    const base: RecoveryResultOutput = {
      errorType,
      action: strategy,
      success: strategy !== "fail",
      description: `Recovery attempt ${attemptCount + 1}: ${strategy} for ${errorType} error`,
    };

    switch (strategy) {
      case "retry":
        base.injectedPrompt =
          "[Recovery] The previous action failed. Retrying the same approach.";
        break;

      case "retry_with_backoff":
        base.injectedPrompt =
          "[Recovery] The previous action failed after a brief delay. Try again carefully.";
        break;

      case "rollback_and_retry":
        base.rollbackCheckpointId = context.lastCheckpointId;
        base.injectedPrompt =
          "[Recovery] Rolling back to the last checkpoint and retrying with a different approach.";
        break;

      case "skip_step":
        base.injectedPrompt =
          "[Recovery] The current step failed and will be skipped. Continue with the next step.";
        break;

      case "escalate_to_human":
        base.description = `Recovery exhausted after ${attemptCount + 1} attempts. Escalating to human review.`;
        base.injectedPrompt =
          "[Recovery] Unable to resolve the issue automatically. Requesting human assistance.";
        break;

      case "fail":
        base.success = false;
        base.partialOutput = context.partialResults ?? "";
        base.description = `Recovery failed after ${attemptCount + 1} attempts for ${errorType} error.`;
        break;

      default:
        break;
    }

    // Incorporate model upgrade from taxonomy if applicable
    if (taxonomyAction.action === "switch_provider") {
      base.newModelSlot = "think";
    }

    return base;
  }
}
