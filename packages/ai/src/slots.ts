// =============================================================================
// @prometheus/ai — Routing Slots
// =============================================================================
// The 8 routing slots, each with a primary model and fallback chain.
// Slots map task types to the optimal model selection strategy.
// =============================================================================

export type RoutingSlot =
  | "default"
  | "think"
  | "longContext"
  | "background"
  | "vision"
  | "review"
  | "fastLoop"
  | "premium";

export interface SlotConfig {
  /** Ordered model chain: primary first, then fallbacks */
  chain: string[];
  /** Maximum temperature for this slot (defaults applied if not set by caller) */
  defaultTemperature: number;
  /** Human-readable description */
  description: string;
  /** Whether streaming is preferred for this slot */
  preferStreaming: boolean;
  /** Slot identifier */
  slot: RoutingSlot;
}

/**
 * Slot configuration table.
 *
 * Strategy: Free local models (Ollama) handle most work. Free cloud APIs
 * (Groq, Cerebras, Gemini) serve as fast fallbacks. Paid APIs (Anthropic)
 * are reserved for premium features (vision, review, complex tasks).
 */
export const SLOT_CONFIGS: Record<RoutingSlot, SlotConfig> = {
  // ---------------------------------------------------------------------------
  // default — General code generation (most common)
  // ---------------------------------------------------------------------------
  default: {
    slot: "default",
    description: "General code generation and routine coding tasks",
    chain: [
      "ollama/qwen3-coder-next",
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
    ],
    defaultTemperature: 0.7,
    preferStreaming: true,
  },

  // ---------------------------------------------------------------------------
  // think — Deep reasoning, planning, architecture
  // ---------------------------------------------------------------------------
  think: {
    slot: "think",
    description: "Deep reasoning, planning, and architecture decisions",
    chain: [
      "ollama/deepseek-r1:32b",
      "ollama/qwen3.5:27b",
      "anthropic/claude-sonnet-4-6",
    ],
    defaultTemperature: 0.5,
    preferStreaming: true,
  },

  // ---------------------------------------------------------------------------
  // longContext — Large file / codebase analysis (>32K tokens)
  // ---------------------------------------------------------------------------
  longContext: {
    slot: "longContext",
    description: "Large file analysis, codebase-wide context (>32K tokens)",
    chain: [
      "gemini/gemini-2.5-flash",
      "anthropic/claude-sonnet-4-6",
      "ollama/qwen3-coder-next",
    ],
    defaultTemperature: 0.3,
    preferStreaming: true,
  },

  // ---------------------------------------------------------------------------
  // background — Low-priority tasks: indexing, embeddings, lightweight work
  // ---------------------------------------------------------------------------
  background: {
    slot: "background",
    description:
      "Low-priority background tasks, indexing, and lightweight work",
    chain: [
      "ollama/qwen2.5-coder:7b",
      "ollama/qwen2.5-coder:14b",
      "ollama/qwen3-coder-next",
    ],
    defaultTemperature: 0.3,
    preferStreaming: false,
  },

  // ---------------------------------------------------------------------------
  // vision — Image and screenshot understanding
  // ---------------------------------------------------------------------------
  vision: {
    slot: "vision",
    description: "Image and screenshot analysis, UI-to-code conversion",
    chain: ["anthropic/claude-sonnet-4-6", "gemini/gemini-2.5-flash"],
    defaultTemperature: 0.4,
    preferStreaming: true,
  },

  // ---------------------------------------------------------------------------
  // review — Code review, security audit, quality analysis
  // ---------------------------------------------------------------------------
  review: {
    slot: "review",
    description: "Code review, security audits, and quality analysis",
    chain: [
      "anthropic/claude-sonnet-4-6",
      "ollama/deepseek-r1:32b",
      "ollama/qwen3.5:27b",
    ],
    defaultTemperature: 0.3,
    preferStreaming: true,
  },

  // ---------------------------------------------------------------------------
  // fastLoop — Rapid CI loop iterations, quick fixes
  // ---------------------------------------------------------------------------
  fastLoop: {
    slot: "fastLoop",
    description: "Fast CI loop iterations, quick fixes, rapid feedback",
    chain: [
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
      "ollama/qwen3-coder-next",
    ],
    defaultTemperature: 0.5,
    preferStreaming: true,
  },

  // ---------------------------------------------------------------------------
  // premium — Complex/critical tasks, highest quality
  // ---------------------------------------------------------------------------
  premium: {
    slot: "premium",
    description:
      "Critical decisions, most complex tasks requiring highest quality",
    chain: [
      "anthropic/claude-opus-4-6",
      "anthropic/claude-sonnet-4-6",
      "ollama/deepseek-r1:32b",
    ],
    defaultTemperature: 0.5,
    preferStreaming: true,
  },
};

/**
 * Get the slot configuration for a given slot name.
 */
export function getSlotConfig(slot: RoutingSlot): SlotConfig {
  return SLOT_CONFIGS[slot];
}

/**
 * Get all slot names.
 */
export function getAllSlots(): RoutingSlot[] {
  return Object.keys(SLOT_CONFIGS) as RoutingSlot[];
}

/**
 * Auto-detect the best slot for a request based on heuristics.
 */
export function autoDetectSlot(options: {
  tokenCount?: number;
  taskType?: string;
  hasImages?: boolean;
}): RoutingSlot {
  const { tokenCount, taskType, hasImages } = options;

  // Vision tasks
  if (hasImages) {
    return "vision";
  }

  // Long context (>32K tokens)
  if (tokenCount && tokenCount > 32_000) {
    return "longContext";
  }

  // Task-type based routing
  if (taskType) {
    const lower = taskType.toLowerCase();

    if (/reason|plan|architect|design|debug complex/i.test(lower)) {
      return "think";
    }
    if (/review|audit|security|quality/i.test(lower)) {
      return "review";
    }
    if (/fast|ci|loop|iterate|quick fix/i.test(lower)) {
      return "fastLoop";
    }
    if (/index|embed|background|crawl|low.?priority/i.test(lower)) {
      return "background";
    }
    if (/premium|critical|complex|high.?stakes/i.test(lower)) {
      return "premium";
    }
    if (/vision|screenshot|image|ui.?to.?code/i.test(lower)) {
      return "vision";
    }
  }

  // Default for general coding tasks
  return "default";
}
