/**
 * MemoryQualityScorer — Tracks whether injected learnings actually improve
 * agent performance. Measures success rates before/after learning injection
 * and provides quality metrics for memory curation.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:memory-quality-scorer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LearningOutcome {
  agentRole: string;
  learningId: string;
  qualityScore: number;
  sessionSuccess: boolean;
  taskType: string;
  timestamp: string;
  tokensUsed: number;
  wasInjected: boolean;
}

export interface LearningQualityReport {
  agentRole: string;
  avgQualityWith: number;
  avgQualityWithout: number;
  avgTokensWith: number;
  avgTokensWithout: number;
  learningId: string;
  qualityImpact: number;
  recommendation: "keep" | "demote" | "remove" | "insufficient_data";
  sessionsWithLearning: number;
  sessionsWithoutLearning: number;
  successRateWith: number;
  successRateWithout: number;
  taskType: string;
  totalSessions: number;
}

export interface OverallMemoryQuality {
  avgQualityImpact: number;
  effectiveLearnings: number;
  ineffectiveLearnings: number;
  insufficientData: number;
  overallEffectivenessRate: number;
  totalLearnings: number;
}

// ---------------------------------------------------------------------------
// MemoryQualityScorer
// ---------------------------------------------------------------------------

export class MemoryQualityScorer {
  private readonly outcomes = new Map<string, LearningOutcome[]>();

  /**
   * Record the outcome of a session, including whether learnings were injected.
   */
  recordOutcome(outcome: LearningOutcome): void {
    const key = outcome.learningId;
    const existing = this.outcomes.get(key) ?? [];
    existing.push(outcome);
    this.outcomes.set(key, existing);

    logger.debug(
      {
        learningId: outcome.learningId,
        injected: outcome.wasInjected,
        success: outcome.sessionSuccess,
        quality: outcome.qualityScore,
      },
      "Recorded learning outcome"
    );
  }

  /**
   * Evaluate the quality impact of a specific learning pattern.
   */
  evaluateLearning(learningId: string): LearningQualityReport | null {
    const outcomes = this.outcomes.get(learningId);
    if (!outcomes || outcomes.length === 0) {
      return null;
    }

    const withLearning = outcomes.filter((o) => o.wasInjected);
    const withoutLearning = outcomes.filter((o) => !o.wasInjected);

    const successRateWith =
      withLearning.length > 0
        ? withLearning.filter((o) => o.sessionSuccess).length /
          withLearning.length
        : 0;

    const successRateWithout =
      withoutLearning.length > 0
        ? withoutLearning.filter((o) => o.sessionSuccess).length /
          withoutLearning.length
        : 0;

    const avgQualityWith = safeAvg(withLearning.map((o) => o.qualityScore));
    const avgQualityWithout = safeAvg(
      withoutLearning.map((o) => o.qualityScore)
    );
    const avgTokensWith = safeAvg(withLearning.map((o) => o.tokensUsed));
    const avgTokensWithout = safeAvg(withoutLearning.map((o) => o.tokensUsed));

    const qualityImpact = avgQualityWith - avgQualityWithout;

    const first = outcomes[0];
    const recommendation = getRecommendation(
      withLearning.length,
      withoutLearning.length,
      qualityImpact,
      successRateWith,
      successRateWithout
    );

    const report: LearningQualityReport = {
      learningId,
      agentRole: first?.agentRole ?? "",
      taskType: first?.taskType ?? "",
      totalSessions: outcomes.length,
      sessionsWithLearning: withLearning.length,
      sessionsWithoutLearning: withoutLearning.length,
      successRateWith,
      successRateWithout,
      avgQualityWith,
      avgQualityWithout,
      avgTokensWith,
      avgTokensWithout,
      qualityImpact,
      recommendation,
    };

    logger.info(
      {
        learningId,
        qualityImpact: qualityImpact.toFixed(3),
        recommendation,
      },
      "Evaluated learning quality"
    );

    return report;
  }

  /**
   * Evaluate all tracked learnings and return an overall quality report.
   */
  getOverallQuality(): OverallMemoryQuality {
    let effective = 0;
    let ineffective = 0;
    let insufficient = 0;
    const impacts: number[] = [];

    for (const learningId of this.outcomes.keys()) {
      const report = this.evaluateLearning(learningId);
      if (!report) {
        continue;
      }

      switch (report.recommendation) {
        case "keep":
          effective++;
          impacts.push(report.qualityImpact);
          break;
        case "demote":
        case "remove":
          ineffective++;
          impacts.push(report.qualityImpact);
          break;
        case "insufficient_data":
          insufficient++;
          break;
        default:
          break;
      }
    }

    const total = effective + ineffective + insufficient;
    const evaluated = effective + ineffective;

    return {
      totalLearnings: total,
      effectiveLearnings: effective,
      ineffectiveLearnings: ineffective,
      insufficientData: insufficient,
      avgQualityImpact: safeAvg(impacts),
      overallEffectivenessRate: evaluated > 0 ? effective / evaluated : 0,
    };
  }

  /**
   * Get learnings that should be removed (negative quality impact).
   */
  getLearningsToRemove(): string[] {
    const toRemove: string[] = [];

    for (const learningId of this.outcomes.keys()) {
      const report = this.evaluateLearning(learningId);
      if (report?.recommendation === "remove") {
        toRemove.push(learningId);
      }
    }

    return toRemove;
  }

  /**
   * Get learnings that should be demoted (marginal or unclear impact).
   */
  getLearningsToDemote(): string[] {
    const toDemote: string[] = [];

    for (const learningId of this.outcomes.keys()) {
      const report = this.evaluateLearning(learningId);
      if (report?.recommendation === "demote") {
        toDemote.push(learningId);
      }
    }

    return toDemote;
  }

  /**
   * Clear all recorded outcomes (e.g., after a major agent update).
   */
  reset(): void {
    this.outcomes.clear();
    logger.info("Memory quality scorer reset");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIN_SAMPLES_FOR_EVALUATION = 3;
const POSITIVE_THRESHOLD = 0.05;
const NEGATIVE_THRESHOLD = -0.05;

function safeAvg(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function getRecommendation(
  withCount: number,
  withoutCount: number,
  qualityImpact: number,
  successRateWith: number,
  successRateWithout: number
): LearningQualityReport["recommendation"] {
  if (
    withCount < MIN_SAMPLES_FOR_EVALUATION ||
    withoutCount < MIN_SAMPLES_FOR_EVALUATION
  ) {
    return "insufficient_data";
  }

  const successImpact = successRateWith - successRateWithout;

  // Clearly beneficial: both quality and success improve
  if (qualityImpact > POSITIVE_THRESHOLD && successImpact >= 0) {
    return "keep";
  }

  // Clearly harmful: quality drops significantly
  if (qualityImpact < NEGATIVE_THRESHOLD && successImpact <= 0) {
    return "remove";
  }

  // Marginal or mixed: demote for further observation
  if (
    Math.abs(qualityImpact) <= POSITIVE_THRESHOLD ||
    (qualityImpact > 0 && successImpact < 0) ||
    (qualityImpact < 0 && successImpact > 0)
  ) {
    return "demote";
  }

  return "keep";
}
