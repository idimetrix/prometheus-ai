// =============================================================================
// @prometheus/ai — Token Optimizer
// =============================================================================
// Proactive token optimization: prompt caching, output length prediction,
// context compression before hitting limits, and budget awareness.
// =============================================================================

import { createLogger } from "@prometheus/logger";
import {
  estimateMessageTokens,
  estimateTokens,
  truncateToTokens,
} from "./tokens";

const logger = createLogger("ai:token-optimizer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A chat message compatible with LLM APIs. */
export interface Message {
  content: string;
  role: "system" | "user" | "assistant" | "tool";
  toolCallId?: string;
}

/** Complexity-to-token multipliers by task type. */
const TASK_TYPE_MULTIPLIERS: Record<string, number> = {
  code_generation: 1.2,
  code_review: 0.8,
  refactor: 1.0,
  bug_fix: 0.9,
  test_writing: 1.1,
  documentation: 0.7,
  architecture: 1.5,
  planning: 1.3,
  explanation: 0.6,
  default: 1.0,
};

/** Base output tokens per unit of complexity. */
const BASE_OUTPUT_PER_COMPLEXITY = 256;

// ---------------------------------------------------------------------------
// TokenOptimizer
// ---------------------------------------------------------------------------

/**
 * Manages token budgets across LLM interactions. Provides prompt caching keys,
 * output length prediction, and context compression to stay within limits.
 */
export class TokenOptimizer {
  private readonly promptCache = new Map<string, string>();

  /**
   * Generate a stable cache key for a system prompt.
   *
   * System prompts rarely change between iterations. By hashing them, callers
   * can check whether the prompt was already sent in a previous request and
   * leverage provider-side prompt caching (Anthropic cache_control,
   * OpenAI predicted_output, etc.).
   */
  cacheKey(systemPrompt: string): string {
    // Fast string hash (FNV-1a inspired, JS-safe 32-bit)
    let hash = 0x81_1c_9d_c5;
    for (let i = 0; i < systemPrompt.length; i++) {
      // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash requires XOR
      hash ^= systemPrompt.charCodeAt(i);
      hash = Math.imul(hash, 0x01_00_01_93);
    }
    // biome-ignore lint/suspicious/noBitwiseOperators: unsigned right shift for positive 32-bit
    const key = `prompt_${(hash >>> 0).toString(36)}`;

    // Store in local cache for lookup
    if (!this.promptCache.has(key)) {
      this.promptCache.set(key, systemPrompt);
      logger.debug(
        { key, length: systemPrompt.length },
        "Cached system prompt"
      );
    }

    return key;
  }

  /**
   * Look up a previously cached system prompt by its cache key.
   */
  getCachedPrompt(key: string): string | undefined {
    return this.promptCache.get(key);
  }

  /**
   * Predict the expected output token count based on task complexity and type.
   *
   * Complexity is a 1-10 scale where:
   * - 1-3: Simple (variable rename, small fix, short answer)
   * - 4-6: Medium (new function, test suite, moderate refactor)
   * - 7-9: Complex (new module, architecture design, large refactor)
   * - 10: Maximum (full feature implementation, multi-file rewrite)
   *
   * @param complexity - Task complexity on a 1-10 scale
   * @param taskType - Category of task (code_generation, bug_fix, etc.)
   * @returns Estimated output tokens
   */
  predictOutputLength(complexity: number, taskType: string): number {
    const clampedComplexity = Math.max(1, Math.min(10, complexity));
    const multiplier =
      TASK_TYPE_MULTIPLIERS[taskType] ?? TASK_TYPE_MULTIPLIERS.default ?? 1.0;

    // Quadratic scaling — complex tasks grow output disproportionately
    const predicted = Math.ceil(
      BASE_OUTPUT_PER_COMPLEXITY *
        clampedComplexity *
        (1 + clampedComplexity * 0.1) *
        multiplier
    );

    logger.debug(
      { complexity: clampedComplexity, taskType, multiplier, predicted },
      "Predicted output length"
    );

    return predicted;
  }

  /**
   * Check whether the current message history should be compressed.
   *
   * Returns true when estimated token usage exceeds the threshold percentage
   * of the context limit.
   *
   * @param messages - Current conversation messages
   * @param contextLimit - Model's context window size in tokens
   * @param threshold - Fraction (0-1) at which to trigger compression (default: 0.8)
   */
  shouldCompress(
    messages: Message[],
    contextLimit: number,
    threshold = 0.8
  ): boolean {
    const estimated = estimateMessageTokens(
      messages.map((m) => ({ role: m.role, content: m.content }))
    );
    const ratio = estimated / contextLimit;

    if (ratio >= threshold) {
      logger.info(
        {
          estimatedTokens: estimated,
          contextLimit,
          ratio: ratio.toFixed(3),
          threshold,
        },
        "Context compression recommended"
      );
      return true;
    }

    return false;
  }

  /**
   * Compress a message history to fit within a target token budget.
   *
   * Strategy (in order of aggressiveness):
   * 1. Remove tool result outputs beyond a summary
   * 2. Summarize older assistant messages (keep recent N)
   * 3. Truncate the longest individual messages
   *
   * The first system message and the most recent user message are always preserved.
   *
   * @param messages - Full message history
   * @param maxTokens - Target token budget to compress into
   * @returns Compressed message array fitting within the budget
   */
  compressContext(messages: Message[], maxTokens: number): Message[] {
    const currentTokens = estimateMessageTokens(
      messages.map((m) => ({ role: m.role, content: m.content }))
    );

    if (currentTokens <= maxTokens) {
      return messages;
    }

    logger.info(
      { currentTokens, maxTokens, messageCount: messages.length },
      "Compressing context"
    );

    const result = [...messages];

    // Phase 1: Truncate tool result messages (keep first 200 chars + summary)
    const toolMessageBudget = 200;
    for (let i = 0; i < result.length; i++) {
      const msg = result[i] as Message;
      if (msg.role === "tool" && msg.content.length > toolMessageBudget) {
        result[i] = {
          ...msg,
          content: `${msg.content.slice(0, toolMessageBudget)}\n... [tool output truncated, ${estimateTokens(msg.content)} tokens original]`,
        };
      }
    }

    let compressed = estimateMessageTokens(
      result.map((m) => ({ role: m.role, content: m.content }))
    );
    if (compressed <= maxTokens) {
      return result;
    }

    // Phase 2: Summarize older assistant messages (preserve last 4)
    const preserveRecent = 4;
    let assistantCount = 0;
    for (let i = result.length - 1; i >= 0; i--) {
      if ((result[i] as Message).role === "assistant") {
        assistantCount++;
      }
    }

    if (assistantCount > preserveRecent) {
      let seen = 0;
      for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i] as Message;
        if (msg.role === "assistant") {
          seen++;
          if (seen > preserveRecent && msg.content.length > 300) {
            result[i] = {
              ...msg,
              content: `[Earlier assistant response summarized: ${msg.content.slice(0, 150)}...]`,
            };
          }
        }
      }
    }

    compressed = estimateMessageTokens(
      result.map((m) => ({ role: m.role, content: m.content }))
    );
    if (compressed <= maxTokens) {
      return result;
    }

    // Phase 3: Truncate the longest messages (skip first system and last user)
    const firstSystemIdx = result.findIndex((m) => m.role === "system");
    let lastUserIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if ((result[i] as Message).role === "user") {
        lastUserIdx = i;
        break;
      }
    }

    // Sort indices by content length (longest first), excluding protected messages
    const truncateCandidates = result
      .map((m, idx) => ({ idx, length: m.content.length }))
      .filter(
        (entry) => entry.idx !== firstSystemIdx && entry.idx !== lastUserIdx
      )
      .sort((a, b) => b.length - a.length);

    for (const candidate of truncateCandidates) {
      if (compressed <= maxTokens) {
        break;
      }

      const msg = result[candidate.idx] as Message;
      const msgTokens = estimateTokens(msg.content);
      // Allow at most half the per-message budget
      const targetTokens = Math.min(
        msgTokens,
        Math.ceil(maxTokens / result.length)
      );
      const truncated = truncateToTokens(msg.content, targetTokens);

      result[candidate.idx] = { ...msg, content: truncated };

      compressed = estimateMessageTokens(
        result.map((m) => ({ role: m.role, content: m.content }))
      );
    }

    logger.info(
      {
        originalTokens: currentTokens,
        compressedTokens: compressed,
        ratio: (compressed / currentTokens).toFixed(3),
      },
      "Context compression complete"
    );

    return result;
  }

  /**
   * Predict the total token count for a message array.
   *
   * @param messages - Array of messages to estimate
   * @returns Estimated total tokens including message framing overhead
   */
  predictTokenBudget(messages: Message[]): number {
    return estimateMessageTokens(
      messages.map((m) => ({ role: m.role, content: m.content }))
    );
  }

  /**
   * Intelligently truncate messages to fit within a context window budget.
   *
   * Strategy prioritises retaining:
   * 1. The system message (always kept in full)
   * 2. The most recent user messages and tool results
   * 3. Recent assistant messages
   *
   * Older messages are progressively truncated or removed, starting from
   * the oldest non-system messages. Tool result messages are truncated
   * before other message types.
   *
   * @param messages - Full message history
   * @param maxTokens - Maximum token budget for the entire message array
   * @returns Message array that fits within the budget
   */
  fitToBudget(messages: Message[], maxTokens: number): Message[] {
    const currentTokens = this.predictTokenBudget(messages);

    if (currentTokens <= maxTokens) {
      return messages;
    }

    logger.info(
      { currentTokens, maxTokens, messageCount: messages.length },
      "Fitting messages to token budget"
    );

    const result = [...messages];

    // Identify protected indices: first system message and recent user messages
    const systemIdx = result.findIndex((m) => m.role === "system");

    // Find the last 3 user message indices (high priority to keep)
    const recentUserIndices: number[] = [];
    for (let i = result.length - 1; i >= 0; i--) {
      if ((result[i] as Message).role === "user") {
        recentUserIndices.push(i);
        if (recentUserIndices.length >= 3) {
          break;
        }
      }
    }

    // Find recent tool result indices (keep last 2)
    const recentToolIndices: number[] = [];
    for (let i = result.length - 1; i >= 0; i--) {
      if ((result[i] as Message).role === "tool") {
        recentToolIndices.push(i);
        if (recentToolIndices.length >= 2) {
          break;
        }
      }
    }

    const protectedIndices = new Set([
      ...(systemIdx >= 0 ? [systemIdx] : []),
      ...recentUserIndices,
      ...recentToolIndices,
    ]);

    // Phase 1: Truncate older tool results aggressively
    for (let i = 0; i < result.length; i++) {
      if (this.predictTokenBudget(result) <= maxTokens) {
        break;
      }
      const msg = result[i] as Message;
      if (
        msg.role === "tool" &&
        !protectedIndices.has(i) &&
        msg.content.length > 100
      ) {
        result[i] = {
          ...msg,
          content: `${msg.content.slice(0, 100)}\n... [truncated]`,
        };
      }
    }

    if (this.predictTokenBudget(result) <= maxTokens) {
      return result;
    }

    // Phase 2: Progressively truncate older assistant messages
    for (let i = 0; i < result.length; i++) {
      if (this.predictTokenBudget(result) <= maxTokens) {
        break;
      }
      const msg = result[i] as Message;
      if (
        msg.role === "assistant" &&
        !protectedIndices.has(i) &&
        msg.content.length > 200
      ) {
        result[i] = {
          ...msg,
          content: `${msg.content.slice(0, 150)}\n... [truncated]`,
        };
      }
    }

    if (this.predictTokenBudget(result) <= maxTokens) {
      return result;
    }

    // Phase 3: Remove older non-protected messages entirely
    const toRemove: number[] = [];
    for (let i = 0; i < result.length; i++) {
      if (this.predictTokenBudget(result) <= maxTokens) {
        break;
      }
      if (!protectedIndices.has(i)) {
        toRemove.push(i);
      }
    }

    // Remove from the end to preserve indices
    const filtered = result.filter((_, idx) => !toRemove.includes(idx));

    logger.info(
      {
        originalTokens: currentTokens,
        fittedTokens: this.predictTokenBudget(filtered),
        removedMessages: toRemove.length,
      },
      "Fitted messages to token budget"
    );

    return filtered;
  }

  /**
   * Clear the prompt cache.
   */
  clearCache(): void {
    this.promptCache.clear();
  }
}
