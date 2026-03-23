/**
 * Phase 7.4: Progressive Summarizer.
 *
 * 4 summary levels: raw -> iteration -> phase -> session.
 * Enhanced with three distinct summarization strategies:
 * - Iteration: key findings as bullet points
 * - Phase: structured bullet points by category (target: 20% compression)
 * - Session: cohesive paragraph summary
 * Preserves file paths and error messages at all levels.
 */
import { createLogger } from "@prometheus/logger";
import { estimateTokens } from "./token-counter";

const logger = createLogger("project-brain:progressive-summarizer");

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
const WORD_SPLIT_RE = /\s+/;
const FILE_PATH_RE =
  /(?:^|[\s"'`(])([./]?(?:[\w@-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|json|yaml|yml|md|sql|css|html))\b/g;
const ERROR_MSG_RE =
  /(?:Error|TypeError|ReferenceError|SyntaxError|RangeError):\s*[^\n]+/g;
const STACK_TRACE_RE = /\s+at\s+[\w.<>]+\s*\([^)]+\)/g;
const QUESTION_SPLIT_RE = /[.!]\s+/;

export type SummaryLevel = "raw" | "iteration" | "phase" | "session";

export interface SummarizedContent {
  content: string;
  level: SummaryLevel;
  originalTokens: number;
  preservedErrors?: string[];
  preservedFilePaths?: string[];
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
const COMPRESSION_RATIOS: Record<SummaryLevel, number> = {
  raw: 1.0,
  iteration: 0.4,
  phase: 0.2,
  session: 0.05,
};

export class ProgressiveSummarizer {
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

    const preservedFilePaths = this.extractFilePaths(rawContent);
    const preservedErrors = this.extractErrorMessages(rawContent);

    let compressed: string;
    if (level === "iteration") {
      compressed = this.compressIteration(rawContent, messages);
    } else if (level === "phase") {
      compressed = this.compressPhase(messages);
    } else if (level === "session") {
      compressed = this.compressSession(rawContent, messages);
    } else {
      compressed = this.compressToLevel(rawContent, level);
    }

    const summarizedTokens = estimateTokens(compressed);
    logger.debug(
      {
        level,
        originalTokens,
        summarizedTokens,
        ratio:
          originalTokens > 0
            ? Math.round((summarizedTokens / originalTokens) * 100) / 100
            : 0,
        preservedPaths: preservedFilePaths.length,
      },
      "Content summarized"
    );

    return {
      content: compressed,
      level,
      originalTokens,
      summarizedTokens,
      preservedFilePaths,
      preservedErrors,
    };
  }

  private compressIteration(rawContent: string, messages: Message[]): string {
    const ratio = COMPRESSION_RATIOS.iteration;
    const targetLength = Math.floor(rawContent.length * ratio);
    const findings: string[] = [];
    for (const msg of messages) {
      for (const finding of this.extractKeyFindings(msg.content, msg.role)) {
        findings.push(finding);
      }
    }

    const unique = [...new Set(findings)];
    const parts: string[] = ["[Iteration Summary]"];
    if (unique.length > 0) {
      parts.push("Key findings:");
      for (const finding of unique) {
        parts.push(`- ${finding}`);
        if (parts.join("\n").length >= targetLength) {
          break;
        }
      }
    }

    const filePaths = this.extractFilePaths(rawContent);
    if (filePaths.length > 0) {
      parts.push(`Files referenced: ${filePaths.slice(0, 10).join(", ")}`);
    }

    const errors = this.extractErrorMessages(rawContent);
    if (errors.length > 0) {
      parts.push("Errors encountered:");
      for (const error of errors.slice(0, 5)) {
        parts.push(`- ${error}`);
      }
    }
    return parts.join("\n");
  }

  private compressPhase(messages: Message[]): string {
    const parts: string[] = ["[Phase Summary]"];
    const filesChanged = new Set<string>();
    const decisions: string[] = [];
    const errorsFound: string[] = [];
    const actionsCompleted: string[] = [];
    const openQuestions: string[] = [];

    for (const msg of messages) {
      this.collectPhaseData(
        msg,
        filesChanged,
        errorsFound,
        decisions,
        actionsCompleted,
        openQuestions
      );
    }

    this.appendSection(parts, "\nActions completed:", actionsCompleted, 8);
    this.appendSection(parts, "\nDecisions made:", decisions, 5);
    if (filesChanged.size > 0) {
      parts.push(
        `\nFiles involved (${filesChanged.size}): ${Array.from(filesChanged).slice(0, 15).join(", ")}`
      );
    }
    this.appendSection(parts, "\nErrors encountered:", errorsFound, 3);
    this.appendSection(parts, "\nOpen questions:", openQuestions, 3);
    return parts.join("\n");
  }

  private collectPhaseData(
    msg: Message,
    filesChanged: Set<string>,
    errorsFound: string[],
    decisions: string[],
    actionsCompleted: string[],
    openQuestions: string[]
  ): void {
    const content = msg.content;
    for (const fp of this.extractFilePaths(content)) {
      filesChanged.add(fp);
    }
    for (const err of this.extractErrorMessages(content)) {
      if (!errorsFound.includes(err)) {
        errorsFound.push(err);
      }
    }

    const lowerContent = content.toLowerCase();
    this.collectMatchingSentences(
      content,
      lowerContent,
      [
        "decided",
        "chose",
        "will use",
        "going with",
        "selected",
        "approach:",
        "solution:",
      ],
      decisions
    );
    this.collectMatchingSentences(
      content,
      lowerContent,
      [
        "created",
        "updated",
        "fixed",
        "implemented",
        "added",
        "removed",
        "refactored",
        "configured",
      ],
      actionsCompleted
    );

    if (
      content.includes("?") &&
      (msg.role === "user" || msg.role === "human")
    ) {
      for (const q of content
        .split(QUESTION_SPLIT_RE)
        .filter((s) => s.includes("?"))
        .map((s) => s.trim())) {
        if (q.length > 10 && !openQuestions.includes(q)) {
          openQuestions.push(q);
        }
      }
    }
  }

  private collectMatchingSentences(
    content: string,
    lowerContent: string,
    patterns: string[],
    target: string[]
  ): void {
    for (const pattern of patterns) {
      if (!lowerContent.includes(pattern)) {
        continue;
      }
      const sentence = this.extractSentenceContaining(content, pattern);
      if (sentence && !target.includes(sentence)) {
        target.push(sentence);
      }
    }
  }

  private appendSection(
    parts: string[],
    heading: string,
    items: string[],
    limit: number
  ): void {
    if (items.length === 0) {
      return;
    }
    parts.push(heading);
    for (const item of items.slice(0, limit)) {
      parts.push(`- ${item}`);
    }
  }

  private compressSession(rawContent: string, messages: Message[]): string {
    const filePaths = this.extractFilePaths(rawContent);
    const errors = this.extractErrorMessages(rawContent);
    const allFindings: string[] = [];
    for (const msg of messages) {
      for (const f of this.extractKeyFindings(msg.content, msg.role)) {
        allFindings.push(f);
      }
    }

    const uniqueFindings = [...new Set(allFindings)].slice(0, 6);
    const parts: string[] = [
      `[Session Summary] This session involved ${messages.length} messages. `,
    ];
    if (uniqueFindings.length > 0) {
      parts.push(`Key activities: ${uniqueFindings.join(". ")}. `);
    }
    if (filePaths.length > 0) {
      parts.push(`Files referenced: ${filePaths.slice(0, 8).join(", ")}. `);
    }
    if (errors.length > 0) {
      parts.push(`Errors encountered: ${errors.slice(0, 3).join("; ")}. `);
    }
    return parts.join("");
  }

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

    const scored = sentences.map((sentence, idx) => ({
      sentence,
      score: this.scoreSentence(sentence, idx, sentences.length),
    }));
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
      selected.push({ ...item, originalIdx: sentences.indexOf(item.sentence) });
      currentLength += item.sentence.length;
    }
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

  compressContextWindow(
    messages: Message[],
    tokenBudget: number
  ): SummarizedContent[] {
    const results: SummarizedContent[] = [];
    if (messages.length === 0) {
      return results;
    }

    const total = messages.length;
    const recentCutoff = Math.floor(total * 0.8);
    const iterationCutoff = Math.floor(total * 0.5);
    const phaseCutoff = Math.floor(total * 0.2);

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
      if (zone.messages.length > 0) {
        results.push(this.summarize(zone.messages, zone.level));
      }
    }

    let totalTokens = results.reduce((sum, r) => sum + r.summarizedTokens, 0);
    if (totalTokens > tokenBudget) {
      for (let i = 0; i < results.length - 1; i++) {
        const result = results[i] as SummarizedContent;
        const nextLevel = this.getNextLevel(result.level);
        if (nextLevel && LEVEL_ORDER[result.level] < LEVEL_ORDER[nextLevel]) {
          const recompressed = this.compressToLevel(result.content, nextLevel);
          const newTokens = estimateTokens(recompressed);
          totalTokens = totalTokens - result.summarizedTokens + newTokens;
          results[i] = {
            content: recompressed,
            level: nextLevel,
            originalTokens: result.originalTokens,
            summarizedTokens: newTokens,
            preservedFilePaths: result.preservedFilePaths,
            preservedErrors: result.preservedErrors,
          };
        }
        if (totalTokens <= tokenBudget) {
          break;
        }
      }
    }
    return results;
  }

  private extractFilePaths(content: string): string[] {
    const paths = new Set<string>();
    FILE_PATH_RE.lastIndex = 0;
    for (const match of content.matchAll(FILE_PATH_RE)) {
      if (match[1]) {
        paths.add(match[1]);
      }
    }
    return Array.from(paths);
  }

  private extractErrorMessages(content: string): string[] {
    const errors: string[] = [];
    const seen = new Set<string>();
    ERROR_MSG_RE.lastIndex = 0;
    for (const match of content.matchAll(ERROR_MSG_RE)) {
      const error = match[0].trim();
      if (!seen.has(error)) {
        seen.add(error);
        errors.push(error);
      }
    }
    return errors;
  }

  private extractKeyFindings(content: string, role: string): string[] {
    const findings: string[] = [];
    for (const sentence of this.splitIntoSentences(content)) {
      const lower = sentence.toLowerCase();
      const isHighSignal =
        lower.includes("found") ||
        lower.includes("fixed") ||
        lower.includes("implemented") ||
        lower.includes("created") ||
        lower.includes("updated") ||
        lower.includes("error") ||
        lower.includes("decided") ||
        lower.includes("changed") ||
        lower.includes("added") ||
        lower.includes("removed");
      if (isHighSignal && sentence.length > 15 && sentence.length < 200) {
        findings.push(
          `${role === "assistant" ? "AI" : "User"}: ${sentence.trim()}`
        );
      }
    }
    return findings.slice(0, 5);
  }

  private extractSentenceContaining(
    content: string,
    pattern: string
  ): string | null {
    for (const sentence of this.splitIntoSentences(content)) {
      if (
        sentence.toLowerCase().includes(pattern) &&
        sentence.trim().length > 10 &&
        sentence.trim().length < 200
      ) {
        return sentence.trim();
      }
    }
    return null;
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
    let score = (index / totalSentences) * 0.4;
    const wordCount = sentence.split(WORD_SPLIT_RE).length;
    if (wordCount >= 5 && wordCount <= 30) {
      score += 0.2;
    }
    const lowerSentence = sentence.toLowerCase();
    for (const signal of [
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
    ]) {
      if (lowerSentence.includes(signal)) {
        score += 0.1;
        break;
      }
    }
    if (
      sentence.includes("`") ||
      sentence.includes("()") ||
      sentence.includes("=>")
    ) {
      score += 0.15;
    }
    FILE_PATH_RE.lastIndex = 0;
    if (FILE_PATH_RE.test(sentence)) {
      score += 0.2;
    }
    ERROR_MSG_RE.lastIndex = 0;
    if (ERROR_MSG_RE.test(sentence)) {
      score += 0.25;
    }
    STACK_TRACE_RE.lastIndex = 0;
    if (STACK_TRACE_RE.test(sentence)) {
      score += 0.15;
    }
    return Math.min(1, score);
  }
}
