/**
 * GAP-093: Meta-Learning Pattern Extraction
 *
 * Analyzes completed sessions for reusable patterns.
 * Extracts common task-to-approach mappings, successful strategies,
 * and failure modes. Stores patterns for future prompt augmentation.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:pattern-extractor");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionOutcome {
  agentRole: string;
  approach: string;
  durationMs: number;
  errorMessages: string[];
  filesModified: string[];
  qualityScore: number;
  sessionId: string;
  success: boolean;
  taskType: string;
  timestamp: number;
  toolsUsed: string[];
}

export interface ExtractedPattern {
  approach: string;
  avgQuality: number;
  confidence: number;
  description: string;
  id: string;
  lastSeen: number;
  occurrences: number;
  taskType: string;
  toolChain: string[];
  type: "task_approach" | "success_strategy" | "failure_mode" | "tool_chain";
}

export interface PatternAugmentation {
  patterns: ExtractedPattern[];
  promptSection: string;
}

// ─── Pattern Extractor ───────────────────────────────────────────────────────

export class PatternExtractor {
  private readonly outcomes: SessionOutcome[] = [];
  private readonly patterns = new Map<string, ExtractedPattern>();
  private readonly maxOutcomes: number;

  constructor(maxOutcomes = 5000) {
    this.maxOutcomes = maxOutcomes;
  }

  /**
   * Record a session outcome for pattern analysis.
   */
  recordOutcome(outcome: SessionOutcome): void {
    this.outcomes.push(outcome);

    // Evict old outcomes
    if (this.outcomes.length > this.maxOutcomes) {
      this.outcomes.shift();
    }

    // Extract patterns from this outcome
    this.extractFromOutcome(outcome);

    logger.debug(
      {
        sessionId: outcome.sessionId,
        taskType: outcome.taskType,
        success: outcome.success,
      },
      "Session outcome recorded for pattern extraction"
    );
  }

  /**
   * Get patterns relevant to a specific task type for prompt augmentation.
   */
  getPatternsForTask(taskType: string): PatternAugmentation {
    const relevant: ExtractedPattern[] = [];

    for (const pattern of this.patterns.values()) {
      if (pattern.taskType === taskType || pattern.taskType === "*") {
        relevant.push(pattern);
      }
    }

    // Sort by confidence and occurrences
    relevant.sort(
      (a, b) => b.confidence * b.occurrences - a.confidence * a.occurrences
    );

    const top = relevant.slice(0, 5);
    const promptSection = this.buildPromptSection(top);

    return { patterns: top, promptSection };
  }

  /**
   * Get all extracted patterns.
   */
  getAllPatterns(): ExtractedPattern[] {
    return [...this.patterns.values()].sort(
      (a, b) => b.confidence - a.confidence
    );
  }

  /**
   * Get failure modes for a task type.
   */
  getFailureModes(taskType: string): ExtractedPattern[] {
    return [...this.patterns.values()]
      .filter((p) => p.type === "failure_mode" && p.taskType === taskType)
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Get stats about pattern extraction.
   */
  getStats(): {
    totalOutcomes: number;
    totalPatterns: number;
    byType: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    for (const p of this.patterns.values()) {
      byType[p.type] = (byType[p.type] ?? 0) + 1;
    }

    return {
      totalOutcomes: this.outcomes.length,
      totalPatterns: this.patterns.size,
      byType,
    };
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private extractFromOutcome(outcome: SessionOutcome): void {
    const key = `${outcome.taskType}:${outcome.approach}`;

    if (outcome.success) {
      this.upsertPattern(key, {
        type: "task_approach",
        taskType: outcome.taskType,
        approach: outcome.approach,
        toolChain: outcome.toolsUsed,
        quality: outcome.qualityScore,
      });

      // Extract tool chain pattern
      if (outcome.toolsUsed.length >= 2) {
        const toolKey = `toolchain:${outcome.toolsUsed.join("->")}`;
        this.upsertPattern(toolKey, {
          type: "tool_chain",
          taskType: outcome.taskType,
          approach: `Tool chain: ${outcome.toolsUsed.join(" -> ")}`,
          toolChain: outcome.toolsUsed,
          quality: outcome.qualityScore,
        });
      }

      if (outcome.qualityScore >= 0.9) {
        const stratKey = `strategy:${outcome.taskType}:${outcome.agentRole}`;
        this.upsertPattern(stratKey, {
          type: "success_strategy",
          taskType: outcome.taskType,
          approach: `${outcome.agentRole} using ${outcome.approach}`,
          toolChain: outcome.toolsUsed,
          quality: outcome.qualityScore,
        });
      }
    } else {
      // Extract failure mode
      const failKey = `fail:${outcome.taskType}:${outcome.approach}`;
      this.upsertPattern(failKey, {
        type: "failure_mode",
        taskType: outcome.taskType,
        approach: outcome.approach,
        toolChain: outcome.toolsUsed,
        quality: 0,
      });
    }
  }

  private upsertPattern(
    key: string,
    data: {
      type: ExtractedPattern["type"];
      taskType: string;
      approach: string;
      toolChain: string[];
      quality: number;
    }
  ): void {
    const existing = this.patterns.get(key);

    if (existing) {
      existing.occurrences++;
      existing.avgQuality =
        (existing.avgQuality * (existing.occurrences - 1) + data.quality) /
        existing.occurrences;
      existing.confidence = Math.min(0.99, 0.5 + existing.occurrences * 0.05);
      existing.lastSeen = Date.now();
    } else {
      this.patterns.set(key, {
        id: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: data.type,
        taskType: data.taskType,
        description: `${data.type}: ${data.approach}`,
        confidence: 0.5,
        occurrences: 1,
        avgQuality: data.quality,
        approach: data.approach,
        toolChain: data.toolChain,
        lastSeen: Date.now(),
      });
    }
  }

  private buildPromptSection(patterns: ExtractedPattern[]): string {
    if (patterns.length === 0) {
      return "";
    }

    const lines = ["## Learned Patterns from Previous Sessions", ""];

    for (const p of patterns) {
      if (p.type === "failure_mode") {
        lines.push(`- AVOID: "${p.approach}" (failed ${p.occurrences} times)`);
      } else if (p.type === "success_strategy") {
        lines.push(
          `- RECOMMENDED: "${p.approach}" (quality: ${p.avgQuality.toFixed(2)}, used ${p.occurrences} times)`
        );
      } else if (p.type === "tool_chain") {
        lines.push(
          `- TOOL ORDER: ${p.toolChain.join(" -> ")} (confidence: ${p.confidence.toFixed(2)})`
        );
      } else {
        lines.push(
          `- APPROACH: "${p.approach}" (confidence: ${p.confidence.toFixed(2)})`
        );
      }
    }

    return lines.join("\n");
  }
}
