import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:slot-fallback");

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlotType =
  | "think"
  | "default"
  | "premium"
  | "vision"
  | "background"
  | "review"
  | "fastLoop"
  | "longContext";

export interface FallbackDecision {
  /** Whether this is a degraded experience */
  degraded: boolean;
  /** The fallback slot to use */
  fallbackSlot: SlotType | null;
  /** Whether to modify the prompt */
  promptModification?: string;
  /** Whether to skip this request entirely */
  skip: boolean;
  /** User-facing message */
  userMessage?: string;
}

// ─── Slot Fallback Strategies ─────────────────────────────────────────────────

const FALLBACK_STRATEGIES: Record<string, (error: string) => FallbackDecision> =
  {
    think: (_error: string) => ({
      fallbackSlot: "default",
      promptModification:
        "Think step-by-step and reason carefully about this problem before providing your answer. " +
        "Break down complex issues into smaller parts. Show your reasoning process.",
      skip: false,
      degraded: true,
      userMessage:
        "Deep reasoning model unavailable. Using extended reasoning prompt with default model.",
    }),

    premium: (_error: string) => ({
      fallbackSlot: "think",
      skip: false,
      degraded: true,
      userMessage:
        "Premium model unavailable. Falling back to thinking model. Results may vary in quality.",
    }),

    vision: (_error: string) => ({
      fallbackSlot: null,
      skip: true,
      degraded: true,
      userMessage:
        "Vision model unavailable. Please provide a text description of the image instead.",
    }),

    default: (_error: string) => ({
      fallbackSlot: "background",
      skip: false,
      degraded: true,
      userMessage:
        "Default model unavailable. Using background model. Response quality may be reduced.",
    }),

    longContext: (_error: string) => ({
      fallbackSlot: "default",
      promptModification:
        "Note: The input has been truncated to fit within context limits. " +
        "Focus on the most relevant sections.",
      skip: false,
      degraded: true,
      userMessage:
        "Long context model unavailable. Using default model with truncated input.",
    }),
  };

// ─── Slot Fallback ────────────────────────────────────────────────────────────

export class SlotFallback {
  /**
   * Determine the fallback strategy for a given slot when an error occurs.
   *
   * @param slot - The original slot that failed
   * @param error - The error message or reason for failure
   */
  getFallback(slot: string, error: string): FallbackDecision {
    const strategy = FALLBACK_STRATEGIES[slot];

    if (strategy) {
      const decision = strategy(error);
      logger.info(
        {
          originalSlot: slot,
          fallbackSlot: decision.fallbackSlot,
          skip: decision.skip,
          degraded: decision.degraded,
          error,
        },
        "Slot fallback decision made"
      );
      return decision;
    }

    // Unknown slot: try default as fallback
    logger.warn(
      { slot, error },
      "No fallback strategy for slot, attempting default"
    );
    return {
      fallbackSlot: "default",
      skip: false,
      degraded: true,
      userMessage: `Model slot "${slot}" unavailable. Using default model.`,
    };
  }

  /**
   * Get all available fallback chains for documentation/monitoring.
   */
  getFallbackChains(): Record<string, string> {
    return {
      think: "think -> default (with extended reasoning prompt)",
      premium: "premium -> think (with warning)",
      vision: "vision -> skip (request user description)",
      default: "default -> background",
      longContext: "longContext -> default (with truncation note)",
    };
  }
}
