import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:parallel");

export interface SchedulableTask {
  id: string;
  title: string;
  agentRole: string;
  dependencies: string[];
  effort: string;
}

export interface ScheduleResult {
  waves: SchedulableTask[][];
  criticalPath: string[];
  estimatedDuration: string;
}

export class ParallelScheduler {
  schedule(tasks: SchedulableTask[]): ScheduleResult {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const completed = new Set<string>();
    const waves: SchedulableTask[][] = [];

    while (completed.size < tasks.length) {
      const wave = tasks.filter(
        (t) =>
          !completed.has(t.id) &&
          t.dependencies.every((d) => completed.has(d))
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

    const criticalPath = this.findCriticalPath(tasks, waves);

    logger.info({
      totalTasks: tasks.length,
      waves: waves.length,
      maxParallel: Math.max(...waves.map((w) => w.length)),
    }, "Schedule computed");

    return {
      waves,
      criticalPath,
      estimatedDuration: `${waves.length} waves`,
    };
  }

  private findCriticalPath(tasks: SchedulableTask[], waves: SchedulableTask[][]): string[] {
    // Simple: longest chain of dependent tasks
    const path: string[] = [];
    for (const wave of waves) {
      if (wave.length > 0) {
        // Pick the task with most downstream dependents
        const heaviest = wave.reduce((a, b) => {
          const aDeps = tasks.filter((t) => t.dependencies.includes(a.id)).length;
          const bDeps = tasks.filter((t) => t.dependencies.includes(b.id)).length;
          return aDeps >= bDeps ? a : b;
        });
        path.push(heaviest.id);
      }
    }
    return path;
  }
}
