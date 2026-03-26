/**
 * Prompt Versioning and Evaluation System.
 *
 * Tracks prompt template versions, records evaluation results per version,
 * and supports A/B testing different prompt templates against each other.
 * Integrates with the ABTestManager for traffic splitting.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("model-router:prompt-versioning");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptVersion {
  /** When this version was created */
  createdAt: string;
  /** Unique version identifier */
  id: string;
  /** Whether this version is currently active for its slot */
  isActive: boolean;
  /** Optional metadata (author, commit hash, etc.) */
  metadata: Record<string, string>;
  /** The slot/use-case this prompt targets (e.g., "planner", "coder") */
  slot: string;
  /** The full prompt template text */
  template: string;
  /** Semantic version string */
  version: string;
}

export interface PromptEvaluation {
  /** Average cost per call in USD */
  avgCostUsd: number;
  /** Average latency in ms across evaluations */
  avgLatencyMs: number;
  /** Number of evaluation runs */
  evalCount: number;
  /** The evaluated prompt version ID */
  id: string;
  /** Timestamp of last evaluation */
  lastEvaluatedAt: string;
  /** Average quality score (0-1) from evaluator */
  qualityScore: number;
  /** Individual evaluation results */
  results: EvalResult[];
}

export interface EvalResult {
  costUsd: number;
  latencyMs: number;
  qualityScore: number;
  testCaseId: string;
  timestamp: string;
}

export interface PromptComparisonResult {
  baselineScore: number;
  baselineVersionId: string;
  candidateScore: number;
  candidateVersionId: string;
  improvement: number;
  recommendation: "promote" | "keep_baseline" | "needs_more_data";
  sampleSize: number;
}

// ---------------------------------------------------------------------------
// PromptVersionManager
// ---------------------------------------------------------------------------

export class PromptVersionManager {
  private readonly versions = new Map<string, PromptVersion>();
  private readonly evaluations = new Map<string, PromptEvaluation>();

  /** Secondary index: slot -> version IDs (ordered by creation) */
  private readonly bySlot = new Map<string, string[]>();

  // -----------------------------------------------------------------------
  // Version CRUD
  // -----------------------------------------------------------------------

  /**
   * Create a new prompt version for a given slot.
   */
  createVersion(
    slot: string,
    template: string,
    version: string,
    metadata: Record<string, string> = {}
  ): PromptVersion {
    const id = generateId("pv");
    const pv: PromptVersion = {
      id,
      slot,
      template,
      version,
      isActive: false,
      metadata,
      createdAt: new Date().toISOString(),
    };

    this.versions.set(id, pv);

    const slotVersions = this.bySlot.get(slot) ?? [];
    slotVersions.push(id);
    this.bySlot.set(slot, slotVersions);

    logger.info({ id, slot, version }, "Created new prompt version");

    return pv;
  }

  /**
   * Activate a prompt version for its slot, deactivating any currently active version.
   */
  activateVersion(versionId: string): void {
    const pv = this.versions.get(versionId);
    if (!pv) {
      throw new Error(`Prompt version not found: ${versionId}`);
    }

    // Deactivate current active version for this slot
    const slotVersionIds = this.bySlot.get(pv.slot) ?? [];
    for (const id of slotVersionIds) {
      const v = this.versions.get(id);
      if (v) {
        v.isActive = false;
      }
    }

    pv.isActive = true;

    logger.info(
      { versionId, slot: pv.slot, version: pv.version },
      "Activated prompt version"
    );
  }

  /**
   * Get the currently active prompt version for a slot.
   */
  getActiveVersion(slot: string): PromptVersion | null {
    const slotVersionIds = this.bySlot.get(slot) ?? [];
    for (const id of slotVersionIds) {
      const v = this.versions.get(id);
      if (v?.isActive) {
        return v;
      }
    }
    return null;
  }

  /**
   * Get all versions for a slot.
   */
  getVersionsBySlot(slot: string): PromptVersion[] {
    const slotVersionIds = this.bySlot.get(slot) ?? [];
    const results: PromptVersion[] = [];
    for (const id of slotVersionIds) {
      const v = this.versions.get(id);
      if (v) {
        results.push(v);
      }
    }
    return results;
  }

  /**
   * Get a specific version by ID.
   */
  getVersion(id: string): PromptVersion | undefined {
    return this.versions.get(id);
  }

  /**
   * List all known slots with prompt versions.
   */
  listSlots(): string[] {
    return Array.from(this.bySlot.keys());
  }

  // -----------------------------------------------------------------------
  // Evaluation
  // -----------------------------------------------------------------------

  /**
   * Record an evaluation result for a prompt version.
   */
  recordEvaluation(
    versionId: string,
    testCaseId: string,
    qualityScore: number,
    latencyMs: number,
    costUsd: number
  ): void {
    const pv = this.versions.get(versionId);
    if (!pv) {
      throw new Error(`Prompt version not found: ${versionId}`);
    }

    let evaluation = this.evaluations.get(versionId);
    if (!evaluation) {
      evaluation = {
        id: versionId,
        evalCount: 0,
        qualityScore: 0,
        avgLatencyMs: 0,
        avgCostUsd: 0,
        lastEvaluatedAt: "",
        results: [],
      };
      this.evaluations.set(versionId, evaluation);
    }

    const result: EvalResult = {
      testCaseId,
      qualityScore,
      latencyMs,
      costUsd,
      timestamp: new Date().toISOString(),
    };

    evaluation.results.push(result);
    evaluation.evalCount = evaluation.results.length;
    evaluation.lastEvaluatedAt = result.timestamp;

    // Recompute averages
    const totalQuality = evaluation.results.reduce(
      (sum, r) => sum + r.qualityScore,
      0
    );
    const totalLatency = evaluation.results.reduce(
      (sum, r) => sum + r.latencyMs,
      0
    );
    const totalCost = evaluation.results.reduce((sum, r) => sum + r.costUsd, 0);

    evaluation.qualityScore = totalQuality / evaluation.evalCount;
    evaluation.avgLatencyMs = totalLatency / evaluation.evalCount;
    evaluation.avgCostUsd = totalCost / evaluation.evalCount;

    logger.debug(
      {
        versionId,
        testCaseId,
        qualityScore,
        evalCount: evaluation.evalCount,
      },
      "Recorded prompt evaluation"
    );
  }

  /**
   * Get evaluation metrics for a prompt version.
   */
  getEvaluation(versionId: string): PromptEvaluation | null {
    return this.evaluations.get(versionId) ?? null;
  }

  // -----------------------------------------------------------------------
  // Comparison
  // -----------------------------------------------------------------------

  /**
   * Compare two prompt versions based on their evaluation results.
   * Returns a recommendation to promote or keep baseline.
   */
  compareVersions(
    baselineVersionId: string,
    candidateVersionId: string
  ): PromptComparisonResult {
    const baselineEval = this.evaluations.get(baselineVersionId);
    const candidateEval = this.evaluations.get(candidateVersionId);

    const baselineScore = baselineEval?.qualityScore ?? 0;
    const candidateScore = candidateEval?.qualityScore ?? 0;
    const baselineCount = baselineEval?.evalCount ?? 0;
    const candidateCount = candidateEval?.evalCount ?? 0;
    const sampleSize = baselineCount + candidateCount;
    const MIN_SAMPLE_SIZE = 10;
    const IMPROVEMENT_THRESHOLD = 0.05;

    const improvement =
      baselineScore > 0 ? (candidateScore - baselineScore) / baselineScore : 0;

    let recommendation: PromptComparisonResult["recommendation"];
    if (sampleSize < MIN_SAMPLE_SIZE) {
      recommendation = "needs_more_data";
    } else if (improvement >= IMPROVEMENT_THRESHOLD) {
      recommendation = "promote";
    } else {
      recommendation = "keep_baseline";
    }

    logger.info(
      {
        baselineVersionId,
        candidateVersionId,
        baselineScore: baselineScore.toFixed(3),
        candidateScore: candidateScore.toFixed(3),
        improvement: improvement.toFixed(3),
        recommendation,
        sampleSize,
      },
      "Prompt version comparison complete"
    );

    return {
      baselineVersionId,
      candidateVersionId,
      baselineScore,
      candidateScore,
      improvement,
      recommendation,
      sampleSize,
    };
  }
}
