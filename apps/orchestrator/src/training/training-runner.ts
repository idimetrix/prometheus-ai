/**
 * Training Runner — Wires the SelfPlayTrainer into a runnable pipeline.
 *
 * Loads past successful sessions from the feedback loop, generates training
 * tasks from successful patterns, runs agents against training tasks,
 * evaluates results against ground truth, extracts learnings, and stores
 * them back into the feedback loop.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import {
  analyzeTaskOutcome,
  retrieveLearnings,
} from "../self-improvement/feedback-loop";
import { SelfPlayTrainer, type TrainingExample } from "./self-play-trainer";

function getOutcome(
  expected: string,
  qualityScore: number
): "success" | "partial" | "failure" {
  if (expected === "success") {
    return "success";
  }
  if (qualityScore > 0.5) {
    return "partial";
  }
  return "failure";
}

import { SharedLearningStore } from "./transfer-learning";

const logger = createLogger("orchestrator:training-runner");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingRunConfig {
  /** Agent roles to train */
  agentRoles: string[];
  /** Maximum number of training rounds per role */
  maxRoundsPerRole?: number;
  /** Minimum quality score for a session to be used as training data */
  minQualityScore?: number;
  /** Organization ID for loading learnings */
  orgId: string;
  /** Project ID for loading learnings */
  projectId: string;
  /** Task types to focus on (e.g., "bugfix", "feature", "testing") */
  taskTypes?: string[];
}

export interface TrainingRunResult {
  completedAt: string;
  duration: number;
  examplesRecorded: number;
  patternsDiscovered: number;
  recommendations: Array<{
    action: string;
    agentRole: string;
    confidence: number;
  }>;
  startedAt: string;
  treesBuilt: number;
}

interface TrainingTask {
  agentRole: string;
  context: string;
  description: string;
  expectedOutcome: string;
  id: string;
  taskType: string;
}

// ---------------------------------------------------------------------------
// TrainingRunner
// ---------------------------------------------------------------------------

export class TrainingRunner {
  private readonly trainer: SelfPlayTrainer;
  private readonly learningStore: SharedLearningStore;
  private running = false;

  constructor(trainer?: SelfPlayTrainer, learningStore?: SharedLearningStore) {
    this.trainer = trainer ?? new SelfPlayTrainer();
    this.learningStore = learningStore ?? new SharedLearningStore();
  }

  /**
   * Whether the training runner is currently executing a training run.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Execute a full self-play training run:
   * 1. Load past successful sessions from feedback loop
   * 2. Generate training tasks from successful patterns
   * 3. Simulate agent execution against training tasks
   * 4. Evaluate results and record training examples
   * 5. Mine patterns and build decision trees
   * 6. Extract recommendations and store learnings
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: training pipeline has multiple sequential phases
  runSelfPlay(config: TrainingRunConfig): TrainingRunResult {
    if (this.running) {
      throw new Error("Training run already in progress");
    }

    this.running = true;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    logger.info(
      {
        projectId: config.projectId,
        agentRoles: config.agentRoles,
        taskTypes: config.taskTypes,
      },
      "Starting self-play training run"
    );

    try {
      const maxRounds = config.maxRoundsPerRole ?? 5;
      const minQuality = config.minQualityScore ?? 0.6;
      let examplesRecorded = 0;
      let patternsDiscovered = 0;
      let treesBuilt = 0;
      const recommendations: TrainingRunResult["recommendations"] = [];

      for (const agentRole of config.agentRoles) {
        // Step 1: Load past learnings
        const pastLearnings = retrieveLearnings({
          projectId: config.projectId,
          orgId: config.orgId,
          agentRole,
          minConfidence: minQuality,
          limit: 50,
        });

        logger.info(
          { agentRole, learningsCount: pastLearnings.length },
          "Loaded past learnings for training"
        );

        // Step 2: Generate training tasks from successful patterns
        const taskTypes = config.taskTypes ?? [
          "bugfix",
          "feature",
          "testing",
          "refactoring",
        ];
        const trainingTasks = this.generateTrainingTasks(
          agentRole,
          taskTypes,
          pastLearnings,
          maxRounds
        );

        // Step 3 & 4: Run agents and evaluate results
        for (const task of trainingTasks) {
          const example = this.simulateAndEvaluate(
            task,
            config.projectId,
            pastLearnings
          );

          this.trainer.recordSession(example);
          examplesRecorded++;

          // Step 5: Store learnings in feedback loop
          analyzeTaskOutcome({
            taskId: task.id,
            projectId: config.projectId,
            orgId: config.orgId,
            agentRole: task.agentRole,
            succeeded: example.outcome === "success",
            toolsUsed: example.actions.map((a) => a.tool),
            errorMessages:
              example.outcome === "failure"
                ? ["Simulated training failure"]
                : [],
            filesModified: [],
            durationMs: 0,
            tags: [task.taskType, "self-play-training"],
          });
        }

        // Step 6: Mine patterns and build decision trees
        for (const taskType of taskTypes) {
          const tree = this.trainer.minePatterns(agentRole, taskType);
          if (tree.decisions.length > 0) {
            treesBuilt++;
            patternsDiscovered += tree.decisions.length;

            // Extract recommendations
            const rec = this.trainer.getRecommendation(agentRole, taskType, {});
            if (rec) {
              recommendations.push({
                agentRole,
                action: rec.action,
                confidence: rec.confidence,
              });
            }
          }
        }

        // Transfer insights to the shared learning store
        for (const learning of pastLearnings.filter((l) => l.succeeded)) {
          this.learningStore.recordInsight(
            agentRole,
            "code_conventions",
            learning.detail,
            { taskType: learning.category, projectId: config.projectId }
          );
        }
      }

      const duration = Date.now() - startMs;
      const result: TrainingRunResult = {
        startedAt,
        completedAt: new Date().toISOString(),
        duration,
        examplesRecorded,
        patternsDiscovered,
        treesBuilt,
        recommendations,
      };

      logger.info(
        {
          duration,
          examplesRecorded,
          patternsDiscovered,
          treesBuilt,
          recommendations: recommendations.length,
        },
        "Self-play training run completed"
      );

      return result;
    } finally {
      this.running = false;
    }
  }

  /**
   * Get the underlying trainer's metrics.
   */
  getMetrics() {
    return this.trainer.getMetrics();
  }

  /**
   * Get a recommendation for a given agent role and task type.
   */
  getRecommendation(
    agentRole: string,
    taskType: string,
    context: Record<string, string>
  ) {
    return this.trainer.getRecommendation(agentRole, taskType, context);
  }

  // -----------------------------------------------------------------------
  // Internal Helpers
  // -----------------------------------------------------------------------

  /**
   * Generate synthetic training tasks from past learnings.
   */
  private generateTrainingTasks(
    agentRole: string,
    taskTypes: string[],
    pastLearnings: Array<{
      category: string;
      detail: string;
      succeeded: boolean;
      approach: string;
    }>,
    maxRounds: number
  ): TrainingTask[] {
    const tasks: TrainingTask[] = [];

    for (const taskType of taskTypes) {
      const relevantLearnings = pastLearnings.filter(
        (l) => l.category === taskType || l.category === "tool_usage"
      );

      const roundCount = Math.min(
        maxRounds,
        Math.max(1, relevantLearnings.length)
      );

      for (let i = 0; i < roundCount; i++) {
        const learning =
          relevantLearnings[i % Math.max(1, relevantLearnings.length)];
        tasks.push({
          id: generateId("ttask"),
          agentRole,
          taskType,
          description: learning
            ? `Training task based on learned pattern: ${learning.detail.slice(0, 100)}`
            : `Generic ${taskType} training task for ${agentRole}`,
          context: learning?.approach ?? taskType,
          expectedOutcome: learning?.succeeded ? "success" : "failure",
        });
      }
    }

    return tasks;
  }

  /**
   * Simulate agent execution against a training task and evaluate results.
   * In a full implementation, this would run the actual agent loop.
   * For now, it creates synthetic training examples based on the task
   * and past learnings to seed the decision tree builder.
   */
  private simulateAndEvaluate(
    task: TrainingTask,
    projectId: string,
    pastLearnings: Array<{
      category: string;
      detail: string;
      succeeded: boolean;
      tags: string[];
    }>
  ): Omit<TrainingExample, "id" | "timestamp"> {
    // Derive synthetic actions from past learnings' tool usage
    const tools = new Set<string>();
    for (const learning of pastLearnings) {
      for (const tag of learning.tags) {
        // Tags often include tool names
        if (
          tag.includes("read") ||
          tag.includes("write") ||
          tag.includes("exec") ||
          tag.includes("search") ||
          tag.includes("edit")
        ) {
          tools.add(tag);
        }
      }
    }

    const toolArray = tools.size > 0 ? [...tools] : ["readFile", "writeFile"];
    const actions = toolArray.slice(0, 5).map((tool) => ({
      tool,
      args: {},
      result: task.expectedOutcome === "success" ? "ok" : "error",
    }));

    // Score based on alignment with successful patterns
    const successCount = pastLearnings.filter((l) => l.succeeded).length;
    const totalCount = Math.max(1, pastLearnings.length);
    const qualityScore = successCount / totalCount;

    return {
      projectId,
      agentRole: task.agentRole,
      taskDescription: task.description,
      context: task.context,
      outcome: getOutcome(task.expectedOutcome, qualityScore),
      qualityScore,
      actions,
    };
  }
}
