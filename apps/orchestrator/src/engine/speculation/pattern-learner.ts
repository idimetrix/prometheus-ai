/**
 * PatternLearner — Learns per-project tool call sequences and predicts
 * the next likely tool call based on observed patterns.
 *
 * Stores patterns in memory (with Redis persistence option) and uses
 * n-gram matching to predict what tool comes next in a sequence.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:speculation:pattern-learner");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  args?: Record<string, unknown>;
  timestamp: number;
  toolName: string;
}

export interface Prediction {
  /** Predicted arguments (from most common args for this pattern) */
  args: Record<string, unknown>;
  /** Prediction confidence (0-1) */
  confidence: number;
  /** How many times this pattern has been observed */
  observationCount: number;
  /** Predicted tool name */
  toolName: string;
}

export interface PatternSequence {
  /** How many times this full sequence has been observed */
  count: number;
  /** Most common args for the next tool */
  nextArgs: Record<string, unknown>;
  /** What tool typically follows this sequence */
  nextTool: string;
  /** The trigger sequence (e.g., ["file_read", "file_edit"]) */
  sequence: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum n-gram size for pattern matching. */
const MAX_NGRAM_SIZE = 4;

/** Minimum observations before a pattern is considered reliable. */
const MIN_OBSERVATIONS = 3;

/** Maximum number of patterns to store per project. */
const MAX_PATTERNS = 500;

// ---------------------------------------------------------------------------
// PatternLearner
// ---------------------------------------------------------------------------

export class PatternLearner {
  private readonly projectId: string;

  /**
   * Pattern storage: key = sequence joined by "→", value = map of next tools
   * with their counts and common args.
   */
  private readonly patterns = new Map<
    string,
    Map<string, { count: number; args: Record<string, unknown> }>
  >();

  /** Current tool call history for sequence building. */
  private history: ToolCallRecord[] = [];

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * Record a tool call and update pattern statistics.
   */
  recordPattern(sequence: ToolCallRecord[]): void {
    if (sequence.length === 0) {
      return;
    }

    // Add to history
    this.history.push(...sequence);

    // Trim history to prevent unbounded growth
    if (this.history.length > MAX_PATTERNS) {
      this.history = this.history.slice(-MAX_PATTERNS);
    }

    // Extract n-grams and record transitions
    const toolNames = this.history.map((r) => r.toolName);

    for (let n = 1; n <= Math.min(MAX_NGRAM_SIZE, toolNames.length - 1); n++) {
      this.recordNgramTransitions(toolNames, n);
    }

    // Prune low-frequency patterns to stay within limits
    this.prunePatterns();
  }

  private recordNgramTransitions(toolNames: string[], n: number): void {
    for (let i = 0; i <= toolNames.length - n - 1; i++) {
      const ngram = toolNames.slice(i, i + n);
      const nextTool = toolNames[i + n];

      if (!nextTool) {
        continue;
      }

      const key = ngram.join("→");

      if (!this.patterns.has(key)) {
        this.patterns.set(key, new Map());
      }

      const transitions = this.patterns.get(key);
      if (!transitions) {
        continue;
      }

      const existing = transitions.get(nextTool);
      const nextRecord = this.history[i + n];

      if (existing) {
        existing.count++;
        if (nextRecord?.args) {
          existing.args = nextRecord.args;
        }
      } else {
        transitions.set(nextTool, {
          count: 1,
          args: nextRecord?.args ?? {},
        });
      }
    }
  }

  /**
   * Predict the next tool call based on the current sequence.
   */
  predictNext(currentSequence: ToolCallRecord[]): Prediction | null {
    if (currentSequence.length === 0) {
      return null;
    }

    const toolNames = currentSequence.map((r) => r.toolName);

    // Try longest n-gram first for best accuracy, fall back to shorter
    for (let n = Math.min(MAX_NGRAM_SIZE, toolNames.length); n >= 1; n--) {
      const ngram = toolNames.slice(-n);
      const key = ngram.join("→");
      const transitions = this.patterns.get(key);

      if (!transitions || transitions.size === 0) {
        continue;
      }

      // Find the most common next tool
      let bestTool = "";
      let bestCount = 0;
      let bestArgs: Record<string, unknown> = {};
      let totalCount = 0;

      for (const [tool, data] of transitions) {
        totalCount += data.count;
        if (data.count > bestCount) {
          bestCount = data.count;
          bestTool = tool;
          bestArgs = data.args;
        }
      }

      if (bestCount < MIN_OBSERVATIONS) {
        continue;
      }

      // Confidence = (count of best / total transitions) * (n-gram length bonus)
      const baseConfidence = bestCount / totalCount;
      const lengthBonus = Math.min(n / MAX_NGRAM_SIZE, 0.3);
      const confidence = Math.min(baseConfidence + lengthBonus, 1.0);

      logger.debug(
        {
          projectId: this.projectId,
          ngram: key,
          predictedTool: bestTool,
          confidence: confidence.toFixed(2),
          observationCount: bestCount,
        },
        "Pattern prediction generated"
      );

      return {
        toolName: bestTool,
        args: bestArgs,
        confidence,
        observationCount: bestCount,
      };
    }

    return null;
  }

  /**
   * Get all learned patterns for this project.
   */
  getPatterns(): PatternSequence[] {
    const result: PatternSequence[] = [];

    for (const [key, transitions] of this.patterns) {
      const sequence = key.split("→");

      for (const [nextTool, data] of transitions) {
        if (data.count >= MIN_OBSERVATIONS) {
          result.push({
            sequence,
            nextTool,
            nextArgs: data.args,
            count: data.count,
          });
        }
      }
    }

    return result.sort((a, b) => b.count - a.count);
  }

  /**
   * Get the number of stored patterns.
   */
  getPatternCount(): number {
    return this.patterns.size;
  }

  /**
   * Serialize patterns for persistence (e.g., to proceduralMemories table).
   */
  serialize(): string {
    const data: Record<
      string,
      Record<string, { count: number; args: Record<string, unknown> }>
    > = {};

    for (const [key, transitions] of this.patterns) {
      const transitionData: Record<
        string,
        { count: number; args: Record<string, unknown> }
      > = {};
      for (const [tool, toolData] of transitions) {
        transitionData[tool] = toolData;
      }
      data[key] = transitionData;
    }

    return JSON.stringify(data);
  }

  /**
   * Restore patterns from serialized data.
   */
  deserialize(data: string): void {
    try {
      const parsed = JSON.parse(data) as Record<
        string,
        Record<string, { count: number; args: Record<string, unknown> }>
      >;

      for (const [key, transitions] of Object.entries(parsed)) {
        const transitionMap = new Map<
          string,
          { count: number; args: Record<string, unknown> }
        >();

        for (const [tool, toolData] of Object.entries(transitions)) {
          transitionMap.set(tool, toolData);
        }

        this.patterns.set(key, transitionMap);
      }

      logger.info(
        { projectId: this.projectId, patternCount: this.patterns.size },
        "Patterns restored from serialized data"
      );
    } catch (error) {
      logger.error(
        { projectId: this.projectId, error: String(error) },
        "Failed to deserialize patterns"
      );
    }
  }

  /**
   * Reset all learned patterns.
   */
  reset(): void {
    this.patterns.clear();
    this.history = [];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private prunePatterns(): void {
    if (this.patterns.size <= MAX_PATTERNS) {
      return;
    }

    // Remove patterns with lowest total counts
    const entries = Array.from(this.patterns.entries()).map(
      ([key, transitions]) => {
        let totalCount = 0;
        for (const data of transitions.values()) {
          totalCount += data.count;
        }
        return { key, totalCount };
      }
    );

    entries.sort((a, b) => a.totalCount - b.totalCount);

    const toRemove = entries.slice(0, entries.length - MAX_PATTERNS);
    for (const entry of toRemove) {
      this.patterns.delete(entry.key);
    }
  }
}
