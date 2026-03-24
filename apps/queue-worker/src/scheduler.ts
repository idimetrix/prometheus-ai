import { createLogger } from "@prometheus/logger";
import {
  agentTaskQueue,
  cleanupSandboxQueue,
  notificationQueue,
  reconciliationQueue,
  redis,
  usageRollupQueue,
} from "@prometheus/queue";
import { Queue } from "bullmq";

const logger = createLogger("queue-worker:scheduler");

/** Memory consolidation queue for nightly dedup/decay jobs */
const memoryConsolidationQueue = new Queue("memory-consolidation", {
  connection: redis,
});

/** Stale task detection queue */
const staleTaskDetectionQueue = new Queue("stale-task-detection", {
  connection: redis,
});

/** Daily summary notification queue */
const dailySummaryQueue = new Queue("daily-summary", {
  connection: redis,
});

// ========== Scheduled Task Registry ==========

export interface ScheduledTaskDefinition {
  /** Cron pattern (e.g. "0 2 * * *" for daily at 2am) */
  cronPattern: string;
  /** Human-readable description */
  description: string;
  /** Whether the task is enabled */
  enabled: boolean;
  /** Unique name for this scheduled task */
  name: string;
  /** Organization that owns this task (use "__system__" for global) */
  orgId: string;
  /** Queue to add the job to */
  queueName: string;
  /** Job data payload */
  taskData: Record<string, unknown>;
}

/**
 * Register a custom cron-scheduled task at runtime.
 * Uses BullMQ's built-in repeat/cron feature for reliable scheduling.
 */
export async function registerScheduledTask(
  definition: ScheduledTaskDefinition
): Promise<void> {
  if (!definition.enabled) {
    logger.info({ name: definition.name }, "Skipping disabled scheduled task");
    return;
  }

  const queueMap: Record<string, Queue> = {
    "agent-tasks": agentTaskQueue,
    "cleanup-sandbox": cleanupSandboxQueue,
    "usage-rollup": usageRollupQueue,
    "credit-reconciliation": reconciliationQueue,
    "send-notification": notificationQueue,
    "stale-task-detection": staleTaskDetectionQueue,
    "daily-summary": dailySummaryQueue,
  };

  const queue = queueMap[definition.queueName];
  if (!queue) {
    logger.warn(
      { queueName: definition.queueName, name: definition.name },
      "Unknown queue for scheduled task"
    );
    return;
  }

  await queue.add(`scheduled:${definition.name}`, definition.taskData, {
    repeat: { pattern: definition.cronPattern },
    jobId: `scheduled:${definition.name}`,
  });

  logger.info(
    {
      name: definition.name,
      cron: definition.cronPattern,
      queue: definition.queueName,
    },
    "Registered scheduled task"
  );
}

/**
 * Remove a previously registered scheduled task.
 */
export async function removeScheduledTask(
  queueName: string,
  taskName: string
): Promise<boolean> {
  const queueMap: Record<string, Queue> = {
    "agent-tasks": agentTaskQueue,
    "cleanup-sandbox": cleanupSandboxQueue,
    "usage-rollup": usageRollupQueue,
    "credit-reconciliation": reconciliationQueue,
    "send-notification": notificationQueue,
    "stale-task-detection": staleTaskDetectionQueue,
    "daily-summary": dailySummaryQueue,
  };

  const queue = queueMap[queueName];
  if (!queue) {
    return false;
  }

  const removed = await queue.removeRepeatableByKey(
    `scheduled:${taskName}:::${taskName}`
  );

  logger.info(
    { name: taskName, queue: queueName, removed },
    "Removed scheduled task"
  );
  return removed;
}

/**
 * Registers repeatable (cron-like) jobs on startup using BullMQ's repeat option.
 * These are idempotent — BullMQ deduplicates repeatable jobs by name + pattern.
 */
export async function setupScheduledJobs(): Promise<void> {
  // Usage rollup — every hour
  await usageRollupQueue.add(
    "scheduled:usage-rollup",
    {
      orgId: "__all__",
      periodStart: "",
      periodEnd: "",
      metrics: {
        tasksCompleted: 0,
        creditsUsed: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
      },
    },
    {
      repeat: { pattern: "0 * * * *" },
      jobId: "scheduled:usage-rollup",
    }
  );

  // Cleanup sandboxes — every 30 minutes
  await cleanupSandboxQueue.add(
    "scheduled:cleanup-sandbox",
    {
      sandboxId: "__stale__",
      sessionId: "",
      projectId: "",
      orgId: "",
      reason: "timeout" as const,
      preserveArtifacts: false,
    },
    {
      repeat: { pattern: "*/30 * * * *" },
      jobId: "scheduled:cleanup-sandbox",
    }
  );

  // Credit reconciliation — daily at 3am UTC
  await reconciliationQueue.add(
    "scheduled:credit-reconciliation",
    { trigger: "scheduled" },
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: "scheduled:credit-reconciliation",
    }
  );

  // Stale worktree cleanup — every 6 hours
  await cleanupSandboxQueue.add(
    "scheduled:stale-worktree-cleanup",
    {
      sandboxId: "__worktrees__",
      sessionId: "",
      projectId: "",
      orgId: "",
      reason: "timeout" as const,
      preserveArtifacts: false,
    },
    {
      repeat: { pattern: "0 */6 * * *" },
      jobId: "scheduled:stale-worktree-cleanup",
    }
  );

  // DLQ replay — every 15 minutes
  // Replays eligible dead-letter queue entries back to their original queues
  await cleanupSandboxQueue.add(
    "scheduled:dlq-replay",
    {
      sandboxId: "__dlq-replay__",
      sessionId: "",
      projectId: "",
      orgId: "",
      reason: "timeout" as const,
      preserveArtifacts: false,
    },
    {
      repeat: { pattern: "*/15 * * * *" },
      jobId: "scheduled:dlq-replay",
    }
  );

  // Nightly memory consolidation — 2am UTC
  // Deduplicates/merges similar memories and applies decay
  // (reduces relevance for memories not accessed in 30 days)
  await memoryConsolidationQueue.add(
    "scheduled:memory-consolidation",
    {
      operations: ["deduplicate", "merge_similar", "decay"],
      decayConfig: {
        inactiveDaysThreshold: 30,
        decayFactor: 0.8,
      },
    },
    {
      repeat: { pattern: "0 2 * * *" },
      jobId: "scheduled:memory-consolidation",
    }
  );

  // Stale task detection — every 5 minutes
  // Detects tasks stuck in "queued" status for more than 15 minutes
  await staleTaskDetectionQueue.add(
    "scheduled:stale-task-detection",
    {
      maxAgeMinutes: 15,
      action: "notify",
    },
    {
      repeat: { pattern: "*/5 * * * *" },
      jobId: "scheduled:stale-task-detection",
    }
  );

  // Daily summary notification — every day at 8am UTC
  await dailySummaryQueue.add(
    "scheduled:daily-summary",
    {
      orgId: "__all__",
      lookbackHours: 24,
    },
    {
      repeat: { pattern: "0 8 * * *" },
      jobId: "scheduled:daily-summary",
    }
  );

  logger.info("Scheduled jobs registered");
}
