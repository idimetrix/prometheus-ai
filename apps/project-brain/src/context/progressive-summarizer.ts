/**
 * Phase 7.4: Progressive Summarizer.
 *
 * 4 summary levels: raw -> iteration -> phase -> session.
 * Progressively replaces older context with summaries as the
 * context window fills. Most recent details are preserved;
 * older context is compressed.
 */
import { createLogger } from "@prometheus/logger";
import { estimateTokens } from "./token-counter";

const logger = createLogger("project-brain:progressive-summarizer");

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
const _WORD_SPLIT_RE = /\s+/;

export type SummaryLevel = "raw" | "iteration" | "phase" | "session";

export interface SummarizedContent {
  content: string;
  level: SummaryLevel;
  originalTokens: number;
  summarizedTokens: number;
}

interface Message {
  content: string;
  role: string;
  timestamp?: Date;
}

const LEVEL_ORDER: Record<SummaryLevel, number> = {
  raw: 0,
  iteration: 1,
  phase: 2,
  session: 3,
};

/** Target compression ratios per level */
const COMPRESSION_RATIOS: Record<SummaryLevel, number> = {
  raw: 1.0,
  iteration: 0.4,
  phase: 0.15,
  session: 0.05,
};

/**
 * ProgressiveSummarizer compresses context at increasing levels
 * of abstraction to fit within token budgets while preserving
 * the most important recent information.
 */
export class ProgressiveSummarizer {
  /**
   * Summarize a list of messages at the specified level.
   * Raw returns original content; higher levels progressively compress.
   */
  summarize(messages: Message[], level: SummaryLevel): SummarizedContent {
    const rawContent = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n\n");
    const originalTokens = estimateTokens(rawContent);

    if (level === "raw") {
      return {
        content: rawContent,
        level: "raw",
        originalTokens,
        summarizedTokens: originalTokens,
      };
    }

    const compressed = this.compressToLevel(rawContent, level);
    const summarizedTokens = estimateTokens(compressed);

    logger.debug(
      {
        level,
        originalTokens,
        summarizedTokens,
        ratio: summarizedTokens / originalTokens,
      },
      "Content summarized"
    );

    return {
      content: compressed,
      level,
      originalTokens,
      summarizedTokens,
    };
  }

  /**
   * Compress content to a target summary level.
   * Uses extractive summarization to select key sentences.
   */
  compressToLevel(content: string, targetLevel: SummaryLevel): string {
    const ratio = COMPRESSION_RATIOS[targetLevel];
    const targetLength = Math.floor(content.length * ratio);

    if (targetLevel === "raw" || ratio >= 1.0) {
      return content;
    }

    const sentences = this.splitIntoSentences(content);
    if (sentences.length === 0) {
      return content.slice(0, targetLength);
    }

    // Score sentences by importance
    const scored = sentences.map((sentence, idx) => ({
      sentence,
      score: this.scoreSentence(sentence, idx, sentences.length),
    }));

    // Sort by score descending, take enough to fill target
    scored.sort((a, b) => b.score - a.score);

    const selected: Array<{
      sentence: string;
      score: number;
      originalIdx: number;
    }> = [];
    let currentLength = 0;

    for (const item of scored) {
      if (currentLength + item.sentence.length > targetLength) {
        continue;
      }
      const originalIdx = sentences.indexOf(item.sentence);
      selected.push({ ...item, originalIdx });
      currentLength += item.sentence.length;
    }

    // Restore original order for coherence
    selected.sort((a, b) => a.originalIdx - b.originalIdx);

    const result = selected.map((s) => s.sentence).join(" ");

    if (targetLevel === "session") {
      return `[Session Summary] ${result}`;
    }
    if (targetLevel === "phase") {
      return `[Phase Summary] ${result}`;
    }
    return `[Iteration Summary] ${result}`;
  }

  /**
   * Progressively compress a context window, preserving recent messages
   * at full detail and summarizing older ones.
   */
  compressContextWindow(
    messages: Message[],
    tokenBudget: number
  ): SummarizedContent[] {
    const results: SummarizedContent[] = [];
    const totalMessages = messages.length;

    if (totalMessages === 0) {
      return results;
    }

    // Split into temporal zones:
    // Recent 20% -> raw, 20-50% -> iteration, 50-80% -> phase, 80-100% -> session
    const recentCutoff = Math.floor(totalMessages * 0.8);
    const iterationCutoff = Math.floor(totalMessages * 0.5);
    const phaseCutoff = Math.floor(totalMessages * 0.2);

    const zones: Array<{ messages: Message[]; level: SummaryLevel }> = [
      { messages: messages.slice(0, phaseCutoff), level: "session" },
      {
        messages: messages.slice(phaseCutoff, iterationCutoff),
        level: "phase",
      },
      {
        messages: messages.slice(iterationCutoff, recentCutoff),
        level: "iteration",
      },
      { messages: messages.slice(recentCutoff), level: "raw" },
    ];

    for (const zone of zones) {
      if (zone.messages.length === 0) {
        continue;
      }
      results.push(this.summarize(zone.messages, zone.level));
    }

    // If total still exceeds budget, compress further
    let totalTokens = results.reduce((sum, r) => sum + r.summarizedTokens, 0);
    if (totalTokens > tokenBudget) {
      for (let i = 0; i < results.length - 1; i++) {
        const result = results[i] as SummarizedContent;
        const currentLevel = LEVEL_ORDER[result.level];
        const nextLevel = this.getNextLevel(result.level);
        if (nextLevel && currentLevel < LEVEL_ORDER[nextLevel]) {
          const recompressed = this.compressToLevel(result.content, nextLevel);
          const newTokens = estimateTokens(recompressed);
          totalTokens = totalTokens - result.summarizedTokens + newTokens;
          results[i] = {
            content: recompressed,
            level: nextLevel,
            originalTokens: result.originalTokens,
            summarizedTokens: newTokens,
          };
        }
        if (totalTokens <= tokenBudget) {
          break;
        }
      }
    }

    return results;
  }

  private getNextLevel(level: SummaryLevel): SummaryLevel | null {
    const order: SummaryLevel[] = ["raw", "iteration", "phase", "session"];
    const idx = order.indexOf(level);
    return idx < order.length - 1 ? (order[idx + 1] as SummaryLevel) : null;
  }

  private splitIntoSentences(text: string): string[] {
    return text
      .split(SENTENCE_SPLIT_RE)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
  }

  private scoreSentence(
    sentence: string,
    index: number,
    totalSentences: number
  ): number {
    let score = 0;

    // Recency bias: later sentences score higher
    score += (index / totalSentences) * 0.4;

    // Length bonus: medium sentences are most informative
    const wordCount = sentence.split(_WORD_SPLIT_RE).length;
    if (wordCount >= 5 && wordCount <= 30) {
      score += 0.2;
    }

    // Key signal words
    const keySignals = [
      "decided",
      "chosen",
      "error",
      "fix",
      "implement",
      "create",
      "update",
      "delete",
      "important",
      "must",
      "should",
      "because",
      "therefore",
      "result",
    ];
    const lowerSentence = sentence.toLowerCase();
    for (const signal of keySignals) {
      if (lowerSentence.includes(signal)) {
        score += 0.1;
        break;
      }
    }

    // Code-related content bonus
    if (
      sentence.includes("`") ||
      sentence.includes("()") ||
      sentence.includes("=>")
    ) {
      score += 0.15;
    }

    return Math.min(1, score);
  }
}
