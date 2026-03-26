/**
 * Context Compressor — Progressive summarization at token limits.
 *
 * When the conversation exceeds token budget, older messages are
 * summarized into a compressed form using the background slot,
 * preserving key information while reducing token count.
 */

import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const FILE_CHANGE_PATTERN =
  /(?:file_write|file_edit|created|modified)\s+["']?([^\s"']+)/g;
const FILE_CHANGE_PREFIX_PATTERN =
  /(?:file_write|file_edit|created|modified)\s+["']?/;

const logger = createLogger("orchestrator:context-compressor");

// ---------------------------------------------------------------------------
// Compression Tiers
// ---------------------------------------------------------------------------

export type CompressionTier = "full" | "summary" | "skeleton" | "references";

interface TierDefinition {
  description: string;
  maxRatio: number;
  tier: CompressionTier;
}

const TIER_DEFINITIONS: TierDefinition[] = [
  { tier: "full", description: "Complete file content", maxRatio: 1.0 },
  {
    tier: "summary",
    description: "Function signatures + docstrings + key logic",
    maxRatio: 0.4,
  },
  {
    tier: "skeleton",
    description: "Just signatures and type definitions",
    maxRatio: 0.15,
  },
  {
    tier: "references",
    description: "Just file path + export names",
    maxRatio: 0.05,
  },
];

const FUNCTION_SIG_RE =
  /^[ \t]*(?:export\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\(|(?:\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?{)/gm;
const TYPE_DEF_RE =
  /^[ \t]*(?:export\s+)?(?:interface|type|enum|class)\s+\w+[^{]*/gm;
const EXPORT_NAME_RE =
  /export\s+(?:default\s+)?(?:const|function|class|type|interface|enum)\s+(\w+)/g;
const DOCSTRING_RE = /\/\*\*[\s\S]*?\*\//g;

function extractSignaturesAndTypes(content: string): string[] {
  const parts: string[] = [];
  const signatures = content.match(FUNCTION_SIG_RE) ?? [];
  for (const sig of signatures) {
    parts.push(sig.trim());
  }
  const types = content.match(TYPE_DEF_RE) ?? [];
  for (const t of types) {
    parts.push(t.trim());
  }
  return parts;
}

function compressSummary(content: string): string {
  const parts: string[] = [];
  const docstrings = content.match(DOCSTRING_RE) ?? [];
  for (const doc of docstrings) {
    parts.push(doc);
  }
  parts.push(...extractSignaturesAndTypes(content));
  return parts.length > 0
    ? parts.join("\n\n")
    : content.slice(0, Math.floor(content.length * 0.4));
}

function compressSkeleton(content: string): string {
  const parts = extractSignaturesAndTypes(content);
  return parts.length > 0
    ? parts.join("\n\n")
    : content.slice(0, Math.floor(content.length * 0.15));
}

function compressReferences(content: string): string {
  const exports: string[] = [];
  const regex = new RegExp(EXPORT_NAME_RE.source, "g");
  let match = regex.exec(content);
  while (match !== null) {
    if (match[1]) {
      exports.push(match[1]);
    }
    match = regex.exec(content);
  }
  return exports.length > 0
    ? `Exports: ${exports.join(", ")}`
    : "[no exports detected]";
}

const tierCompressors: Record<CompressionTier, (content: string) => string> = {
  full: (content) => content,
  summary: compressSummary,
  skeleton: compressSkeleton,
  references: compressReferences,
};

/**
 * Compress content to a specified compression tier.
 */
export function compressToTier(content: string, tier: CompressionTier): string {
  const compressor = tierCompressors[tier];
  return compressor ? compressor(content) : content;
}

/**
 * Automatically select the best compression tier based on content size
 * and available token budget.
 */
export function autoSelectTier(
  contentSize: number,
  tokenBudget: number
): CompressionTier {
  const estimatedTokens = Math.ceil(contentSize / 4);

  if (estimatedTokens <= tokenBudget) {
    return "full";
  }

  const ratio = tokenBudget / estimatedTokens;

  for (const def of TIER_DEFINITIONS) {
    if (ratio >= def.maxRatio) {
      return def.tier;
    }
  }

  return "references";
}

export interface Message {
  content: string;
  role: string;
  toolCallId?: string;
  toolCalls?: unknown[];
}

export interface CompressionResult {
  compressedMessages: Message[];
  compressedTokens: number;
  originalTokens: number;
  ratio: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

export class ContextCompressor {
  private readonly maxTokenBudget: number;
  private readonly compressionThreshold: number;
  private readonly summarySlot: string;

  constructor(
    maxTokenBudget = 14_000,
    compressionThreshold = 0.8,
    summarySlot = "background"
  ) {
    this.maxTokenBudget = maxTokenBudget;
    this.compressionThreshold = compressionThreshold;
    this.summarySlot = summarySlot;
  }

  /**
   * Create a ContextCompressor sized for a specific model's context window.
   * Reserves 20% of the context window for output tokens.
   */
  static forModel(modelKey: string): ContextCompressor {
    let contextWindow: number | undefined;
    try {
      // Dynamic import to avoid circular dependency at module level
      const { getModelContextWindow } = require("@prometheus/ai") as {
        getModelContextWindow: (key: string) => number | undefined;
      };
      contextWindow = getModelContextWindow(modelKey);
    } catch {
      // Package not available, use default
    }
    const budget = contextWindow ? Math.floor(contextWindow * 0.8) : 14_000;
    return new ContextCompressor(budget);
  }

  shouldCompress(messages: Message[]): boolean {
    const currentTokens = estimateMessageTokens(messages);
    return currentTokens > this.maxTokenBudget * this.compressionThreshold;
  }

  async compress(messages: Message[]): Promise<CompressionResult> {
    const originalTokens = estimateMessageTokens(messages);

    if (!this.shouldCompress(messages)) {
      return {
        compressedMessages: messages,
        originalTokens,
        compressedTokens: originalTokens,
        ratio: 1.0,
      };
    }

    // Keep system message and last N messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    // Keep the last 6 messages as-is (recent context)
    const keepCount = Math.min(6, nonSystemMessages.length);
    const toSummarize = nonSystemMessages.slice(0, -keepCount);
    const toKeep = nonSystemMessages.slice(-keepCount);

    if (toSummarize.length === 0) {
      return {
        compressedMessages: messages,
        originalTokens,
        compressedTokens: originalTokens,
        ratio: 1.0,
      };
    }

    // Summarize older messages
    const summaryContent = await this.generateSummary(toSummarize);

    const compressedMessages: Message[] = [
      ...systemMessages,
      {
        role: "system",
        content: `[Compressed conversation history]\n${summaryContent}`,
      },
      ...toKeep,
    ];

    const compressedTokens = estimateMessageTokens(compressedMessages);
    const ratio = compressedTokens / originalTokens;

    logger.info(
      {
        originalTokens,
        compressedTokens,
        ratio: ratio.toFixed(2),
        summarizedMessages: toSummarize.length,
        keptMessages: toKeep.length,
      },
      "Context compressed"
    );

    return { compressedMessages, originalTokens, compressedTokens, ratio };
  }

  private async generateSummary(messages: Message[]): Promise<string> {
    const conversationText = messages
      .map((m) => `[${m.role}]: ${m.content.slice(0, 500)}`)
      .join("\n");

    try {
      const response = await fetch(
        `${process.env.MODEL_ROUTER_URL ?? "http://localhost:4004"}/route`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalAuthHeaders(),
          },
          body: JSON.stringify({
            slot: this.summarySlot,
            messages: [
              {
                role: "system",
                content:
                  "You are a conversation summarizer. Condense the conversation into key facts, decisions made, files modified, errors encountered, and current state. Be extremely concise. Use bullet points.",
              },
              {
                role: "user",
                content: `Summarize this conversation:\n\n${conversationText}`,
              },
            ],
            options: { maxTokens: 1000, temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );

      if (!response.ok) {
        throw new Error(`Summary generation failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      return (
        data.choices[0]?.message?.content ?? this.fallbackSummary(messages)
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "LLM summary failed, using fallback");
      return this.fallbackSummary(messages);
    }
  }

  private fallbackSummary(messages: Message[]): string {
    const parts: string[] = [];
    const filesChanged = new Set<string>();
    let lastAssistant = "";

    for (const m of messages) {
      if (m.role === "assistant" && m.content) {
        lastAssistant = m.content.slice(0, 200);
      }

      const fileMatch = m.content.match(FILE_CHANGE_PATTERN);
      if (fileMatch) {
        for (const match of fileMatch) {
          const path = match.replace(FILE_CHANGE_PREFIX_PATTERN, "");
          filesChanged.add(path);
        }
      }
    }

    if (filesChanged.size > 0) {
      parts.push(`Files modified: ${Array.from(filesChanged).join(", ")}`);
    }
    parts.push(`Messages summarized: ${messages.length}`);
    if (lastAssistant) {
      parts.push(`Last assistant context: ${lastAssistant}...`);
    }

    return parts.join("\n");
  }
}
