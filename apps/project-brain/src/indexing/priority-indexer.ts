/**
 * Priority Indexing Queue.
 *
 * BullMQ-based priority queue for processing file indexing jobs
 * with configurable priority levels:
 * - High (1): Active edits currently being worked on
 * - Medium (5): Files imported by active files
 * - Low (10): Background scan and bulk indexing
 */

import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { Queue, Worker } from "bullmq";

const logger = createLogger("project-brain:priority-indexer");

/** Priority levels for indexing. */
export const IndexPriority = {
  /** Active edits: immediate processing */
  HIGH: 1,
  /** Imported files: process within 1s */
  MEDIUM: 5,
  /** Background scan: process when idle */
  LOW: 10,
} as const;

export type IndexPriorityLevel =
  (typeof IndexPriority)[keyof typeof IndexPriority];

/**
 * A file queued for indexing.
 */
export interface IndexJob {
  /** File content to index */
  content: string;
  /** File path relative to project root */
  filePath: string;
  /** Detected language */
  language: string;
  /** Project identifier */
  projectId: string;
}

/**
 * Result of processing an index job.
 */
export interface IndexResult {
  /** Number of chunks extracted */
  chunksExtracted: number;
  /** Processing duration in ms */
  durationMs: number;
  /** Whether embeddings were generated */
  embeddingsGenerated: boolean;
  /** File path that was indexed */
  filePath: string;
  /** Number of symbols extracted */
  symbolsExtracted: number;
}

/**
 * Priority-based indexing queue backed by BullMQ.
 *
 * Files are enqueued with a priority level and processed in priority order.
 * The queue ensures that active edits are indexed before background scans.
 *
 * @example
 * ```ts
 * const indexer = new PriorityIndexer();
 * await indexer.start(async (job) => { ... });
 * await indexer.enqueue(
 *   { projectId: "p1", filePath: "src/index.ts", content: "...", language: "typescript" },
 *   IndexPriority.HIGH
 * );
 * ```
 */
export class PriorityIndexer {
  private queue: Queue<IndexJob> | null = null;
  private worker: Worker<IndexJob, IndexResult> | null = null;
  private readonly queueName = "code-indexing";

  /**
   * Initialize the priority queue.
   */
  init(): void {
    const connection = createRedisConnection();

    this.queue = new Queue<IndexJob>(this.queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86_400, count: 500 },
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      },
    });

    logger.info("Priority indexing queue initialized");
  }

  /**
   * Start processing jobs from the queue.
   *
   * @param handler - Function that processes each index job
   * @param concurrency - Number of concurrent workers (default: 4)
   */
  async start(
    handler: (job: IndexJob) => Promise<IndexResult>,
    concurrency = 4
  ): Promise<void> {
    if (!this.queue) {
      await this.init();
    }

    const connection = createRedisConnection();

    this.worker = new Worker<IndexJob, IndexResult>(
      this.queueName,
      async (job) => {
        const start = performance.now();

        logger.debug(
          {
            jobId: job.id,
            filePath: job.data.filePath,
            priority: job.opts.priority,
          },
          "Processing index job"
        );

        const result = await handler(job.data);
        const durationMs = Math.round(performance.now() - start);

        logger.debug(
          {
            jobId: job.id,
            filePath: job.data.filePath,
            durationMs,
            symbols: result.symbolsExtracted,
            chunks: result.chunksExtracted,
          },
          "Index job completed"
        );

        return { ...result, durationMs };
      },
      { connection, concurrency }
    );

    this.worker.on("completed", (job) => {
      logger.debug({ jobId: job.id }, "Index job completed");
    });

    this.worker.on("failed", (job, error) => {
      logger.error(
        { jobId: job?.id, error: error.message },
        "Index job failed"
      );
    });

    this.worker.on("error", (error) => {
      logger.error({ error: error.message }, "Index worker error");
    });

    logger.info({ concurrency }, "Priority indexer worker started");
  }

  /**
   * Enqueue a file for indexing with a given priority.
   *
   * @param job - The indexing job data
   * @param priority - Priority level (1=high, 5=medium, 10=low)
   */
  async enqueue(
    job: IndexJob,
    priority: IndexPriorityLevel = IndexPriority.MEDIUM
  ): Promise<void> {
    if (!this.queue) {
      await this.init();
    }

    if (!this.queue) {
      throw new Error("Failed to initialize indexing queue");
    }

    const jobId = `idx:${job.projectId}:${job.filePath}`;

    await this.queue.add(this.queueName, job, {
      priority,
      jobId,
      // Deduplicate: if same file is already queued, remove old job
      removeDependencyOnFailure: true,
    });

    logger.debug(
      { filePath: job.filePath, priority, jobId },
      "File enqueued for indexing"
    );
  }

  /**
   * Get the next job to process (for manual processing without a worker).
   */
  processNext(): IndexResult | null {
    if (!this.queue) {
      return null;
    }

    // Jobs are processed by the BullMQ worker automatically.
    // Manual processing requires stopping the worker and using queue.getNextJob()
    logger.debug("processNext called; jobs are processed by the worker");
    return null;
  }

  /**
   * Get queue statistics.
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    if (!this.queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0 };
    }

    const counts = await this.queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed"
    );

    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    };
  }

  /**
   * Stop the worker and close the queue.
   */
  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    logger.info("Priority indexer stopped");
  }
}
