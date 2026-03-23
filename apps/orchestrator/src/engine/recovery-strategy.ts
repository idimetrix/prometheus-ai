/**
 * Phase 20.2: Recovery Strategies.
 *
 * Determines and executes the best recovery strategy when an agent gets stuck.
 * Strategies range from gentle prompting to model upgrades to full abort.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:recovery-strategy");

export type RecoveryStrategyType =
  | "inject_reflection"
  | "rollback_checkpoint"
  | "upgrade_model"
  | "abort_partial";

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

    // Determine strategy based on reason
    if (reason === "infinite_loop") {
      // First attempt: inject reflection, then rollback, then upgrade
      if (attemptCount === 0) {
        return "inject_reflection";
      }
      if (attemptCount === 1 && context?.lastCheckpointId) {
        return "rollback_checkpoint";
      }
      return "upgrade_model";
    }

    if (reason === "stale_timeout") {
      // Stale agent: try reflection first, then upgrade model
      if (attemptCount === 0) {
        return "inject_reflection";
      }
      return "upgrade_model";
    }

    if (reason === "extended_stale") {
      // Long stale period: upgrade model immediately
      if (attemptCount === 0) {
        return "upgrade_model";
      }
      return "abort_partial";
    }

    // Default: try reflection
    return attemptCount === 0 ? "inject_reflection" : "abort_partial";
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
}
