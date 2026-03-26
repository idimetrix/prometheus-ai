/**
 * Context Compressor.
 *
 * Compresses agent context when it approaches the model's token limit.
 * Applies multiple strategies to reduce context size while preserving
 * the most relevant information for the current task.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:context-compressor");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextMessage {
  /** The message content */
  content: string;
  /** Unique identifier for the message */
  id: string;
  /** Whether this message is a tool result */
  isToolResult?: boolean;
  /** Role: system, user, assistant, tool */
  role: "system" | "user" | "assistant" | "tool";
  /** Timestamp of the message */
  timestamp?: number;
  /** Approximate token count */
  tokenCount?: number;
  /** Tool call name (if role is "tool") */
  toolName?: string;
}

export interface CompressionResult {
  /** Compressed token count */
  compressedTokens: number;
  /** The compressed messages */
  messages: ContextMessage[];
  /** Number of messages removed */
  messagesRemoved: number;
  /** Original token count */
  originalTokens: number;
  /** Strategies applied */
  strategiesApplied: string[];
}

export interface CompressionOptions {
  /** Maximum token count for the model */
  modelLimit: number;
  /** Number of recent messages to always preserve */
  preserveRecentCount?: number;
  /** Whether to preserve system messages */
  preserveSystemMessages?: boolean;
  /** Target token count (compress until below this) */
  targetTokens: number;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 characters per token */
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function getMessageTokens(msg: ContextMessage): number {
  return msg.tokenCount ?? estimateTokens(msg.content);
}

// ---------------------------------------------------------------------------
// Context Compressor
// ---------------------------------------------------------------------------

export class ContextCompressor {
  /**
   * Compress the context to fit within the target token limit.
   * Applies strategies in order of least to most aggressive.
   */
  compress(
    messages: ContextMessage[],
    options: CompressionOptions
  ): CompressionResult {
    const originalTokens = this.countTokens(messages);
    const strategiesApplied: string[] = [];

    if (originalTokens <= options.targetTokens) {
      return {
        messages,
        originalTokens,
        compressedTokens: originalTokens,
        messagesRemoved: 0,
        strategiesApplied: [],
      };
    }

    logger.info(
      {
        originalTokens,
        targetTokens: options.targetTokens,
        messageCount: messages.length,
      },
      "Starting context compression"
    );

    let compressed = [...messages];
    const preserveRecentCount = options.preserveRecentCount ?? 10;
    const preserveSystem = options.preserveSystemMessages ?? true;

    // Strategy 1: Remove duplicate context
    compressed = this.removeDuplicates(compressed);
    if (this.countTokens(compressed) <= options.targetTokens) {
      strategiesApplied.push("remove_duplicates");
      return this.buildResult(
        messages,
        compressed,
        originalTokens,
        strategiesApplied
      );
    }
    strategiesApplied.push("remove_duplicates");

    // Strategy 2: Summarize old tool call results (keep summaries)
    compressed = this.summarizeOldToolResults(
      compressed,
      preserveRecentCount,
      preserveSystem
    );
    if (this.countTokens(compressed) <= options.targetTokens) {
      strategiesApplied.push("summarize_tool_results");
      return this.buildResult(
        messages,
        compressed,
        originalTokens,
        strategiesApplied
      );
    }
    strategiesApplied.push("summarize_tool_results");

    // Strategy 3: Truncate long file contents in tool results
    compressed = this.truncateLongContent(compressed, preserveRecentCount);
    if (this.countTokens(compressed) <= options.targetTokens) {
      strategiesApplied.push("truncate_long_content");
      return this.buildResult(
        messages,
        compressed,
        originalTokens,
        strategiesApplied
      );
    }
    strategiesApplied.push("truncate_long_content");

    // Strategy 4: Remove old tool results entirely (keep calls for context)
    compressed = this.removeOldToolResults(
      compressed,
      preserveRecentCount,
      preserveSystem
    );
    if (this.countTokens(compressed) <= options.targetTokens) {
      strategiesApplied.push("remove_old_tool_results");
      return this.buildResult(
        messages,
        compressed,
        originalTokens,
        strategiesApplied
      );
    }
    strategiesApplied.push("remove_old_tool_results");

    // Strategy 5: Drop oldest non-system, non-recent messages
    compressed = this.dropOldestMessages(
      compressed,
      options.targetTokens,
      preserveRecentCount,
      preserveSystem
    );
    strategiesApplied.push("drop_oldest_messages");

    return this.buildResult(
      messages,
      compressed,
      originalTokens,
      strategiesApplied
    );
  }

  /**
   * Remove duplicate messages (same content appearing multiple times).
   */
  private removeDuplicates(messages: ContextMessage[]): ContextMessage[] {
    const seen = new Set<string>();
    const result: ContextMessage[] = [];

    for (const msg of messages) {
      // Always keep system messages and recent messages
      if (msg.role === "system") {
        result.push(msg);
        continue;
      }

      const key = `${msg.role}:${msg.content.slice(0, 200)}`;
      if (seen.has(key)) {
        logger.debug(
          { role: msg.role, contentPreview: msg.content.slice(0, 50) },
          "Removing duplicate message"
        );
        continue;
      }
      seen.add(key);
      result.push(msg);
    }

    return result;
  }

  /**
   * Replace old tool results with brief summaries.
   */
  private summarizeOldToolResults(
    messages: ContextMessage[],
    preserveRecentCount: number,
    preserveSystem: boolean
  ): ContextMessage[] {
    const recentStart = Math.max(0, messages.length - preserveRecentCount);

    return messages.map((msg, idx) => {
      // Preserve system messages and recent messages
      if (preserveSystem && msg.role === "system") {
        return msg;
      }
      if (idx >= recentStart) {
        return msg;
      }

      // Summarize old tool results
      if (msg.isToolResult || msg.role === "tool") {
        const toolName = msg.toolName ?? "unknown_tool";
        const contentLength = msg.content.length;
        const preview = msg.content.slice(0, 100).replace(/\n/g, " ");
        const summary = `[Tool result from ${toolName}: ${preview}... (${contentLength} chars truncated)]`;

        return {
          ...msg,
          content: summary,
          tokenCount: estimateTokens(summary),
        };
      }

      return msg;
    });
  }

  /**
   * Truncate very long content in messages (e.g., file contents).
   */
  private truncateLongContent(
    messages: ContextMessage[],
    preserveRecentCount: number
  ): ContextMessage[] {
    const maxContentLength = 2000;
    const recentStart = Math.max(0, messages.length - preserveRecentCount);

    return messages.map((msg, idx) => {
      if (idx >= recentStart) {
        return msg;
      }

      if (msg.content.length > maxContentLength) {
        const truncated = `${msg.content.slice(0, maxContentLength)}\n\n[... content truncated, ${msg.content.length - maxContentLength} chars removed ...]`;
        return {
          ...msg,
          content: truncated,
          tokenCount: estimateTokens(truncated),
        };
      }

      return msg;
    });
  }

  /**
   * Remove old tool results entirely, keeping only tool call messages.
   */
  private removeOldToolResults(
    messages: ContextMessage[],
    preserveRecentCount: number,
    preserveSystem: boolean
  ): ContextMessage[] {
    const recentStart = Math.max(0, messages.length - preserveRecentCount);

    return messages.filter((msg, idx) => {
      if (preserveSystem && msg.role === "system") {
        return true;
      }
      if (idx >= recentStart) {
        return true;
      }

      // Remove old tool results
      if (msg.isToolResult || msg.role === "tool") {
        return false;
      }

      return true;
    });
  }

  /**
   * Drop the oldest non-system, non-recent messages until under the target.
   */
  private dropOldestMessages(
    messages: ContextMessage[],
    targetTokens: number,
    preserveRecentCount: number,
    preserveSystem: boolean
  ): ContextMessage[] {
    const recentStart = Math.max(0, messages.length - preserveRecentCount);

    // Separate messages into protected and droppable
    const protectedMessages: Array<{ msg: ContextMessage; idx: number }> = [];
    const droppableMessages: Array<{ msg: ContextMessage; idx: number }> = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as ContextMessage;
      if ((preserveSystem && msg.role === "system") || i >= recentStart) {
        protectedMessages.push({ msg, idx: i });
      } else {
        droppableMessages.push({ msg, idx: i });
      }
    }

    // Drop oldest droppable messages until under target
    let currentTokens = this.countTokens(messages);
    const droppedIndices = new Set<number>();

    for (const item of droppableMessages) {
      if (currentTokens <= targetTokens) {
        break;
      }
      currentTokens -= getMessageTokens(item.msg);
      droppedIndices.add(item.idx);
    }

    return messages.filter((_, idx) => !droppedIndices.has(idx));
  }

  /**
   * Count total tokens across all messages.
   */
  private countTokens(messages: ContextMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += getMessageTokens(msg);
    }
    return total;
  }

  /**
   * Build the compression result.
   */
  private buildResult(
    original: ContextMessage[],
    compressed: ContextMessage[],
    originalTokens: number,
    strategiesApplied: string[]
  ): CompressionResult {
    const compressedTokens = this.countTokens(compressed);
    const messagesRemoved = original.length - compressed.length;

    logger.info(
      {
        originalTokens,
        compressedTokens,
        messagesRemoved,
        strategiesApplied,
        compressionRatio: (
          ((originalTokens - compressedTokens) / originalTokens) *
          100
        ).toFixed(1),
      },
      "Context compression complete"
    );

    return {
      messages: compressed,
      originalTokens,
      compressedTokens,
      messagesRemoved,
      strategiesApplied,
    };
  }
}
