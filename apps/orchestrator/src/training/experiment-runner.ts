import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:experiment-runner");

export interface Experiment {
  completedTrials: number;
  createdAt: Date;
  id: string;
  name: string;
  results: {
    strategyA: { successes: number; totalQuality: number; trials: number };
    strategyB: { successes: number; totalQuality: number; trials: number };
  };
  status: "active" | "paused" | "completed";
  strategyA: ExperimentStrategy;
  strategyB: ExperimentStrategy;
  targetTrials: number;
}

export interface ExperimentStrategy {
  config: Record<string, unknown>;
  description: string;
  name: string;
}

export interface TrialResult {
  experimentId: string;
  qualityScore: number;
  strategy: "A" | "B";
  success: boolean;
  taskId: string;
}

/**
 * Runs A/B experiments on agent strategies to measure and compare effectiveness.
 */
export class ExperimentRunner {
  private readonly experiments: Map<string, Experiment> = new Map();

  createExperiment(params: {
    name: string;
    strategyA: ExperimentStrategy;
    strategyB: ExperimentStrategy;
    targetTrials?: number;
  }): Experiment {
    const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const experiment: Experiment = {
      id,
      name: params.name,
      strategyA: params.strategyA,
      strategyB: params.strategyB,
      targetTrials: params.targetTrials ?? 100,
      completedTrials: 0,
      status: "active",
      createdAt: new Date(),
      results: {
        strategyA: { trials: 0, successes: 0, totalQuality: 0 },
        strategyB: { trials: 0, successes: 0, totalQuality: 0 },
      },
    };

    this.experiments.set(id, experiment);
    logger.info({ experimentId: id, name: params.name }, "Experiment created");

    return experiment;
  }

  /**
   * Select which strategy to use for a given trial (random assignment).
   */
  selectStrategy(
    experimentId: string
  ): { config: Record<string, unknown>; strategy: "A" | "B" } | null {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== "active") {
      return null;
    }

    const strategy = Math.random() < 0.5 ? "A" : "B";
    const strategyConfig = strategy === "A" ? exp.strategyA : exp.strategyB;

    return { strategy, config: strategyConfig.config };
  }

  /**
   * Record the result of a trial.
   */
  recordTrial(result: TrialResult): void {
    const exp = this.experiments.get(result.experimentId);
    if (!exp) {
      return;
    }

    const bucket =
      result.strategy === "A" ? exp.results.strategyA : exp.results.strategyB;
    bucket.trials++;
    if (result.success) {
      bucket.successes++;
    }
    bucket.totalQuality += result.qualityScore;

    exp.completedTrials++;

    if (exp.completedTrials >= exp.targetTrials) {
      exp.status = "completed";
      logger.info(
        { experimentId: exp.id, name: exp.name },
        "Experiment completed"
      );
    }

    logger.info(
      {
        experimentId: exp.id,
        strategy: result.strategy,
        success: result.success,
      },
      "Trial recorded"
    );
  }

  /**
   * Get experiment results with statistical analysis.
   */
  getResults(experimentId: string): {
    experiment: Experiment;
    recommendation: "A" | "B" | "inconclusive";
    winRate: { A: number; B: number };
    avgQuality: { A: number; B: number };
  } | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      return null;
    }

    const aRate =
      exp.results.strategyA.trials > 0
        ? exp.results.strategyA.successes / exp.results.strategyA.trials
        : 0;
    const bRate =
      exp.results.strategyB.trials > 0
        ? exp.results.strategyB.successes / exp.results.strategyB.trials
        : 0;
    const aQuality =
      exp.results.strategyA.trials > 0
        ? exp.results.strategyA.totalQuality / exp.results.strategyA.trials
        : 0;
    const bQuality =
      exp.results.strategyB.trials > 0
        ? exp.results.strategyB.totalQuality / exp.results.strategyB.trials
        : 0;

    const minTrials = 10;
    let recommendation: "A" | "B" | "inconclusive" = "inconclusive";

    if (
      exp.results.strategyA.trials >= minTrials &&
      exp.results.strategyB.trials >= minTrials
    ) {
      const diff = Math.abs(aRate - bRate);
      if (diff > 0.05) {
        recommendation = aRate > bRate ? "A" : "B";
      }
    }

    return {
      experiment: exp,
      winRate: { A: aRate, B: bRate },
      avgQuality: { A: aQuality, B: bQuality },
      recommendation,
    };
  }

  listExperiments(): Experiment[] {
    return [...this.experiments.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }
}
