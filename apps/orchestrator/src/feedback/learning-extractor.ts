/**
 * Post-session analysis module that extracts learning patterns from
 * execution history and persists them as procedural memories via
 * Project Brain. These learnings are later injected into agent system
 * prompts so each role progressively improves at its task types.
 */
import { createLogger } from "@prometheus/logger";
import { generateId, projectBrainClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:learning-extractor");

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface LearningPattern {
  agentRole: string;
  confidence: number;
  lastSeen: string;
  occurrences: number;
  pattern: string;
  taskType: string;
  type:
    | "tool_pattern"
    | "error_resolution"
    | "quality_correlation"
    | "iteration_insight";
}

export interface SessionAnalysis {
  agentRole: string;
  errorMessages: string[];
  filesChanged: string[];
  projectId: string;
  qualityScore?: number;
  sessionId: string;
  success: boolean;
  taskType: string;
  toolCalls: Array<{ name: string; success: boolean; duration?: number }>;
  totalDuration: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Internal history used for cross-session pattern accumulation
// ---------------------------------------------------------------------------

interface ToolHistoryEntry {
  failCount: number;
  name: string;
  successCount: number;
  totalDuration: number;
}

interface ErrorHistoryEntry {
  message: string;
  occurrences: number;
  resolvedAfter: string[];
}

interface QualitySnapshot {
  duration: number;
  filesChanged: number;
  qualityScore: number;
  tokens: number;
  toolNames: string[];
}

// ---------------------------------------------------------------------------
// LearningExtractor
// ---------------------------------------------------------------------------

export class LearningExtractor {
  /** Per-role+task tool usage history */
  private readonly toolHistory = new Map<
    string,
    Map<string, ToolHistoryEntry>
  >();

  /** Per-role+task error history */
  private readonly errorHistory = new Map<string, ErrorHistoryEntry[]>();

  /** Per-role+task quality snapshots (only sessions with a quality score) */
  private readonly qualitySnapshots = new Map<string, QualitySnapshot[]>();

  /** Per-role+task iteration counts for successful sessions */
  private readonly iterationCounts = new Map<string, number[]>();

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Analyse a completed session and return extracted learning patterns.
   * Patterns are also persisted as procedural memories in Project Brain.
   */
  async extract(analysis: SessionAnalysis): Promise<LearningPattern[]> {
    logger.info(
      {
        sessionId: analysis.sessionId,
        agentRole: analysis.agentRole,
        taskType: analysis.taskType,
        success: analysis.success,
      },
      "Extracting learning patterns from session"
    );

    this.recordSession(analysis);

    const patterns: LearningPattern[] = [
      ...this.analyzeToolPatterns(analysis),
      ...this.analyzeErrorPatterns(analysis),
      ...this.analyzeQualityCorrelations(analysis),
      ...this.analyzeIterationInsights(analysis),
    ];

    if (patterns.length > 0) {
      await this.persistLearnings(patterns, analysis.projectId);
    }

    logger.debug(
      { patterns: patterns.length, sessionId: analysis.sessionId },
      "Learning patterns extracted"
    );

    return patterns;
  }

  /**
   * Extract learning patterns and persist successful tool sequences
   * to Project Brain's memory store for future retrieval.
   */
  async extractAndPersist(
    analysis: SessionAnalysis
  ): Promise<LearningPattern[]> {
    const patterns = await this.extract(analysis);

    // POST successful tool sequences to Project Brain /memory/store
    if (analysis.success && analysis.toolCalls.length > 0) {
      const successfulTools = analysis.toolCalls
        .filter((t) => t.success)
        .map((t) => t.name);

      if (successfulTools.length > 0) {
        try {
          await projectBrainClient.post(
            "/memory/store",
            {
              projectId: analysis.projectId,
              type: "procedural",
              data: {
                id: generateId(),
                patternType: "tool_sequence",
                agentRole: analysis.agentRole,
                taskType: analysis.taskType,
                decision: `Successful tool sequence: ${successfulTools.join(" -> ")}`,
                reasoning: `duration=${analysis.totalDuration}ms, tokens=${analysis.totalTokens}, files=${analysis.filesChanged.length}`,
                outcome: "success",
              },
            },
            { timeout: 5000 }
          );
          logger.info(
            {
              sessionId: analysis.sessionId,
              toolCount: successfulTools.length,
            },
            "Persisted successful tool sequence to Project Brain"
          );
        } catch (err) {
          logger.warn(
            { err, sessionId: analysis.sessionId },
            "Failed to persist tool sequence to Project Brain"
          );
        }
      }
    }

    return patterns;
  }

  /**
   * Build a context string suitable for injection into an agent system
   * prompt. Combines locally accumulated patterns with procedural
   * memories fetched from Project Brain.
   */
  async getLearnedContext(
    agentRole: string,
    taskType: string,
    projectId: string
  ): Promise<string> {
    const memories = await this.queryProceduralMemories(
      agentRole,
      taskType,
      projectId
    );

    if (memories.length === 0) {
      return "";
    }

    // Sort by confidence descending, take top insights
    const top = memories
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    const lines: string[] = [
      `## Learned Patterns for ${agentRole} — ${taskType}`,
    ];

    for (const m of top) {
      const label = formatPatternType(m.type);
      const conf = `${(m.confidence * 100).toFixed(0)}%`;
      lines.push(
        `- [${label}] (${conf} confidence, ${m.occurrences}x) ${m.pattern}`
      );
    }

    return lines.join("\n");
  }

  // -----------------------------------------------------------------------
  // Pattern analysers
  // -----------------------------------------------------------------------

  private analyzeToolPatterns(analysis: SessionAnalysis): LearningPattern[] {
    const key = compositeKey(analysis.agentRole, analysis.taskType);
    const toolMap = this.toolHistory.get(key);

    if (!toolMap) {
      return [];
    }

    const patterns: LearningPattern[] = [];
    const now = new Date().toISOString();

    for (const [toolName, entry] of toolMap) {
      const total = entry.successCount + entry.failCount;
      if (total < 2) {
        continue;
      }

      const successRate = entry.successCount / total;
      const avgDuration =
        entry.totalDuration > 0
          ? Math.round(entry.totalDuration / total)
          : undefined;

      if (successRate >= 0.8) {
        patterns.push({
          type: "tool_pattern",
          agentRole: analysis.agentRole,
          taskType: analysis.taskType,
          pattern: `Tool "${toolName}" is highly effective for ${analysis.taskType} tasks (${(successRate * 100).toFixed(0)}% success${avgDuration ? `, avg ${avgDuration}ms` : ""}).`,
          confidence: clamp(successRate, 0, 1),
          occurrences: total,
          lastSeen: now,
        });
      } else if (successRate <= 0.3 && total >= 3) {
        patterns.push({
          type: "tool_pattern",
          agentRole: analysis.agentRole,
          taskType: analysis.taskType,
          pattern: `Tool "${toolName}" frequently fails for ${analysis.taskType} tasks (${(successRate * 100).toFixed(0)}% success). Consider alternative approaches.`,
          confidence: clamp(1 - successRate, 0, 1),
          occurrences: total,
          lastSeen: now,
        });
      }
    }

    return patterns;
  }

  private analyzeErrorPatterns(analysis: SessionAnalysis): LearningPattern[] {
    const key = compositeKey(analysis.agentRole, analysis.taskType);
    const errors = this.errorHistory.get(key);

    if (!errors || errors.length === 0) {
      return [];
    }

    const patterns: LearningPattern[] = [];
    const now = new Date().toISOString();

    for (const entry of errors) {
      if (entry.occurrences < 2) {
        continue;
      }

      const hasResolution = entry.resolvedAfter.length > 0;
      const confidence = hasResolution
        ? clamp(0.5 + entry.occurrences * 0.1, 0, 0.95)
        : clamp(0.3 + entry.occurrences * 0.05, 0, 0.7);

      const resolutionHint = hasResolution
        ? ` Previously resolved by: ${entry.resolvedAfter.slice(0, 3).join("; ")}.`
        : "";

      patterns.push({
        type: "error_resolution",
        agentRole: analysis.agentRole,
        taskType: analysis.taskType,
        pattern: `Recurring error: "${truncate(entry.message, 120)}". Seen ${entry.occurrences} times.${resolutionHint}`,
        confidence,
        occurrences: entry.occurrences,
        lastSeen: now,
      });
    }

    return patterns;
  }

  private analyzeQualityCorrelations(
    analysis: SessionAnalysis
  ): LearningPattern[] {
    const key = compositeKey(analysis.agentRole, analysis.taskType);
    const snapshots = this.qualitySnapshots.get(key);

    if (!snapshots || snapshots.length < 3) {
      return [];
    }

    const patterns: LearningPattern[] = [];
    const now = new Date().toISOString();

    // Split into high-quality and low-quality buckets
    const sorted = [...snapshots].sort(
      (a, b) => b.qualityScore - a.qualityScore
    );
    const highQ = sorted.slice(0, Math.ceil(sorted.length / 3));
    const lowQ = sorted.slice(-Math.ceil(sorted.length / 3));

    // Compare average token usage
    const avgTokensHigh = average(highQ.map((s) => s.tokens));
    const avgTokensLow = average(lowQ.map((s) => s.tokens));

    if (avgTokensHigh > 0 && avgTokensLow > 0) {
      const ratio = avgTokensHigh / avgTokensLow;
      if (ratio > 1.3) {
        patterns.push({
          type: "quality_correlation",
          agentRole: analysis.agentRole,
          taskType: analysis.taskType,
          pattern: `Higher token budgets correlate with better quality for ${analysis.taskType}. High-quality sessions average ${Math.round(avgTokensHigh)} tokens vs ${Math.round(avgTokensLow)} for low-quality.`,
          confidence: clamp(0.5 + snapshots.length * 0.05, 0, 0.9),
          occurrences: snapshots.length,
          lastSeen: now,
        });
      } else if (ratio < 0.8) {
        patterns.push({
          type: "quality_correlation",
          agentRole: analysis.agentRole,
          taskType: analysis.taskType,
          pattern: `More tokens do not improve quality for ${analysis.taskType}. Concise approaches may be more effective.`,
          confidence: clamp(0.5 + snapshots.length * 0.05, 0, 0.9),
          occurrences: snapshots.length,
          lastSeen: now,
        });
      }
    }

    // Compare number of files changed
    const avgFilesHigh = average(highQ.map((s) => s.filesChanged));
    const avgFilesLow = average(lowQ.map((s) => s.filesChanged));

    if (avgFilesHigh > 0 && avgFilesLow > 0 && avgFilesHigh !== avgFilesLow) {
      const moreFiles = avgFilesHigh > avgFilesLow;
      patterns.push({
        type: "quality_correlation",
        agentRole: analysis.agentRole,
        taskType: analysis.taskType,
        pattern: moreFiles
          ? `Higher-quality ${analysis.taskType} sessions tend to change more files (avg ${avgFilesHigh.toFixed(1)} vs ${avgFilesLow.toFixed(1)}). Consider broader scope changes.`
          : `Higher-quality ${analysis.taskType} sessions change fewer files (avg ${avgFilesHigh.toFixed(1)} vs ${avgFilesLow.toFixed(1)}). Prefer focused, surgical changes.`,
        confidence: clamp(0.4 + snapshots.length * 0.04, 0, 0.85),
        occurrences: snapshots.length,
        lastSeen: now,
      });
    }

    // Identify tools common in high-quality sessions
    const toolFreqHigh = countToolFrequency(highQ);
    const toolFreqLow = countToolFrequency(lowQ);

    for (const [tool, highCount] of toolFreqHigh) {
      const lowCount = toolFreqLow.get(tool) ?? 0;
      const highRate = highCount / highQ.length;
      const lowRate = lowQ.length > 0 ? lowCount / lowQ.length : 0;

      if (highRate > lowRate + 0.3 && highCount >= 2) {
        patterns.push({
          type: "quality_correlation",
          agentRole: analysis.agentRole,
          taskType: analysis.taskType,
          pattern: `Tool "${tool}" appears in ${(highRate * 100).toFixed(0)}% of high-quality sessions vs ${(lowRate * 100).toFixed(0)}% of low-quality. Use it more often.`,
          confidence: clamp(0.5 + highCount * 0.05, 0, 0.85),
          occurrences: highCount,
          lastSeen: now,
        });
      }
    }

    return patterns;
  }

  private analyzeIterationInsights(
    analysis: SessionAnalysis
  ): LearningPattern[] {
    const key = compositeKey(analysis.agentRole, analysis.taskType);
    const counts = this.iterationCounts.get(key);

    if (!counts || counts.length < 3) {
      return [];
    }

    const sorted = [...counts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const avg = average(sorted);
    const now = new Date().toISOString();

    return [
      {
        type: "iteration_insight",
        agentRole: analysis.agentRole,
        taskType: analysis.taskType,
        pattern: `Successful ${analysis.taskType} sessions for ${analysis.agentRole} typically need ~${median} iterations (median) / ${avg.toFixed(1)} (avg) across ${counts.length} sessions. Set iteration budget accordingly.`,
        confidence: clamp(0.5 + counts.length * 0.05, 0, 0.95),
        occurrences: counts.length,
        lastSeen: now,
      },
    ];
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  private async persistLearnings(
    patterns: LearningPattern[],
    projectId: string
  ): Promise<void> {
    const storagePromises = patterns.map(async (pattern) => {
      try {
        await projectBrainClient.post(
          "/memory/store",
          {
            projectId,
            type: "procedural",
            data: {
              id: generateId(),
              patternType: pattern.type,
              agentRole: pattern.agentRole,
              taskType: pattern.taskType,
              decision: pattern.pattern,
              reasoning: `confidence=${pattern.confidence}, occurrences=${pattern.occurrences}`,
              outcome:
                pattern.confidence >= 0.7 ? "high_confidence" : "emerging",
            },
          },
          { timeout: 5000 }
        );
      } catch (err) {
        logger.warn(
          { err, patternType: pattern.type, agentRole: pattern.agentRole },
          "Failed to persist learning pattern"
        );
      }
    });

    await Promise.allSettled(storagePromises);
  }

  private async queryProceduralMemories(
    agentRole: string,
    taskType: string,
    projectId: string
  ): Promise<LearningPattern[]> {
    try {
      const query = encodeURIComponent(`${agentRole} ${taskType}`);
      const response = await projectBrainClient.get<{
        memories: Array<{
          decision: string;
          reasoning?: string;
          patternType?: string;
          agentRole?: string;
          taskType?: string;
        }>;
      }>(`/memory/${projectId}?type=procedural&query=${query}&limit=20`, {
        timeout: 5000,
      });

      return response.data.memories.map((m) => {
        const parsed = parseReasoningMeta(m.reasoning);
        return {
          type: (m.patternType as LearningPattern["type"]) ?? "tool_pattern",
          agentRole: m.agentRole ?? agentRole,
          taskType: m.taskType ?? taskType,
          pattern: m.decision,
          confidence: parsed.confidence,
          occurrences: parsed.occurrences,
          lastSeen: new Date().toISOString(),
        };
      });
    } catch (err) {
      logger.warn(
        { err, agentRole, taskType, projectId },
        "Failed to query procedural memories"
      );
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Internal state management
  // -----------------------------------------------------------------------

  /**
   * Record a session's data into the local history maps so subsequent
   * analysis calls have cumulative data to work with.
   */
  private recordSession(analysis: SessionAnalysis): void {
    const key = compositeKey(analysis.agentRole, analysis.taskType);

    // Tool history
    if (!this.toolHistory.has(key)) {
      this.toolHistory.set(key, new Map());
    }
    const toolMap = this.toolHistory.get(key) as Map<string, ToolHistoryEntry>;

    for (const call of analysis.toolCalls) {
      const existing = toolMap.get(call.name) ?? {
        name: call.name,
        successCount: 0,
        failCount: 0,
        totalDuration: 0,
      };
      if (call.success) {
        existing.successCount++;
      } else {
        existing.failCount++;
      }
      existing.totalDuration += call.duration ?? 0;
      toolMap.set(call.name, existing);
    }

    // Error history
    if (analysis.errorMessages.length > 0) {
      if (!this.errorHistory.has(key)) {
        this.errorHistory.set(key, []);
      }
      const errors = this.errorHistory.get(key) as ErrorHistoryEntry[];

      for (const msg of analysis.errorMessages) {
        const normalised = normaliseError(msg);
        const existing = errors.find((e) => e.message === normalised);
        if (existing) {
          existing.occurrences++;
          // If this session succeeded despite the error, record what tools
          // were used after the error as potential resolution strategies
          if (analysis.success) {
            const resolutionTools = analysis.toolCalls
              .filter((t) => t.success)
              .map((t) => t.name);
            const unique = new Set([
              ...existing.resolvedAfter,
              ...resolutionTools,
            ]);
            existing.resolvedAfter = [...unique].slice(0, 5);
          }
        } else {
          errors.push({
            message: normalised,
            occurrences: 1,
            resolvedAfter: analysis.success
              ? analysis.toolCalls
                  .filter((t) => t.success)
                  .map((t) => t.name)
                  .slice(0, 3)
              : [],
          });
        }
      }
    }

    // Quality snapshots
    if (analysis.qualityScore !== undefined && analysis.success) {
      if (!this.qualitySnapshots.has(key)) {
        this.qualitySnapshots.set(key, []);
      }
      (this.qualitySnapshots.get(key) as QualitySnapshot[]).push({
        toolNames: analysis.toolCalls.map((t) => t.name),
        filesChanged: analysis.filesChanged.length,
        tokens: analysis.totalTokens,
        duration: analysis.totalDuration,
        qualityScore: analysis.qualityScore,
      });
    }

    // Iteration counts — infer iteration count from tool call count for
    // successful sessions (each tool call roughly maps to an iteration)
    if (analysis.success && analysis.toolCalls.length > 0) {
      if (!this.iterationCounts.has(key)) {
        this.iterationCounts.set(key, []);
      }
      (this.iterationCounts.get(key) as number[]).push(
        analysis.toolCalls.length
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Top-level regex patterns
const PATH_RE = /\/[\w/.:-]+/g;
const LINE_NUM_RE = /:\d+:\d+/g;
const HEX_ADDR_RE = /0x[0-9a-fA-F]+/g;
const WHITESPACE_RE = /\s+/g;
const CONFIDENCE_RE = /confidence=([\d.]+)/;
const OCCURRENCES_RE = /occurrences=(\d+)/;

function compositeKey(agentRole: string, taskType: string): string {
  return `${agentRole}:${taskType}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return `${str.slice(0, maxLen - 3)}...`;
}

/**
 * Normalise an error message so slight variations are grouped together.
 * Strips file paths, line numbers, and hex addresses.
 */
function normaliseError(msg: string): string {
  return msg
    .replace(PATH_RE, "<path>")
    .replace(LINE_NUM_RE, ":<line>")
    .replace(HEX_ADDR_RE, "<addr>")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .slice(0, 200);
}

function countToolFrequency(snapshots: QualitySnapshot[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const snap of snapshots) {
    const unique = new Set(snap.toolNames);
    for (const tool of unique) {
      freq.set(tool, (freq.get(tool) ?? 0) + 1);
    }
  }
  return freq;
}

function formatPatternType(type: LearningPattern["type"]): string {
  const labels: Record<LearningPattern["type"], string> = {
    tool_pattern: "Tool",
    error_resolution: "Error",
    quality_correlation: "Quality",
    iteration_insight: "Iterations",
  };
  return labels[type];
}

/**
 * Parse confidence and occurrences from the reasoning string stored
 * alongside procedural memories.
 */
function parseReasoningMeta(reasoning?: string): {
  confidence: number;
  occurrences: number;
} {
  if (!reasoning) {
    return { confidence: 0.5, occurrences: 1 };
  }

  const confMatch = reasoning.match(CONFIDENCE_RE);
  const occMatch = reasoning.match(OCCURRENCES_RE);

  return {
    confidence: confMatch ? Number.parseFloat(confMatch[1] ?? "0.5") : 0.5,
    occurrences: occMatch ? Number.parseInt(occMatch[1] ?? "1", 10) : 1,
  };
}
