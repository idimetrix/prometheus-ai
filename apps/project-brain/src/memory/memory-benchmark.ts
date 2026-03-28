/**
 * GAP-042: 8-Layer Memory System Benchmark
 *
 * Benchmarks memory retrieval quality across all layers, tracks
 * memory-assisted vs baseline agent quality scores, and records
 * cross-session learning effectiveness.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:memory-benchmark");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryLayer =
  | "episodic"
  | "semantic"
  | "procedural"
  | "convention"
  | "user-preference"
  | "project-context"
  | "cross-session"
  | "meta-learning";

export interface RetrievalSample {
  durationMs: number;
  layer: MemoryLayer;
  projectId: string;
  query: string;
  relevanceScore: number;
  resultsCount: number;
  timestamp: number;
}

export interface QualityComparison {
  baselineQuality: number;
  memoryAssistedQuality: number;
  projectId: string;
  taskId: string;
  taskType: string;
  timestamp: number;
}

export interface CrossSessionResult {
  improvementDelta: number;
  projectId: string;
  sessionCount: number;
  sessionId: string;
  taskType: string;
  timestamp: number;
}

export interface MemoryBenchmarkReport {
  avgBaselineQuality: number;
  avgMemoryAssistedQuality: number;
  crossSessionImprovement: number;
  qualityLift: number;
  retrievalByLayer: Record<
    string,
    {
      avgDurationMs: number;
      avgRelevance: number;
      sampleCount: number;
    }
  >;
  totalComparisons: number;
  totalRetrievals: number;
}

// ---------------------------------------------------------------------------
// MemoryBenchmark
// ---------------------------------------------------------------------------

export class MemoryBenchmark {
  private readonly retrievals: RetrievalSample[] = [];
  private readonly comparisons: QualityComparison[] = [];
  private readonly crossSessionResults: CrossSessionResult[] = [];

  /**
   * Record a memory retrieval sample.
   */
  recordRetrieval(sample: RetrievalSample): void {
    this.retrievals.push(sample);
    if (this.retrievals.length > 10_000) {
      this.retrievals.splice(0, this.retrievals.length - 10_000);
    }
    logger.debug(
      {
        layer: sample.layer,
        relevance: sample.relevanceScore.toFixed(3),
        durationMs: sample.durationMs,
      },
      "Memory retrieval recorded"
    );
  }

  /**
   * Record a quality comparison between memory-assisted and baseline runs.
   */
  recordComparison(comparison: QualityComparison): void {
    this.comparisons.push(comparison);
    if (this.comparisons.length > 5000) {
      this.comparisons.splice(0, this.comparisons.length - 5000);
    }
    logger.info(
      {
        taskId: comparison.taskId,
        baseline: comparison.baselineQuality.toFixed(3),
        assisted: comparison.memoryAssistedQuality.toFixed(3),
      },
      "Quality comparison recorded"
    );
  }

  /**
   * Record cross-session learning effectiveness.
   */
  recordCrossSessionResult(result: CrossSessionResult): void {
    this.crossSessionResults.push(result);
    if (this.crossSessionResults.length > 5000) {
      this.crossSessionResults.splice(
        0,
        this.crossSessionResults.length - 5000
      );
    }
  }

  /**
   * Generate a full benchmark report.
   */
  generateReport(sinceMs?: number): MemoryBenchmarkReport {
    const cutoff = sinceMs ?? 0;

    const filteredRetrievals = this.retrievals.filter(
      (r) => r.timestamp >= cutoff
    );
    const filteredComparisons = this.comparisons.filter(
      (c) => c.timestamp >= cutoff
    );
    const filteredCross = this.crossSessionResults.filter(
      (c) => c.timestamp >= cutoff
    );

    // Retrieval stats by layer
    const retrievalByLayer: MemoryBenchmarkReport["retrievalByLayer"] = {};
    for (const sample of filteredRetrievals) {
      const existing = retrievalByLayer[sample.layer] ?? {
        avgDurationMs: 0,
        avgRelevance: 0,
        sampleCount: 0,
      };
      const newCount = existing.sampleCount + 1;
      existing.avgDurationMs =
        (existing.avgDurationMs * existing.sampleCount + sample.durationMs) /
        newCount;
      existing.avgRelevance =
        (existing.avgRelevance * existing.sampleCount + sample.relevanceScore) /
        newCount;
      existing.sampleCount = newCount;
      retrievalByLayer[sample.layer] = existing;
    }

    // Quality comparison stats
    const avgBaseline =
      filteredComparisons.length > 0
        ? filteredComparisons.reduce((s, c) => s + c.baselineQuality, 0) /
          filteredComparisons.length
        : 0;
    const avgAssisted =
      filteredComparisons.length > 0
        ? filteredComparisons.reduce((s, c) => s + c.memoryAssistedQuality, 0) /
          filteredComparisons.length
        : 0;

    // Cross-session improvement
    const crossSessionImprovement =
      filteredCross.length > 0
        ? filteredCross.reduce((s, c) => s + c.improvementDelta, 0) /
          filteredCross.length
        : 0;

    const report: MemoryBenchmarkReport = {
      totalRetrievals: filteredRetrievals.length,
      totalComparisons: filteredComparisons.length,
      retrievalByLayer,
      avgBaselineQuality: avgBaseline,
      avgMemoryAssistedQuality: avgAssisted,
      qualityLift: avgAssisted - avgBaseline,
      crossSessionImprovement,
    };

    logger.info(
      {
        totalRetrievals: report.totalRetrievals,
        qualityLift: report.qualityLift.toFixed(3),
        crossSession: report.crossSessionImprovement.toFixed(3),
      },
      "Memory benchmark report generated"
    );

    return report;
  }
}
