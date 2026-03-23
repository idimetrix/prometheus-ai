/**
 * WorkerPool — Manages N concurrent workers executing subtasks in parallel.
 * Each worker gets its own sandbox and worktree. Pool size is tier-gated.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:compound:worker-pool");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkerStatus =
  | "idle"
  | "assigned"
  | "executing"
  | "completed"
  | "failed";

export interface Worker {
  /** Agent role assigned to this worker */
  agentRole: string;
  /** When the worker finished (completed or failed) */
  completedAt: Date | null;
  /** Error message if the worker failed */
  error?: string;
  /** Unique worker identifier */
  id: string;
  /** Output from the worker's execution */
  output?: string;
  /** Sandbox ID for isolated execution */
  sandboxId: string;
  /** When the worker started executing */
  startedAt: Date | null;
  /** Current lifecycle status */
  status: WorkerStatus;
  /** Subtask ID this worker is executing */
  taskId: string;
  /** Git worktree path for isolated file operations */
  worktreePath: string;
}

export interface WorkerInfo {
  agentRole: string;
  id: string;
  startedAt: Date | null;
  status: WorkerStatus;
  taskId: string;
}

export interface WorkerPoolConfig {
  /** Maximum concurrent workers (overrides tier limit if set) */
  maxWorkers?: number;
  /** Organization ID for resource tracking */
  orgId: string;
  /** Plan tier determines concurrency limit */
  planTier: string;
  /** Session ID for worker scoping */
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Tier-based concurrency limits
// ---------------------------------------------------------------------------

const TIER_WORKER_LIMITS: Record<string, number> = {
  hobby: 1,
  starter: 2,
  pro: 4,
  team: 8,
  studio: 16,
  enterprise: 32,
};

// ---------------------------------------------------------------------------
// WorkerPool
// ---------------------------------------------------------------------------

export class WorkerPool {
  private readonly config: WorkerPoolConfig;
  private readonly maxWorkers: number;
  private readonly workers = new Map<string, Worker>();
  private readonly waitQueue: Array<{
    resolve: (worker: Worker) => void;
    reject: (error: Error) => void;
    role: string;
    taskId: string;
  }> = [];

  constructor(config: WorkerPoolConfig) {
    this.config = config;
    this.maxWorkers =
      config.maxWorkers ??
      TIER_WORKER_LIMITS[config.planTier] ??
      TIER_WORKER_LIMITS.hobby ??
      1;

    logger.info(
      {
        sessionId: config.sessionId,
        planTier: config.planTier,
        maxWorkers: this.maxWorkers,
      },
      "WorkerPool initialized"
    );
  }

  /**
   * Acquire a worker for a subtask. If the pool is at capacity,
   * the call will wait until a worker is released.
   */
  acquireWorker(role: string, taskId: string): Promise<Worker> {
    // Check if we have capacity
    const activeCount = this.getActiveCount();
    if (activeCount < this.maxWorkers) {
      return Promise.resolve(this.createWorker(role, taskId));
    }

    // Wait for a worker to be released
    logger.debug(
      { role, taskId, activeCount, maxWorkers: this.maxWorkers },
      "WorkerPool at capacity, queuing request"
    );

    return new Promise<Worker>((resolve, reject) => {
      this.waitQueue.push({ resolve, reject, role, taskId });
    });
  }

  /**
   * Release a worker back to the pool. If there are queued requests,
   * immediately assign a new worker.
   */
  releaseWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      logger.warn({ workerId }, "Attempted to release unknown worker");
      return;
    }

    if (worker.status === "executing" || worker.status === "assigned") {
      worker.status = "completed";
      worker.completedAt = new Date();
    }

    logger.debug(
      { workerId, status: worker.status, taskId: worker.taskId },
      "Worker released"
    );

    // If there are queued requests, service the next one
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) {
        try {
          const newWorker = this.createWorker(next.role, next.taskId);
          next.resolve(newWorker);
        } catch (error) {
          next.reject(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }
  }

  /**
   * Mark a worker as failed.
   */
  failWorker(workerId: string, error: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    worker.status = "failed";
    worker.error = error;
    worker.completedAt = new Date();

    logger.warn({ workerId, error, taskId: worker.taskId }, "Worker failed");

    // Service next in queue
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) {
        try {
          const newWorker = this.createWorker(next.role, next.taskId);
          next.resolve(newWorker);
        } catch (err) {
          next.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }

  /**
   * Mark a worker as executing (transition from assigned → executing).
   */
  startWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker && worker.status === "assigned") {
      worker.status = "executing";
      worker.startedAt = new Date();
    }
  }

  /**
   * Get information about all active workers.
   */
  getActiveWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values())
      .filter((w) => w.status === "assigned" || w.status === "executing")
      .map((w) => ({
        id: w.id,
        taskId: w.taskId,
        agentRole: w.agentRole,
        status: w.status,
        startedAt: w.startedAt,
      }));
  }

  /**
   * Get all workers (including completed/failed).
   */
  getAllWorkers(): Worker[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get a specific worker by ID.
   */
  getWorker(workerId: string): Worker | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get the current pool utilization.
   */
  getUtilization(): {
    active: number;
    completed: number;
    failed: number;
    maxWorkers: number;
    queued: number;
    total: number;
  } {
    const all = Array.from(this.workers.values());
    return {
      active: all.filter(
        (w) => w.status === "assigned" || w.status === "executing"
      ).length,
      completed: all.filter((w) => w.status === "completed").length,
      failed: all.filter((w) => w.status === "failed").length,
      queued: this.waitQueue.length,
      total: all.length,
      maxWorkers: this.maxWorkers,
    };
  }

  /**
   * Drain all workers and reject any queued requests.
   */
  drain(): void {
    for (const worker of this.workers.values()) {
      if (worker.status === "assigned" || worker.status === "executing") {
        worker.status = "failed";
        worker.error = "Pool drained";
        worker.completedAt = new Date();
      }
    }

    for (const queued of this.waitQueue) {
      queued.reject(new Error("WorkerPool drained"));
    }
    this.waitQueue.length = 0;

    logger.info({ sessionId: this.config.sessionId }, "WorkerPool drained");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createWorker(role: string, taskId: string): Worker {
    const workerId = generateId("worker");
    const worker: Worker = {
      id: workerId,
      agentRole: role,
      taskId,
      sandboxId: `sandbox_${workerId}`,
      worktreePath: `/tmp/prometheus/worktrees/${this.config.sessionId}/${workerId}`,
      status: "assigned",
      startedAt: null,
      completedAt: null,
    };

    this.workers.set(workerId, worker);

    logger.debug(
      {
        workerId,
        role,
        taskId,
        sandboxId: worker.sandboxId,
        worktreePath: worker.worktreePath,
      },
      "Worker created"
    );

    return worker;
  }

  private getActiveCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === "assigned" || worker.status === "executing") {
        count++;
      }
    }
    return count;
  }
}
