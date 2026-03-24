/**
 * Scheduled Task Support (Phase 4.7)
 *
 * Enables cron-like job scheduling via BullMQ repeatable jobs.
 * Supports 24/7 autonomous operation with recurring tasks,
 * progress notifications, and checkpoint/resume on failure.
 */

import { createLogger } from "@prometheus/logger";
import { Queue, type RepeatOptions } from "bullmq";
import { redis } from "./connection";
import type { AgentTaskData } from "./types";
import { RetryPolicies } from "./types";

const logger = createLogger("queue:scheduled-tasks");

export interface ScheduledTaskConfig {
  /** Cron pattern (e.g., "0 0 * * *" for daily at midnight) */
  cronPattern: string;
  /** Description of what this task does */
  description?: string;
  /** Whether this schedule is currently enabled */
  enabled: boolean;
  /** Unique identifier for this scheduled task */
  id: string;
  /** Maximum number of runs to keep (default: 100) */
  limit?: number;
  /** Display name */
  name: string;
  /** Task data to enqueue when the schedule fires */
  taskData: Omit<AgentTaskData, "taskId" | "sessionId">;
  /** Timezone for the cron schedule (default: UTC) */
  timezone?: string;
}

export interface ScheduledTaskStatus {
  cronPattern: string;
  enabled: boolean;
  id: string;
  lastRunAt: Date | null;
  name: string;
  nextRunAt: Date | null;
}

const SCHEDULED_QUEUE_NAME = "scheduled-tasks";

/**
 * Manages recurring/scheduled task execution via BullMQ repeatable jobs.
 */
export class ScheduledTaskManager {
  private readonly queue: Queue<AgentTaskData>;

  constructor() {
    this.queue = new Queue<AgentTaskData>(SCHEDULED_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: RetryPolicies.standard.attempts,
        backoff: RetryPolicies.standard.backoff,
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }

  /**
   * Register a scheduled task. Creates a BullMQ repeatable job.
   */
  async register(config: ScheduledTaskConfig): Promise<void> {
    if (!config.enabled) {
      logger.info(
        { id: config.id, name: config.name },
        "Skipping disabled scheduled task"
      );
      return;
    }

    const repeatOptions: RepeatOptions = {
      pattern: config.cronPattern,
      limit: config.limit ?? 100,
    };

    if (config.timezone) {
      repeatOptions.tz = config.timezone;
    }

    const taskData: AgentTaskData = {
      ...config.taskData,
      taskId: `scheduled-${config.id}`,
      sessionId: `scheduled-ses-${config.id}`,
    };

    await this.queue.add(`scheduled:${config.id}`, taskData, {
      repeat: repeatOptions,
      jobId: config.id,
    });

    logger.info(
      {
        id: config.id,
        name: config.name,
        cronPattern: config.cronPattern,
        timezone: config.timezone ?? "UTC",
      },
      "Scheduled task registered"
    );
  }

  /**
   * Remove a scheduled task by ID.
   */
  async unregister(id: string): Promise<boolean> {
    const repeatableJobs = await this.queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === id || j.key.includes(id));

    if (!job) {
      logger.warn({ id }, "Scheduled task not found");
      return false;
    }

    await this.queue.removeRepeatableByKey(job.key);
    logger.info({ id }, "Scheduled task unregistered");
    return true;
  }

  /**
   * List all registered scheduled tasks.
   */
  async list(): Promise<ScheduledTaskStatus[]> {
    const repeatableJobs = await this.queue.getRepeatableJobs();

    return repeatableJobs.map((job) => ({
      id: job.id ?? job.key,
      name: job.name,
      cronPattern: job.pattern ?? "",
      enabled: true,
      nextRunAt: job.next ? new Date(job.next) : null,
      lastRunAt: null,
    }));
  }

  /**
   * Pause all scheduled tasks.
   */
  async pauseAll(): Promise<void> {
    await this.queue.pause();
    logger.info("All scheduled tasks paused");
  }

  /**
   * Resume all scheduled tasks.
   */
  async resumeAll(): Promise<void> {
    await this.queue.resume();
    logger.info("All scheduled tasks resumed");
  }

  /**
   * Get the underlying queue (for worker registration).
   */
  getQueue(): Queue<AgentTaskData> {
    return this.queue;
  }

  /**
   * Clean up resources.
   */
  async close(): Promise<void> {
    await this.queue.close();
  }
}
