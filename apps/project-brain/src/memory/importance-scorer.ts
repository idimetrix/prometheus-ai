/**
 * Phase 7.12: Memory Importance Scoring.
 *
 * Scores memories at creation time based on:
 * - Recency (0.3 weight)
 * - Frequency (0.2 weight)
 * - Agent confidence (0.25 weight)
 * - Outcome correlation (0.25 weight)
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:importance-scorer");

export interface ScoringInput {
  /** Time since creation in hours */
  ageHours: number;
  /** Agent's confidence in the memory's accuracy (0-1) */
  agentConfidence: number;
  /** Number of times this or similar information was encountered */
  frequency: number;
  /** Did the memory lead to a positive outcome? (0=unknown, 0.5=neutral, 1=positive) */
  outcomeCorrelation: number;
}

const WEIGHTS = {
  recency: 0.3,
  frequency: 0.2,
  confidence: 0.25,
  outcome: 0.25,
} as const;

/**
 * ImportanceScorer assigns importance scores to memories at creation time
 * based on multiple weighted factors.
 */
export class ImportanceScorer {
  /**
   * Calculate the importance score for a memory.
   * Returns a value between 0 and 1.
   */
  score(input: ScoringInput): number {
    const recencyScore = this.calculateRecency(input.ageHours);
    const frequencyScore = this.calculateFrequency(input.frequency);
    const confidenceScore = Math.max(0, Math.min(1, input.agentConfidence));
    const outcomeScore = Math.max(0, Math.min(1, input.outcomeCorrelation));

    const weighted =
      recencyScore * WEIGHTS.recency +
      frequencyScore * WEIGHTS.frequency +
      confidenceScore * WEIGHTS.confidence +
      outcomeScore * WEIGHTS.outcome;

    const finalScore = Math.max(0, Math.min(1, weighted));

    logger.debug(
      {
        recencyScore,
        frequencyScore,
        confidenceScore,
        outcomeScore,
        finalScore,
      },
      "Memory importance scored"
    );

    return finalScore;
  }

  /**
   * Score a newly created memory with default assumptions.
   */
  scoreNew(agentConfidence = 0.5): number {
    return this.score({
      ageHours: 0,
      frequency: 1,
      agentConfidence,
      outcomeCorrelation: 0.5,
    });
  }

  /**
   * Re-score a memory after an outcome is observed.
   */
  rescoreWithOutcome(currentScore: number, outcomePositive: boolean): number {
    const outcomeBoost = outcomePositive ? 0.15 : -0.1;
    return Math.max(0, Math.min(1, currentScore + outcomeBoost));
  }

  /**
   * Recency: exponential decay from 1.0 (just created) to ~0 (old).
   * Half-life of ~48 hours for the recency component.
   */
  private calculateRecency(ageHours: number): number {
    const halfLifeHours = 48;
    return Math.exp((-Math.LN2 * ageHours) / halfLifeHours);
  }

  /**
   * Frequency: logarithmic scaling, caps at ~1.0 around 10 encounters.
   */
  private calculateFrequency(frequency: number): number {
    return Math.min(1, Math.log2(Math.max(1, frequency)) / Math.log2(10));
  }
}
