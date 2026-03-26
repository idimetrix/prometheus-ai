/**
 * Phase 20.2: Recovery Strategies.
 *
 * Determines and executes the best recovery strategy when an agent gets stuck.
 * Strategies range from gentle prompting to model upgrades to full abort.
 *
 * Enhanced with error-taxonomy-based recovery actions that map each
 * ErrorCategory to specific, structured recovery actions.
 */
import { createLogger } from "@prometheus/logger";
import {
  classifyError,
  ErrorCategory,
  type ErrorClassificationContext,
  isOOMError,
  isRateLimitError,
  isSandboxCrashError,
} from "./error-taxonomy";

const logger = createLogger("orchestrator:recovery-strategy");

export type RecoveryStrategyType =
  | "inject_reflection"
  | "rollback_checkpoint"
  | "upgrade_model"
  | "abort_partial";

// ---------------------------------------------------------------------------
// Recovery Action (error-taxonomy-based)
// ---------------------------------------------------------------------------

export type RecoveryActionType =
  | "retry"
  | "switch_provider"
  | "restore_checkpoint"
  | "replan"
  | "stop";

export interface RecoveryAction {
  /** The recovery action to take */
  action: RecoveryActionType;
  /** Resource adjustments for checkpoint restore */
  adjustResources?: { memoryLimitMb: number };
  /** Delay in ms before retrying (for retry actions) */
  delay?: number;
  /** Instruction to inject for re-planning */
  instruction?: string;
  /** Maximum number of retries */
  maxRetries?: number;
  /** Whether to notify the user */
  notify?: boolean;
  /** Reason for stopping */
  reason?: string;
  /** Whether to recreate the sandbox */
  recreateSandbox?: boolean;
  /** Whether to use a stricter prompt */
  stricterPrompt?: boolean;
}

export interface ErrorRecoveryContext {
  /** Current retry attempt count */
  attemptCount: number;
  /** Additional classification context */
  classificationContext?: ErrorClassificationContext;
  /** Current memory limit in MB */
  currentMemoryLimitMb?: number;
  /** The original error */
  error: Error;
  /** Session identifier */
  sessionId: string;
}

export interface RecoveryContext {
  /** Number of recovery attempts already made */
  attemptCount: number;
  /** Current model slot */
  currentModelSlot?: string;
  /** Last checkpoint ID if available */
  lastCheckpointId?: string;
  /** Partial results accumulated so far */
  partialResults?: string;
  /** Reason the agent is stuck */
  reason: string;
  /** Current session identifier */
  sessionId: string;
}

export interface RecoveryResult {
  /** Human-readable description of what was done */
  description: string;
  /** Message to inject into the agent context (if applicable) */
  injectedPrompt?: string;
  /** New model slot (if upgraded) */
  newModelSlot?: string;
  /** Partial output to return (if aborting) */
  partialOutput?: string;
  /** Checkpoint to roll back to (if applicable) */
  rollbackCheckpointId?: string;
  /** The strategy that was applied */
  strategy: RecoveryStrategyType;
  /** Whether recovery was successfully applied */
  success: boolean;
}

/** Maximum recovery attempts before forcing abort */
const MAX_RECOVERY_ATTEMPTS = 3;

/** Model escalation order */
const MODEL_ESCALATION: Record<string, string> = {
  default: "think",
  think: "review",
  review: "premium",
  premium: "premium",
};

/**
 * Strategy resolver: given an attempt count and optional context,
 * returns the appropriate recovery strategy for a specific reason.
 */
type StrategyResolver = (
  attemptCount: number,
  context?: Partial<RecoveryContext>
) => RecoveryStrategyType;

/** Default resolver: reflection on first attempt, then abort. */
const defaultResolver: StrategyResolver = (attemptCount) =>
  attemptCount === 0 ? "inject_reflection" : "abort_partial";

/**
 * Lookup table mapping stuck-agent reasons to strategy resolvers.
 * Each resolver encapsulates the escalation logic for that reason.
 */
const REASON_STRATEGIES: Record<string, StrategyResolver> = {
  infinite_loop: (attemptCount, context) => {
    if (attemptCount === 0) {
      return "inject_reflection";
    }
    if (attemptCount === 1 && context?.lastCheckpointId) {
      return "rollback_checkpoint";
    }
    return "upgrade_model";
  },

  stale_timeout: (attemptCount) =>
    attemptCount === 0 ? "inject_reflection" : "upgrade_model",

  extended_stale: (attemptCount) =>
    attemptCount === 0 ? "upgrade_model" : "abort_partial",

  llm_rate_limit: defaultResolver,

  llm_timeout: (attemptCount) =>
    attemptCount === 0 ? "inject_reflection" : "upgrade_model",

  llm_server_error: (attemptCount, context) => {
    if (attemptCount === 0) {
      return "inject_reflection";
    }
    if (attemptCount === 1 && context?.lastCheckpointId) {
      return "rollback_checkpoint";
    }
    return "abort_partial";
  },

  sandbox_crash: (attemptCount, context) => {
    if (context?.lastCheckpointId) {
      return "rollback_checkpoint";
    }
    return attemptCount === 0 ? "inject_reflection" : "abort_partial";
  },

  redis_disconnect: defaultResolver,
};

export class RecoveryStrategy {
  /**
   * Determine the best recovery strategy for a stuck agent.
   */
  handleStuckAgent(
    sessionId: string,
    reason: string,
    context?: Partial<RecoveryContext>
  ): RecoveryStrategyType {
    const attemptCount = context?.attemptCount ?? 0;

    // Too many recovery attempts - abort
    if (attemptCount >= MAX_RECOVERY_ATTEMPTS) {
      logger.warn(
        { sessionId, attemptCount },
        "Max recovery attempts reached, aborting"
      );
      return "abort_partial";
    }

    const resolver = REASON_STRATEGIES[reason] ?? defaultResolver;
    return resolver(attemptCount, context);
  }

  /**
   * Execute the chosen recovery strategy and return the result.
   */
  executeRecovery(
    strategy: RecoveryStrategyType,
    context: RecoveryContext
  ): RecoveryResult {
    logger.info(
      {
        sessionId: context.sessionId,
        strategy,
        attemptCount: context.attemptCount,
        reason: context.reason,
      },
      "Executing recovery strategy"
    );

    switch (strategy) {
      case "inject_reflection":
        return this.injectReflection(context);
      case "rollback_checkpoint":
        return this.rollbackToCheckpoint(context);
      case "upgrade_model":
        return this.upgradeModel(context);
      case "abort_partial":
        return this.abortWithPartialResults(context);
      default:
        return this.injectReflection(context);
    }
  }

  private injectReflection(context: RecoveryContext): RecoveryResult {
    const prompt = [
      "[Recovery] You appear to be stuck. Step back and reconsider your approach.",
      `Reason: ${context.reason}`,
      "",
      "Please:",
      "1. Review what you have accomplished so far",
      "2. Identify what is blocking progress",
      "3. Consider an alternative approach",
      "4. If the current path is not working, try a completely different strategy",
      "",
      "Do NOT repeat the same actions you have already tried.",
    ].join("\n");

    return {
      strategy: "inject_reflection",
      success: true,
      injectedPrompt: prompt,
      description: `Injected reflection prompt to help agent reconsider approach (attempt ${context.attemptCount + 1})`,
    };
  }

  private rollbackToCheckpoint(context: RecoveryContext): RecoveryResult {
    if (!context.lastCheckpointId) {
      // No checkpoint available - fall back to reflection
      return this.injectReflection(context);
    }

    return {
      strategy: "rollback_checkpoint",
      success: true,
      rollbackCheckpointId: context.lastCheckpointId,
      injectedPrompt:
        "[Recovery] Rolling back to last checkpoint. Try a different approach from this point.",
      description: `Rolling back to checkpoint ${context.lastCheckpointId}`,
    };
  }

  private upgradeModel(context: RecoveryContext): RecoveryResult {
    const currentSlot = context.currentModelSlot ?? "default";
    const newSlot = MODEL_ESCALATION[currentSlot] ?? "premium";

    if (newSlot === currentSlot) {
      // Already at highest tier - inject reflection instead
      return {
        strategy: "upgrade_model",
        success: true,
        newModelSlot: newSlot,
        injectedPrompt:
          "[Recovery] Already using the strongest model. Reassess the problem and try a simpler approach.",
        description: `Already at highest model tier (${currentSlot}), injecting reflection`,
      };
    }

    return {
      strategy: "upgrade_model",
      success: true,
      newModelSlot: newSlot,
      injectedPrompt: `[Recovery] Upgrading to a more capable model (${currentSlot} -> ${newSlot}). Continue with a fresh perspective.`,
      description: `Upgraded model from ${currentSlot} to ${newSlot}`,
    };
  }

  private abortWithPartialResults(context: RecoveryContext): RecoveryResult {
    return {
      strategy: "abort_partial",
      success: true,
      partialOutput: context.partialResults ?? "",
      description: `Aborting after ${context.attemptCount} recovery attempts. Returning partial results.`,
    };
  }

  // ---------------------------------------------------------------------------
  // Error-taxonomy-based recovery
  // ---------------------------------------------------------------------------

  /**
   * Determine the appropriate recovery action based on the error taxonomy.
   * This is the primary entry point for error-based recovery decisions.
   */
  recover(errorContext: ErrorRecoveryContext): RecoveryAction {
    const { error, attemptCount, sessionId, classificationContext } =
      errorContext;

    const category = classifyError(error, classificationContext);

    logger.info(
      {
        sessionId,
        category,
        attemptCount,
        errorMessage: error.message,
      },
      "Determining recovery action from error taxonomy"
    );

    switch (category) {
      case ErrorCategory.TRANSIENT:
        return this.recoverTransient(error, attemptCount);
      case ErrorCategory.RECOVERABLE:
        return this.recoverRecoverable(error, errorContext);
      case ErrorCategory.LOGIC:
        return this.recoverLogic(error, classificationContext);
      case ErrorCategory.FATAL:
        return this.recoverFatal(error);
      default:
        return { action: "stop", notify: true, reason: error.message };
    }
  }

  private recoverTransient(error: Error, attemptCount: number): RecoveryAction {
    // Rate limit errors: switch to a different provider via model-router
    if (isRateLimitError(error)) {
      if (attemptCount === 0) {
        return { action: "switch_provider" };
      }
      // If we already tried switching, fall back to exponential backoff
      return {
        action: "retry",
        delay: this.exponentialBackoff(attemptCount),
        maxRetries: 3,
      };
    }

    // General transient errors: retry with exponential backoff
    if (attemptCount >= 3) {
      return {
        action: "stop",
        notify: true,
        reason: `Transient error persisted after 3 retries: ${error.message}`,
      };
    }

    return {
      action: "retry",
      delay: this.exponentialBackoff(attemptCount),
      maxRetries: 3,
    };
  }

  private recoverRecoverable(
    error: Error,
    context: ErrorRecoveryContext
  ): RecoveryAction {
    if (isOOMError(error)) {
      const currentMemory = context.currentMemoryLimitMb ?? 512;
      return {
        action: "restore_checkpoint",
        adjustResources: { memoryLimitMb: currentMemory * 2 },
      };
    }

    if (isSandboxCrashError(error)) {
      return {
        action: "restore_checkpoint",
        recreateSandbox: true,
      };
    }

    // Generic recoverable: restore checkpoint
    return { action: "restore_checkpoint" };
  }

  private recoverLogic(
    _error: Error,
    classificationContext?: ErrorClassificationContext
  ): RecoveryAction {
    // If the error is about invalid tool output / hallucination, retry with stricter prompt
    if (classificationContext?.isInvalidToolOutput) {
      return {
        action: "retry",
        stricterPrompt: true,
        maxRetries: 2,
      };
    }

    // Repeated tool calls / infinite loop: re-plan
    return {
      action: "replan",
      instruction:
        "Previous approach failed. Analyze what went wrong and try a completely different strategy. Do NOT repeat the same tool calls.",
    };
  }

  private recoverFatal(error: Error): RecoveryAction {
    return {
      action: "stop",
      notify: true,
      reason: error.message,
    };
  }

  private exponentialBackoff(attempt: number): number {
    const baseDelay = 1000;
    const maxDelay = 30_000;
    const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
    // Add jitter (up to 25% of the delay)
    const jitter = Math.random() * delay * 0.25;
    return Math.round(delay + jitter);
  }
}
