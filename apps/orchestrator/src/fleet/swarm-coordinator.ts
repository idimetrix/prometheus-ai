import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:swarm-coordinator");

export interface SwarmTask {
  dependencies: string[];
  description: string;
  id: string;
  priority?: number;
  role: string;
}

export interface SwarmResult {
  error?: string;
  result?: unknown;
  status: "completed" | "failed" | "cancelled";
  taskId: string;
}

export class SwarmCoordinator {
  private readonly sessionId: string;
  private readonly tasks = new Map<string, SwarmTask>();
  private readonly results = new Map<string, SwarmResult>();
  private readonly maxConcurrency: number;
  private readonly abortController = new AbortController();
  private state: "idle" | "running" | "completed" | "cancelled" = "idle";

  constructor(options: { sessionId: string; maxConcurrency?: number }) {
    this.sessionId = options.sessionId;
    this.maxConcurrency = options.maxConcurrency ?? 4;
  }

  async coordinate(
    tasks: SwarmTask[],
    executor: (task: SwarmTask) => Promise<unknown>
  ): Promise<SwarmResult[]> {
    this.state = "running";
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }

    const pending = new Set(tasks.map((t) => t.id));
    const running = new Set<string>();

    while (pending.size > 0 && !this.abortController.signal.aborted) {
      // Find tasks whose dependencies are all resolved
      const ready = this.findReadyTasks(pending, running);

      if (ready.length === 0 && running.size === 0) {
        // Deadlock or all done
        break;
      }

      // Execute ready tasks
      const execPromises = ready.map(async (task) => {
        pending.delete(task.id);
        running.add(task.id);
        logger.info(
          { taskId: task.id, role: task.role, session: this.sessionId },
          "Executing swarm task"
        );
        try {
          const result = await executor(task);
          this.results.set(task.id, {
            taskId: task.id,
            status: "completed",
            result,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.results.set(task.id, {
            taskId: task.id,
            status: "failed",
            error: msg,
          });
          logger.error({ taskId: task.id, error: msg }, "Swarm task failed");
        } finally {
          running.delete(task.id);
        }
      });

      if (execPromises.length > 0) {
        await Promise.race([
          Promise.allSettled(execPromises),
          new Promise((_, reject) => {
            this.abortController.signal.addEventListener("abort", () =>
              reject(new Error("Cancelled"))
            );
          }),
        ]).catch(() => {
          /* cancelled */
        });
      } else {
        // Wait for running tasks
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Mark remaining pending as cancelled
    for (const id of pending) {
      if (!this.results.has(id)) {
        this.results.set(id, { taskId: id, status: "cancelled" });
      }
    }

    this.state = this.abortController.signal.aborted
      ? "cancelled"
      : "completed";
    return Array.from(this.results.values());
  }

  private findReadyTasks(
    pending: Set<string>,
    running: Set<string>
  ): SwarmTask[] {
    const ready: SwarmTask[] = [];
    // Collect candidates separately to avoid modifying pending while iterating
    const failedIds: string[] = [];

    for (const id of pending) {
      const task = this.tasks.get(id);
      if (!task) {
        continue;
      }
      const depFailed = task.dependencies.some(
        (dep) =>
          this.results.has(dep) && this.results.get(dep)?.status === "failed"
      );
      if (depFailed) {
        failedIds.push(id);
        continue;
      }
      const depsResolved = task.dependencies.every(
        (dep) =>
          this.results.has(dep) && this.results.get(dep)?.status === "completed"
      );
      // Respect maxConcurrency: available slots = maxConcurrency - running - already selected
      if (depsResolved && running.size + ready.length < this.maxConcurrency) {
        ready.push(task);
      }
    }

    // Mark failed dependencies after iteration to avoid mutating set mid-loop
    for (const id of failedIds) {
      pending.delete(id);
      this.results.set(id, {
        taskId: id,
        status: "failed",
        error: "Dependency failed",
      });
    }

    // Sort by priority (higher priority first) for deterministic scheduling
    ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    return ready;
  }

  getStatus() {
    return {
      state: this.state,
      total: this.tasks.size,
      completed: Array.from(this.results.values()).filter(
        (r) => r.status === "completed"
      ).length,
      failed: Array.from(this.results.values()).filter(
        (r) => r.status === "failed"
      ).length,
    };
  }

  cancel(): void {
    this.abortController.abort();
    this.state = "cancelled";
  }
}
