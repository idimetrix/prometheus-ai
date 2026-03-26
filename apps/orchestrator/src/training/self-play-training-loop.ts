/**
 * Self-Play Training Loop (MOON-048)
 *
 * Generates training data by having agents compete or collaborate.
 * Produces interaction pairs, evaluates quality, and runs multi-epoch
 * training loops with progressive improvement tracking.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:training:self-play-loop");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingPairOptions {
  roles: [string, string];
  task: string;
}

export interface TrainingPairResult {
  bestOutput: string;
  improvementAreas: string[];
  interactions: Array<{
    action: string;
    output: string;
    quality: number;
    role: string;
  }>;
}

export interface TrainingEpochOptions {
  epochs: number;
  evaluator: "self" | "human" | "benchmark";
  taskSet: string[];
}

export interface EpochResult {
  avgScore: number;
  bestTask: string;
  epoch: number;
  improvement: number;
  worstTask: string;
}

export interface TrainingLoopResult {
  epochResults: EpochResult[];
  overallImprovement: number;
  recommendations: string[];
}

interface TaskScore {
  attempts: number;
  bestScore: number;
  task: string;
  totalScore: number;
}

// ---------------------------------------------------------------------------
// SelfPlayTrainingLoop
// ---------------------------------------------------------------------------

export class SelfPlayTrainingLoop {
  private readonly taskHistory = new Map<string, TaskScore>();

  /**
   * Generate a training interaction pair for a given task.
   * Two roles collaborate or compete on the same task, and
   * the best output is selected.
   */
  generateTrainingPair(options: TrainingPairOptions): TrainingPairResult {
    const { task, roles } = options;
    const [roleA, roleB] = roles;

    logger.info({ task, roleA, roleB }, "Generating self-play training pair");

    const interactions: TrainingPairResult["interactions"] = [];

    // Phase 1: First role produces initial output
    const initialOutput = this.simulateAgentAction(roleA, task);
    interactions.push({
      role: roleA,
      action: "initial_attempt",
      output: initialOutput.output,
      quality: initialOutput.quality,
    });

    // Phase 2: Second role reviews and improves
    const review = this.simulateReview(roleB, initialOutput.output, task);
    interactions.push({
      role: roleB,
      action: "review",
      output: review.output,
      quality: review.quality,
    });

    // Phase 3: First role incorporates feedback
    const revision = this.simulateRevision(
      roleA,
      initialOutput.output,
      review.output,
      task
    );
    interactions.push({
      role: roleA,
      action: "revision",
      output: revision.output,
      quality: revision.quality,
    });

    // Phase 4: Second role does final evaluation
    const evaluation = this.simulateEvaluation(roleB, revision.output, task);
    interactions.push({
      role: roleB,
      action: "evaluation",
      output: evaluation.output,
      quality: evaluation.quality,
    });

    // Select best output
    const bestInteraction = interactions.reduce((best, current) =>
      current.quality > best.quality ? current : best
    );

    // Identify improvement areas
    const improvementAreas = this.identifyImprovementAreas(interactions);

    // Track task history
    this.updateTaskHistory(task, bestInteraction.quality);

    logger.info(
      {
        task,
        interactionCount: interactions.length,
        bestQuality: bestInteraction.quality,
        improvementAreas: improvementAreas.length,
      },
      "Training pair generated"
    );

    return {
      interactions,
      bestOutput: bestInteraction.output,
      improvementAreas,
    };
  }

  /**
   * Run multiple training epochs over a set of tasks.
   * Each epoch generates training pairs for all tasks and tracks
   * progressive improvement.
   */
  async runTrainingEpoch(
    options: TrainingEpochOptions
  ): Promise<TrainingLoopResult> {
    const { taskSet, epochs, evaluator } = options;

    logger.info(
      { taskCount: taskSet.length, epochs, evaluator },
      "Starting self-play training epochs"
    );

    const epochResults: EpochResult[] = [];
    let previousAvg = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const taskScores: Array<{ score: number; task: string }> = [];

      for (const task of taskSet) {
        const pair = await this.generateTrainingPair({
          task,
          roles: ["coder", "reviewer"],
        });

        // Score based on evaluator type
        const score = this.evaluateOutput(pair.bestOutput, evaluator, task);
        taskScores.push({ task, score });
      }

      const avgScore =
        taskScores.length > 0
          ? taskScores.reduce((sum, t) => sum + t.score, 0) / taskScores.length
          : 0;

      const improvement = epoch > 0 ? avgScore - previousAvg : 0;

      const sorted = [...taskScores].sort((a, b) => b.score - a.score);
      const bestTask = sorted[0]?.task ?? "none";
      const worstTask = sorted.at(-1)?.task ?? "none";

      epochResults.push({
        epoch: epoch + 1,
        avgScore: Math.round(avgScore * 100) / 100,
        improvement: Math.round(improvement * 100) / 100,
        bestTask,
        worstTask,
      });

      previousAvg = avgScore;

      logger.info(
        {
          epoch: epoch + 1,
          avgScore: avgScore.toFixed(3),
          improvement: improvement.toFixed(3),
          bestTask,
          worstTask,
        },
        "Epoch complete"
      );
    }

    // Calculate overall improvement
    const firstAvg = epochResults[0]?.avgScore ?? 0;
    const lastAvg = epochResults.at(-1)?.avgScore ?? 0;
    const overallImprovement = Math.round((lastAvg - firstAvg) * 100) / 100;

    // Generate recommendations
    const recommendations = this.generateRecommendations(epochResults, taskSet);

    logger.info(
      {
        epochs: epochResults.length,
        overallImprovement,
        recommendations: recommendations.length,
      },
      "Training loop complete"
    );

    return { epochResults, overallImprovement, recommendations };
  }

  /**
   * Get historical task scores.
   */
  getTaskHistory(): Map<string, TaskScore> {
    return new Map(this.taskHistory);
  }

  // -----------------------------------------------------------------------
  // Internal simulation helpers
  // -----------------------------------------------------------------------

  private simulateAgentAction(
    role: string,
    task: string
  ): { output: string; quality: number } {
    // In production, this would invoke actual agent execution
    const baseQuality = 0.5 + Math.random() * 0.3;
    const history = this.taskHistory.get(task);
    const learningBonus = history ? Math.min(0.15, history.attempts * 0.02) : 0;
    const quality = Math.min(1.0, baseQuality + learningBonus);

    return {
      output: `[${role}] Initial solution for: ${task} (quality: ${quality.toFixed(2)})`,
      quality,
    };
  }

  private simulateReview(
    role: string,
    _priorOutput: string,
    task: string
  ): { output: string; quality: number } {
    const baseQuality = 0.6 + Math.random() * 0.25;
    return {
      output: `[${role}] Review of output for: ${task} — identified ${Math.floor(Math.random() * 5) + 1} issues`,
      quality: baseQuality,
    };
  }

  private simulateRevision(
    role: string,
    _originalOutput: string,
    _reviewFeedback: string,
    task: string
  ): { output: string; quality: number } {
    // Revisions should generally improve on the original
    const baseQuality = 0.65 + Math.random() * 0.25;
    return {
      output: `[${role}] Revised solution for: ${task} incorporating feedback`,
      quality: baseQuality,
    };
  }

  private simulateEvaluation(
    role: string,
    _finalOutput: string,
    task: string
  ): { output: string; quality: number } {
    const baseQuality = 0.55 + Math.random() * 0.3;
    return {
      output: `[${role}] Final evaluation for: ${task}`,
      quality: baseQuality,
    };
  }

  private evaluateOutput(
    _output: string,
    evaluator: "self" | "human" | "benchmark",
    _task: string
  ): number {
    // In production: run actual evaluation based on evaluator type
    switch (evaluator) {
      case "benchmark": {
        return 0.5 + Math.random() * 0.4; // benchmark-based scoring
      }
      case "human": {
        return 0.6 + Math.random() * 0.3; // human evaluation simulation
      }
      case "self": {
        return 0.45 + Math.random() * 0.45; // self-evaluation
      }
      default: {
        return 0.5;
      }
    }
  }

  private identifyImprovementAreas(
    interactions: TrainingPairResult["interactions"]
  ): string[] {
    const areas: string[] = [];

    // Find interactions with low quality
    const lowQuality = interactions.filter((i) => i.quality < 0.6);
    if (lowQuality.length > 0) {
      areas.push(
        `Low quality in ${lowQuality.length}/${interactions.length} interactions — improve ${lowQuality.map((i) => i.action).join(", ")} phases`
      );
    }

    // Check for quality regression between initial and revision
    const initial = interactions.find((i) => i.action === "initial_attempt");
    const revision = interactions.find((i) => i.action === "revision");
    if (initial && revision && revision.quality < initial.quality) {
      areas.push(
        "Revision decreased quality — review feedback incorporation strategy"
      );
    }

    // Check review effectiveness
    const review = interactions.find((i) => i.action === "review");
    if (review && review.quality < 0.5) {
      areas.push("Review quality too low — improve review criteria and depth");
    }

    if (areas.length === 0) {
      areas.push("All interactions met quality threshold");
    }

    return areas;
  }

  private updateTaskHistory(task: string, score: number): void {
    const existing = this.taskHistory.get(task) ?? {
      task,
      totalScore: 0,
      attempts: 0,
      bestScore: 0,
    };

    existing.totalScore += score;
    existing.attempts += 1;
    existing.bestScore = Math.max(existing.bestScore, score);
    this.taskHistory.set(task, existing);
  }

  private generateRecommendations(
    epochResults: EpochResult[],
    taskSet: string[]
  ): string[] {
    const recommendations: string[] = [];

    // Check for stagnation
    if (epochResults.length >= 3) {
      const lastThree = epochResults.slice(-3);
      const improvements = lastThree.map((e) => e.improvement);
      const allStagnant = improvements.every((imp) => Math.abs(imp) < 0.01);
      if (allStagnant) {
        recommendations.push(
          "Training has stagnated — consider diversifying task set or adjusting agent configurations"
        );
      }
    }

    // Check for consistently weak tasks
    for (const task of taskSet) {
      const history = this.taskHistory.get(task);
      if (history && history.attempts >= 3) {
        const avgScore = history.totalScore / history.attempts;
        if (avgScore < 0.5) {
          recommendations.push(
            `Task "${task}" consistently scores below 50% — break into subtasks or provide more specific guidance`
          );
        }
      }
    }

    // Overall improvement trend
    if (epochResults.length >= 2) {
      const first = epochResults[0]?.avgScore ?? 0;
      const last = epochResults.at(-1)?.avgScore ?? 0;
      if (last > first) {
        recommendations.push(
          `Positive learning trend detected (${first.toFixed(2)} -> ${last.toFixed(2)}) — continue training`
        );
      } else {
        recommendations.push(
          "No improvement detected across epochs — revise training strategy"
        );
      }
    }

    return recommendations;
  }
}
