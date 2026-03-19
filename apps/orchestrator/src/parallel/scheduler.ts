import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:parallel");

// ---------------------------------------------------------------------------
// Effort weight mapping for CPM (Critical Path Method)
// ---------------------------------------------------------------------------

/** Effort size to numeric weight for CPM calculations. */
const EFFORT_WEIGHTS: Record<string, number> = {
  S: 1,
  M: 2,
  L: 4,
  XL: 8,
};

/** Parse an effort string to its numeric weight. Defaults to M (2) if unknown. */
function effortWeight(effort: string): number {
  return EFFORT_WEIGHTS[effort.toUpperCase()] ?? EFFORT_WEIGHTS.M ?? 2;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulableTask {
  agentRole: string;
  dependencies: string[];
  effort: string;
  id: string;
  title: string;
}

export interface ScheduleResult {
  /** CPM analysis with timing data per task */
  cpmAnalysis: CPMAnalysis;
  criticalPath: string[];
  estimatedDuration: string;
  waves: SchedulableTask[][];
}

/** CPM timing data for a single task. */
export interface TaskTiming {
  /** Earliest finish time */
  ef: number;
  /** Earliest start time */
  es: number;
  /** Total float (slack) — 0 means on the critical path */
  float: number;
  /** Latest finish time */
  lf: number;
  /** Latest start time */
  ls: number;
  taskId: string;
  weight: number;
}

/** Full CPM analysis result. */
export interface CPMAnalysis {
  /** Task IDs on the critical path (zero float) */
  criticalPathIds: string[];
  /** Sum of effort weights along the critical path */
  projectDuration: number;
  /** Per-task timing data */
  taskTimings: TaskTiming[];
}

// ---------------------------------------------------------------------------
// ParallelScheduler
// ---------------------------------------------------------------------------

export class ParallelScheduler {
  schedule(tasks: SchedulableTask[]): ScheduleResult {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const completed = new Set<string>();
    const waves: SchedulableTask[][] = [];

    while (completed.size < tasks.length) {
      const wave = tasks.filter(
        (t) =>
          !completed.has(t.id) && t.dependencies.every((d) => completed.has(d))
      );

      if (wave.length === 0 && completed.size < tasks.length) {
        logger.error("Circular dependency detected in task graph");
        break;
      }

      waves.push(wave);
      for (const task of wave) {
        completed.add(task.id);
      }
    }

    // Compute CPM analysis
    const cpmAnalysis = this.computeCPM(tasks, taskMap);
    const criticalPath = cpmAnalysis.criticalPathIds;

    logger.info(
      {
        totalTasks: tasks.length,
        waves: waves.length,
        maxParallel: Math.max(...waves.map((w) => w.length)),
        projectDuration: cpmAnalysis.projectDuration,
        criticalPathLength: criticalPath.length,
      },
      "Schedule computed with CPM analysis"
    );

    return {
      waves,
      criticalPath,
      estimatedDuration: `${cpmAnalysis.projectDuration} effort units across ${waves.length} waves`,
      cpmAnalysis,
    };
  }

  /**
   * Compute Critical Path Method (CPM) timings for the task graph.
   *
   * Forward pass: compute earliest start (ES) and earliest finish (EF).
   * Backward pass: compute latest start (LS) and latest finish (LF).
   * Float = LS - ES. Tasks with float === 0 are on the critical path.
   */
  private computeCPM(
    tasks: SchedulableTask[],
    taskMap: Map<string, SchedulableTask>
  ): CPMAnalysis {
    const timings = new Map<string, TaskTiming>();

    // Initialize timings
    for (const task of tasks) {
      timings.set(task.id, {
        taskId: task.id,
        weight: effortWeight(task.effort),
        es: 0,
        ef: 0,
        ls: 0,
        lf: 0,
        float: 0,
      });
    }

    // Topological sort
    const sorted = this.topologicalSort(tasks, taskMap);

    // Forward pass — compute ES and EF
    for (const taskId of sorted) {
      const task = taskMap.get(taskId);
      const timing = timings.get(taskId);
      if (!(task && timing)) {
        continue;
      }

      // ES = max(EF of all predecessors)
      let maxPredEF = 0;
      for (const depId of task.dependencies) {
        const depTiming = timings.get(depId);
        if (depTiming && depTiming.ef > maxPredEF) {
          maxPredEF = depTiming.ef;
        }
      }

      timing.es = maxPredEF;
      timing.ef = timing.es + timing.weight;
    }

    // Project duration = max EF across all tasks
    let projectDuration = 0;
    for (const timing of timings.values()) {
      if (timing.ef > projectDuration) {
        projectDuration = timing.ef;
      }
    }

    // Backward pass — compute LF and LS
    // Initialize all LF to project duration
    for (const timing of timings.values()) {
      timing.lf = projectDuration;
      timing.ls = projectDuration - timing.weight;
    }

    // Process in reverse topological order
    const reverseSorted = [...sorted].reverse();
    for (const taskId of reverseSorted) {
      const timing = timings.get(taskId);
      if (!timing) {
        continue;
      }

      // LF = min(LS of all successors)
      // Find all tasks that depend on this one
      let minSuccLS = projectDuration;
      for (const task of tasks) {
        if (task.dependencies.includes(taskId)) {
          const succTiming = timings.get(task.id);
          if (succTiming && succTiming.ls < minSuccLS) {
            minSuccLS = succTiming.ls;
          }
        }
      }

      timing.lf = minSuccLS;
      timing.ls = timing.lf - timing.weight;
      timing.float = timing.ls - timing.es;
    }

    // Critical path: tasks with zero float
    const criticalPathIds = sorted.filter((taskId) => {
      const timing = timings.get(taskId);
      return timing !== undefined && timing.float === 0;
    });

    const taskTimings = Array.from(timings.values());

    logger.debug(
      {
        projectDuration,
        criticalPath: criticalPathIds,
        timings: taskTimings.map((t) => ({
          id: t.taskId,
          es: t.es,
          ef: t.ef,
          float: t.float,
        })),
      },
      "CPM analysis computed"
    );

    return {
      taskTimings,
      criticalPathIds,
      projectDuration,
    };
  }

  /**
   * Topological sort using Kahn's algorithm.
   * Returns task IDs in dependency-respecting order.
   */
  private topologicalSort(
    tasks: SchedulableTask[],
    _taskMap: Map<string, SchedulableTask>
  ): string[] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const task of tasks) {
      inDegree.set(task.id, task.dependencies.length);
      adjacency.set(task.id, []);
    }

    // Build adjacency list (predecessor -> successors)
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        const successors = adjacency.get(depId);
        if (successors) {
          successors.push(task.id);
        }
      }
    }

    // Start with tasks that have no dependencies
    const queue: string[] = [];
    for (const [taskId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      sorted.push(current);

      const successors = adjacency.get(current) ?? [];
      for (const succId of successors) {
        const newDegree = (inDegree.get(succId) ?? 1) - 1;
        inDegree.set(succId, newDegree);
        if (newDegree === 0) {
          queue.push(succId);
        }
      }
    }

    return sorted;
  }
}
