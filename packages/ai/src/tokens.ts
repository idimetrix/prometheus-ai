// =============================================================================
// @prometheus/ai — Token Counting Utilities
// =============================================================================
// Lightweight token estimation without requiring tiktoken or other heavy deps.
// Uses heuristics tuned for common LLM tokenizers (BPE-based).
// =============================================================================

import { MODEL_REGISTRY } from "./models";

/**
 * Approximate token count for a string.
 *
 * Uses the widely-accepted heuristic of ~4 characters per token for English text
 * and ~3.5 characters per token for code. This is accurate to within ~10% for
 * most LLM tokenizers (GPT, Claude, Llama, Qwen, etc.).
 *
 * For production billing accuracy, use the provider's actual token count from
 * the API response.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  // Count code-like content (lower chars-per-token ratio)
  const codeIndicators = /[{}();=<>[\]|&!@#$%^*+\-/\\~`]/g;
  const codeMatches = text.match(codeIndicators);
  const codeRatio = codeMatches ? codeMatches.length / text.length : 0;

  // Blend between English (~4 chars/token) and code (~3.2 chars/token)
  const charsPerToken = 4 - codeRatio * 0.8;

  return Math.ceil(text.length / charsPerToken);
}

/**
 * Estimate token count for a list of chat messages.
 * Accounts for message framing overhead (~4 tokens per message for role/delimiters).
 */
export function estimateMessageTokens(
  messages: Array<{ role: string; content: string }>
): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 tokens for message framing (role, delimiters)
    total += 4;
    total += estimateTokens(msg.content);
  }
  // Add ~3 tokens for the reply priming
  total += 3;
  return total;
}

/**
 * Check if messages fit within a model's context window.
 * Returns the remaining tokens available for output.
 */
export function remainingContextTokens(
  messages: Array<{ role: string; content: string }>,
  contextWindow: number,
  reserveForOutput = 0
): number {
  const usedTokens = estimateMessageTokens(messages);
  return Math.max(0, contextWindow - usedTokens - reserveForOutput);
}

/**
 * Truncate text to fit within a target token count.
 * Truncates from the end and adds "... [truncated]" marker.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) {
    return text;
  }

  const ratio = maxTokens / currentTokens;
  const targetLength = Math.floor(text.length * ratio) - 20; // Leave room for marker
  if (targetLength <= 0) {
    return "";
  }

  return `${text.slice(0, targetLength)}\n... [truncated]`;
}

/**
 * Get the context window size (in tokens) for a model from the registry.
 * Returns undefined if the model key is not found.
 */
export function getModelContextWindow(modelKey: string): number | undefined {
  const config = MODEL_REGISTRY[modelKey];
  return config?.contextWindow;
}

/**
 * Estimate the cost in USD for a given text input + expected output.
 */
export function estimateTextCost(
  inputText: string,
  expectedOutputTokens: number,
  costPerInputToken: number,
  costPerOutputToken: number
): number {
  const inputTokens = estimateTokens(inputText);
  return (
    inputTokens * costPerInputToken + expectedOutputTokens * costPerOutputToken
  );
}

// ---------------------------------------------------------------------------
// Context Window Optimization (Phase 26.4)
// ---------------------------------------------------------------------------

/**
 * Optimize a conversation's message array to fit within maxTokens.
 *
 * Strategy:
 * 1. Always preserve system prompt and the most recent messages.
 * 2. When over budget, summarize older messages rather than dropping them.
 * 3. Remove least relevant messages (by recency heuristic) when summaries
 *    are still too large.
 */
export function optimizeContextWindow(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number
): Array<{ role: string; content: string }> {
  const currentTokens = estimateMessageTokens(messages);
  if (currentTokens <= maxTokens) {
    return messages;
  }

  const result = [...messages];

  // Identify system messages and recent messages to protect
  const systemIndices: number[] = [];
  for (let i = 0; i < result.length; i++) {
    if (result[i]?.role === "system") {
      systemIndices.push(i);
    }
  }

  // Protect the last 4 messages (recent context)
  const recentStart = Math.max(0, result.length - 4);
  const protectedIndices = new Set([
    ...systemIndices,
    ...Array.from(
      { length: result.length - recentStart },
      (_, i) => recentStart + i
    ),
  ]);

  // Phase 1: Summarize older non-protected messages
  for (let i = 0; i < result.length; i++) {
    if (protectedIndices.has(i)) {
      continue;
    }
    const msg = result[i];
    if (!msg || msg.content.length <= 200) {
      continue;
    }

    const estimated = estimateMessageTokens(result);
    if (estimated <= maxTokens) {
      break;
    }

    result[i] = {
      role: msg.role,
      content: `[Summarized ${msg.role} message]: ${msg.content.slice(0, 150)}...`,
    };
  }

  // Phase 2: Drop non-protected messages if still over budget
  const estimated = estimateMessageTokens(result);
  if (estimated > maxTokens) {
    const kept = result.filter((_, idx) => protectedIndices.has(idx));
    // Add a summary of dropped messages
    const droppedCount = result.length - kept.length;
    if (droppedCount > 0) {
      const summaryMsg = {
        role: "system",
        content: `[${droppedCount} earlier messages were removed to fit context window]`,
      };
      // Insert after system messages
      const insertIdx =
        systemIndices.length > 0 ? (systemIndices.at(-1) ?? 0) + 1 : 0;
      kept.splice(Math.min(insertIdx, kept.length), 0, summaryMsg);
    }
    return kept;
  }

  return result;
}

/**
 * Get the current context window utilization as a percentage.
 */
export function getContextWindowUtilization(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number
): number {
  if (maxTokens <= 0) {
    return 0;
  }
  const used = estimateMessageTokens(messages);
  return Math.min(1, used / maxTokens);
}

// ---------------------------------------------------------------------------
// Cost Efficiency Analysis (Phase 28.4)
// ---------------------------------------------------------------------------

export interface CostOptimization {
  recommendations: string[];
  savings: number;
}

interface SessionCostData {
  messages: Array<{ role: string; content: string }>;
  modelKey: string;
  toolCalls?: Array<{ name: string; args: string }>;
  totalCostUsd: number;
}

/**
 * Analyze a set of sessions for cost efficiency and return
 * actionable recommendations.
 */
export function analyzeCostEfficiency(
  sessions: SessionCostData[]
): CostOptimization {
  const recommendations: string[] = [];
  let estimatedSavings = 0;

  for (const session of sessions) {
    const totalTokens = estimateMessageTokens(session.messages);

    // Check for overly verbose system prompts
    const systemMessages = session.messages.filter((m) => m.role === "system");
    const systemTokens = systemMessages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0
    );
    if (totalTokens > 0 && systemTokens / totalTokens > 0.8) {
      recommendations.push(
        `Session with model "${session.modelKey}" uses >80% of context for system prompt. Consider compressing system instructions.`
      );
      estimatedSavings += session.totalCostUsd * 0.3;
    }

    // Check for duplicate tool calls
    if (session.toolCalls && session.toolCalls.length > 1) {
      const callSignatures = new Map<string, number>();
      for (const call of session.toolCalls) {
        const sig = `${call.name}:${call.args}`;
        callSignatures.set(sig, (callSignatures.get(sig) ?? 0) + 1);
      }
      for (const [sig, count] of callSignatures) {
        if (count > 1) {
          const toolName = sig.split(":")[0];
          recommendations.push(
            `Tool "${toolName}" called ${count} times with identical arguments. Consider caching results.`
          );
          estimatedSavings += session.totalCostUsd * 0.1 * (count - 1);
        }
      }
    }

    // Check for premium model overuse on simple tasks
    const isSimpleTask = totalTokens < 2000;
    const isPremiumModel =
      session.modelKey.includes("opus") ||
      session.modelKey.includes("gpt-4") ||
      session.modelKey.includes("gemini-ultra");
    if (isSimpleTask && isPremiumModel) {
      recommendations.push(
        `Premium model "${session.modelKey}" used for a simple task (<2000 tokens). Consider using a smaller model.`
      );
      estimatedSavings += session.totalCostUsd * 0.7;
    }
  }

  return {
    savings: Math.round(estimatedSavings * 100) / 100,
    recommendations: [...new Set(recommendations)],
  };
}
