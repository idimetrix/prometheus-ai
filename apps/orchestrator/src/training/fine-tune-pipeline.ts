/**
 * GAP-105: Fine-Tuning Pipeline
 *
 * Collects high-quality (task, response) pairs, formats for fine-tuning
 * API, submits fine-tuning jobs, and evaluates fine-tuned models.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:fine-tune-pipeline");

export interface TrainingPair {
  assistantResponse: string;
  id: string;
  qualityScore: number;
  systemPrompt: string;
  taskType: string;
  timestamp: number;
  userMessage: string;
}

export interface FineTuneJob {
  baseModel: string;
  completedAt?: number;
  createdAt: number;
  id: string;
  metrics?: { trainingLoss: number; validationLoss: number };
  resultModel?: string;
  status: "preparing" | "training" | "completed" | "failed";
  trainingPairCount: number;
}

export class FineTunePipeline {
  private readonly pairs: TrainingPair[] = [];
  private readonly jobs: FineTuneJob[] = [];
  private readonly qualityThreshold: number;

  constructor(qualityThreshold = 0.85) {
    this.qualityThreshold = qualityThreshold;
  }

  collectPair(pair: Omit<TrainingPair, "id" | "timestamp">): void {
    if (pair.qualityScore < this.qualityThreshold) {
      logger.debug(
        { qualityScore: pair.qualityScore },
        "Pair below quality threshold, skipping"
      );
      return;
    }

    this.pairs.push({
      ...pair,
      id: `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    });

    logger.debug(
      { totalPairs: this.pairs.length, taskType: pair.taskType },
      "Training pair collected"
    );
  }

  formatForOpenAI(): Array<{
    messages: Array<{ role: string; content: string }>;
  }> {
    return this.pairs.map((p) => ({
      messages: [
        { role: "system", content: p.systemPrompt },
        { role: "user", content: p.userMessage },
        { role: "assistant", content: p.assistantResponse },
      ],
    }));
  }

  formatAsJSONL(): string {
    return this.formatForOpenAI()
      .map((entry) => JSON.stringify(entry))
      .join("\n");
  }

  submitJob(baseModel: string): FineTuneJob {
    const job: FineTuneJob = {
      id: `ft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      baseModel,
      status: "preparing",
      trainingPairCount: this.pairs.length,
      createdAt: Date.now(),
    };

    this.jobs.push(job);
    logger.info(
      { jobId: job.id, baseModel, pairCount: this.pairs.length },
      "Fine-tuning job submitted"
    );

    return job;
  }

  evaluateModel(
    jobId: string,
    evalResults: { score: number; baseline: number }
  ): {
    improvement: number;
    worthDeploying: boolean;
  } {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = "completed";
      job.completedAt = Date.now();
    }

    const improvement = evalResults.score - evalResults.baseline;
    const worthDeploying = improvement > 0.05;

    logger.info(
      { jobId, improvement: improvement.toFixed(3), worthDeploying },
      "Fine-tuned model evaluated"
    );

    return { improvement, worthDeploying };
  }

  getStats(): { totalPairs: number; totalJobs: number; avgQuality: number } {
    const avgQuality =
      this.pairs.length > 0
        ? this.pairs.reduce((s, p) => s + p.qualityScore, 0) / this.pairs.length
        : 0;

    return {
      totalPairs: this.pairs.length,
      totalJobs: this.jobs.length,
      avgQuality,
    };
  }
}
