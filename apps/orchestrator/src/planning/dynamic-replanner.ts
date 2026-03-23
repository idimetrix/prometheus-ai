import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:dynamic-replanner");

/** Metrics collected during task execution */
export interface ExecutionMetrics {
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Total elapsed time in ms */
  elapsedMs: number;
  /** Whether the task is currently blocked */
  isBlocked: boolean;
  /** Confidence score from the last execution (0-1) */
  lastConfidence: number;
  /** Number of retries attempted */
  retriesUsed: number;
}

/** A task in the current plan */
export interface TaskPlanItem {
  agentRole: string;
  dependencies: string[];
  description: string;
  estimatedTokens: number;
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  title: string;
}

/** The overall task plan */
export interface TaskPlan {
  items: TaskPlanItem[];
  sessionId: string;
  version: number;
}

/** Context about why replanning is needed */
export interface FailureContext {
  /** Partial results from completed tasks */
  completedTaskIds: string[];
  /** Error messages from failures */
  errors: string[];
  /** IDs of tasks that failed */
  failedTaskIds: string[];
  /** Files that are currently modified */
  modifiedFiles: string[];
}

/** Event emitted when a plan is updated */
export interface PlanUpdateEvent {
  addedTasks: string[];
  modifiedTasks: string[];
  newVersion: number;
  previousVersion: number;
  reason: string;
  removedTasks: string[];
  sessionId: string;
}

/** Thresholds for triggering a replan */
const REPLAN_THRESHOLDS = {
  /** Number of consecutive failures before replanning */
  maxConsecutiveFailures: 3,
  /** Minimum confidence below which replanning is triggered */
  minConfidence: 0.3,
  /** Maximum elapsed time (ms) before considering a task stuck (10 min) */
  maxElapsedMs: 600_000,
};

/**
 * DynamicReplanner monitors execution metrics and triggers
 * re-planning when roadblocks are detected.
 *
 * Roadblock detection criteria:
 * - 3+ consecutive failures on a task
 * - Confidence drops below 0.3
 * - Task exceeds maximum elapsed time
 *
 * When triggered, the replanner invokes the MCTS planner to
 * generate a revised plan and emits plan_update events.
 */
export class DynamicReplanner {
  private readonly onPlanUpdate?: (event: PlanUpdateEvent) => void;

  constructor(opts?: { onPlanUpdate?: (event: PlanUpdateEvent) => void }) {
    this.onPlanUpdate = opts?.onPlanUpdate;
  }

  /**
   * Determine if replanning is needed based on current execution metrics.
   */
  shouldReplan(metrics: ExecutionMetrics): boolean {
    if (
      metrics.consecutiveFailures >= REPLAN_THRESHOLDS.maxConsecutiveFailures
    ) {
      logger.warn(
        { consecutiveFailures: metrics.consecutiveFailures },
        "Replan triggered: too many consecutive failures"
      );
      return true;
    }

    if (metrics.lastConfidence < REPLAN_THRESHOLDS.minConfidence) {
      logger.warn(
        { confidence: metrics.lastConfidence },
        "Replan triggered: confidence below threshold"
      );
      return true;
    }

    if (metrics.elapsedMs > REPLAN_THRESHOLDS.maxElapsedMs) {
      logger.warn(
        { elapsedMs: metrics.elapsedMs },
        "Replan triggered: task stuck too long"
      );
      return true;
    }

    if (metrics.isBlocked) {
      logger.warn("Replan triggered: task is blocked");
      return true;
    }

    return false;
  }

  /**
   * Generate a revised plan given the current plan state and failure context.
   *
   * In a full implementation this invokes the MCTS planner; here it
   * restructures the failed tasks with fallback strategies.
   */
  replan(currentPlan: TaskPlan, failureContext: FailureContext): TaskPlan {
    logger.info(
      {
        sessionId: currentPlan.sessionId,
        version: currentPlan.version,
        failedTasks: failureContext.failedTaskIds,
      },
      "Replanning triggered"
    );

    const failedSet = new Set(failureContext.failedTaskIds);
    const completedSet = new Set(failureContext.completedTaskIds);

    // Keep completed tasks, restructure failed ones
    const keptItems: TaskPlanItem[] = [];
    const addedTasks: string[] = [];
    const removedTasks: string[] = [];
    const modifiedTasks: string[] = [];

    for (const item of currentPlan.items) {
      if (completedSet.has(item.id)) {
        // Keep completed items as-is
        keptItems.push(item);
      } else if (failedSet.has(item.id)) {
        // Replace failed tasks with simplified versions
        const simplifiedId = `${item.id}-retry`;
        const simplified: TaskPlanItem = {
          id: simplifiedId,
          title: `[Retry] ${item.title}`,
          description: `Simplified retry of: ${item.description}. Previous errors: ${failureContext.errors.join("; ")}`,
          agentRole: item.agentRole,
          dependencies: item.dependencies.filter((dep) => !failedSet.has(dep)),
          status: "pending",
          estimatedTokens: Math.ceil(item.estimatedTokens * 1.5),
        };

        keptItems.push(simplified);
        addedTasks.push(simplifiedId);
        removedTasks.push(item.id);
      } else {
        // Pending tasks may need dependency updates
        const updatedDeps = item.dependencies.map((dep) =>
          failedSet.has(dep) ? `${dep}-retry` : dep
        );
        if (updatedDeps.some((d, i) => d !== item.dependencies[i])) {
          modifiedTasks.push(item.id);
        }
        keptItems.push({
          ...item,
          dependencies: updatedDeps,
        });
      }
    }

    const newPlan: TaskPlan = {
      sessionId: currentPlan.sessionId,
      version: currentPlan.version + 1,
      items: keptItems,
    };

    // Emit plan update event
    const updateEvent: PlanUpdateEvent = {
      sessionId: currentPlan.sessionId,
      previousVersion: currentPlan.version,
      newVersion: newPlan.version,
      reason: `Replanned due to failures in tasks: ${failureContext.failedTaskIds.join(", ")}`,
      addedTasks,
      removedTasks,
      modifiedTasks,
    };

    this.onPlanUpdate?.(updateEvent);

    logger.info(
      {
        sessionId: newPlan.sessionId,
        version: newPlan.version,
        added: addedTasks.length,
        removed: removedTasks.length,
        modified: modifiedTasks.length,
      },
      "Replanning complete"
    );

    return newPlan;
  }
}
