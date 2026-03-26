/**
 * Sprint Velocity Predictor
 *
 * Predicts sprint velocity based on historical data, team composition,
 * complexity factors, and tech debt metrics.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:velocity-predictor");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FactorImpact = "positive" | "negative" | "neutral";

export interface VelocityFactor {
  impact: FactorImpact;
  name: string;
  weight: number;
}

export interface VelocityPrediction {
  confidence: number;
  factors: VelocityFactor[];
  historicalAverage: number;
  predictedPoints: number;
  recommendation: string;
}

export interface SprintHistory {
  completedPoints: number;
  endDate: Date;
  plannedPoints: number;
  startDate: Date;
  teamSize: number;
}

export interface TeamContext {
  /** Average experience level 1-10 */
  avgExperience: number;
  /** Number of new members this sprint */
  newMembersCount: number;
  /** Current team size */
  teamSize: number;
}

export interface ProjectMetrics {
  /** Average code review turnaround in hours */
  avgReviewTurnaroundHours: number;
  /** Open blocker count */
  blockerCount: number;
  /** Percentage of sprint capacity used for bug fixes */
  bugFixRatio: number;
  /** Number of external dependencies or integrations */
  externalDependencies: number;
  /** Planned story points for the sprint */
  plannedPoints: number;
  /** Tech debt score 0-100 (higher = more debt) */
  techDebtScore: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIDENCE = 0.7;
const MIN_HISTORY_FOR_HIGH_CONFIDENCE = 5;
const HIGH_TECH_DEBT_THRESHOLD = 60;
const HIGH_BUG_FIX_RATIO = 0.3;
const SLOW_REVIEW_HOURS = 12;
const NEW_MEMBER_VELOCITY_PENALTY = 0.15;
const BLOCKER_VELOCITY_PENALTY = 0.08;
const EXPERIENCE_BONUS_THRESHOLD = 7;

// ---------------------------------------------------------------------------
// Prediction helpers
// ---------------------------------------------------------------------------

function computeHistoricalAverage(history: SprintHistory[]): number {
  if (history.length === 0) {
    return 0;
  }
  const total = history.reduce((sum, s) => sum + s.completedPoints, 0);
  return total / history.length;
}

function computeHistoricalVariance(
  history: SprintHistory[],
  average: number
): number {
  if (history.length < 2) {
    return 0;
  }
  const squaredDiffs = history.map((s) => (s.completedPoints - average) ** 2);
  return squaredDiffs.reduce((sum, d) => sum + d, 0) / (history.length - 1);
}

function computeCompletionRate(history: SprintHistory[]): number {
  if (history.length === 0) {
    return 0.8;
  }
  const rates = history.map((s) =>
    s.plannedPoints > 0 ? s.completedPoints / s.plannedPoints : 1
  );
  return rates.reduce((sum, r) => sum + r, 0) / rates.length;
}

function computeBaseConfidence(history: SprintHistory[]): number {
  if (history.length === 0) {
    return 0.3;
  }
  if (history.length < MIN_HISTORY_FOR_HIGH_CONFIDENCE) {
    return (
      DEFAULT_CONFIDENCE * (history.length / MIN_HISTORY_FOR_HIGH_CONFIDENCE)
    );
  }

  const avg = computeHistoricalAverage(history);
  const variance = computeHistoricalVariance(history, avg);
  const coeffOfVariation = avg > 0 ? Math.sqrt(variance) / avg : 1;

  // Lower variance = higher confidence
  return Math.min(0.95, DEFAULT_CONFIDENCE + (1 - coeffOfVariation) * 0.25);
}

function analyzeTeamFactors(
  team: TeamContext,
  history: SprintHistory[]
): VelocityFactor[] {
  const factors: VelocityFactor[] = [];

  // Team size changes
  const avgHistoricalSize =
    history.length > 0
      ? history.reduce((sum, s) => sum + s.teamSize, 0) / history.length
      : team.teamSize;

  if (team.teamSize > avgHistoricalSize * 1.2) {
    factors.push({
      name: "team_size_increase",
      impact: "positive",
      weight: 0.1,
    });
  } else if (team.teamSize < avgHistoricalSize * 0.8) {
    factors.push({
      name: "team_size_decrease",
      impact: "negative",
      weight: 0.15,
    });
  }

  // New members impact
  if (team.newMembersCount > 0) {
    factors.push({
      name: "new_team_members",
      impact: "negative",
      weight: Math.min(team.newMembersCount * NEW_MEMBER_VELOCITY_PENALTY, 0.4),
    });
  }

  // Experience level
  if (team.avgExperience >= EXPERIENCE_BONUS_THRESHOLD) {
    factors.push({
      name: "high_experience",
      impact: "positive",
      weight: 0.08,
    });
  } else if (team.avgExperience < 4) {
    factors.push({
      name: "low_experience",
      impact: "negative",
      weight: 0.1,
    });
  }

  return factors;
}

function analyzeProjectFactors(metrics: ProjectMetrics): VelocityFactor[] {
  const factors: VelocityFactor[] = [];

  // Tech debt impact
  if (metrics.techDebtScore > HIGH_TECH_DEBT_THRESHOLD) {
    factors.push({
      name: "high_tech_debt",
      impact: "negative",
      weight: 0.12,
    });
  } else if (metrics.techDebtScore < 20) {
    factors.push({
      name: "low_tech_debt",
      impact: "positive",
      weight: 0.05,
    });
  }

  // Bug fix ratio
  if (metrics.bugFixRatio > HIGH_BUG_FIX_RATIO) {
    factors.push({
      name: "high_bug_fix_load",
      impact: "negative",
      weight: metrics.bugFixRatio * 0.3,
    });
  }

  // Blockers
  if (metrics.blockerCount > 0) {
    factors.push({
      name: "active_blockers",
      impact: "negative",
      weight: Math.min(metrics.blockerCount * BLOCKER_VELOCITY_PENALTY, 0.3),
    });
  }

  // Code review turnaround
  if (metrics.avgReviewTurnaroundHours > SLOW_REVIEW_HOURS) {
    factors.push({
      name: "slow_code_reviews",
      impact: "negative",
      weight: 0.08,
    });
  } else if (metrics.avgReviewTurnaroundHours < 4) {
    factors.push({
      name: "fast_code_reviews",
      impact: "positive",
      weight: 0.05,
    });
  }

  // External dependencies
  if (metrics.externalDependencies > 3) {
    factors.push({
      name: "external_dependencies",
      impact: "negative",
      weight: 0.06,
    });
  }

  return factors;
}

function computeVelocityMultiplier(factors: VelocityFactor[]): number {
  let multiplier = 1.0;

  for (const factor of factors) {
    if (factor.impact === "positive") {
      multiplier += factor.weight;
    } else if (factor.impact === "negative") {
      multiplier -= factor.weight;
    }
  }

  // Clamp to reasonable range
  return Math.max(0.3, Math.min(1.5, multiplier));
}

function generateRecommendation(
  predictedPoints: number,
  plannedPoints: number,
  factors: VelocityFactor[]
): string {
  const negativeFacts = factors.filter((f) => f.impact === "negative");
  const positiveFacts = factors.filter((f) => f.impact === "positive");

  if (predictedPoints >= plannedPoints * 0.95) {
    if (positiveFacts.length > 0) {
      return `Sprint plan looks achievable. Positive factors: ${positiveFacts.map((f) => f.name.replaceAll("_", " ")).join(", ")}. Consider taking on stretch goals.`;
    }
    return "Sprint plan is achievable based on historical velocity. Maintain current pace.";
  }

  if (predictedPoints >= plannedPoints * 0.8) {
    const topNegative = negativeFacts
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((f) => f.name.replaceAll("_", " "));
    return `Sprint may be slightly overcommitted. Key risks: ${topNegative.join(", ")}. Consider descoping ${Math.ceil(plannedPoints - predictedPoints)} points.`;
  }

  const topNegative = negativeFacts
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((f) => f.name.replaceAll("_", " "));
  return `Sprint is significantly overcommitted (predicted ${predictedPoints} vs planned ${plannedPoints}). Address: ${topNegative.join(", ")}. Recommend reducing scope by ${Math.ceil(plannedPoints - predictedPoints)} points.`;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class VelocityPredictor {
  /**
   * Predict sprint velocity based on historical data and current context.
   */
  predict(
    projectId: string,
    sprintDays: number,
    history: SprintHistory[] = [],
    team: TeamContext = { teamSize: 5, newMembersCount: 0, avgExperience: 6 },
    metrics: ProjectMetrics = {
      techDebtScore: 30,
      bugFixRatio: 0.15,
      blockerCount: 0,
      avgReviewTurnaroundHours: 6,
      externalDependencies: 1,
      plannedPoints: 40,
    }
  ): Promise<VelocityPrediction> {
    logger.info(
      {
        projectId,
        sprintDays,
        historyLength: history.length,
        teamSize: team.teamSize,
      },
      "Starting velocity prediction"
    );

    const historicalAverage = computeHistoricalAverage(history);
    const completionRate = computeCompletionRate(history);

    // Analyze factors
    const teamFactors = analyzeTeamFactors(team, history);
    const projectFactors = analyzeProjectFactors(metrics);
    const allFactors = [...teamFactors, ...projectFactors];

    // Compute velocity multiplier from factors
    const multiplier = computeVelocityMultiplier(allFactors);

    // Scale for sprint duration (normalize to 10-day sprints)
    const durationScale = sprintDays / 10;

    // Calculate predicted points
    let predictedPoints: number;
    if (history.length > 0) {
      predictedPoints = Math.round(
        historicalAverage * multiplier * durationScale
      );
    } else {
      // No history -- estimate from planned points and completion rate
      predictedPoints = Math.round(
        metrics.plannedPoints * completionRate * multiplier
      );
    }

    // Ensure non-negative
    predictedPoints = Math.max(0, predictedPoints);

    // Compute confidence
    let confidence = computeBaseConfidence(history);

    // Adjust confidence based on factor count
    const negativeWeight = allFactors
      .filter((f) => f.impact === "negative")
      .reduce((sum, f) => sum + f.weight, 0);

    confidence = Math.max(0.1, confidence - negativeWeight * 0.3);

    // Generate recommendation
    const recommendation = generateRecommendation(
      predictedPoints,
      metrics.plannedPoints,
      allFactors
    );

    logger.info(
      {
        projectId,
        predictedPoints,
        confidence: confidence.toFixed(2),
        historicalAverage: historicalAverage.toFixed(1),
        factorCount: allFactors.length,
      },
      "Velocity prediction complete"
    );

    return Promise.resolve({
      predictedPoints,
      confidence: Math.round(confidence * 100) / 100,
      historicalAverage: Math.round(historicalAverage * 10) / 10,
      factors: allFactors,
      recommendation,
    });
  }
}
