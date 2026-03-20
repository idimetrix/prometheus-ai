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
