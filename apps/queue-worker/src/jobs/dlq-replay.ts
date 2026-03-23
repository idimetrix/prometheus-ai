import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { Queue } from "bullmq";

const logger = createLogger("queue-worker:dlq-replay");

/** Maximum age of DLQ entries to replay (24 hours) */
const MAX_REPLAY_AGE_MS = 24 * 60 * 60 * 1000;

/** Maximum number of jobs to replay per run */
const MAX_REPLAY_BATCH = 50;

interface DLQJobData {
  error: string;
  failedAt: string;
  originalData: unknown;
  originalJobId?: string;
  replayAttempts?: number;
}

/** DLQ name → original queue name mapping */
const DLQ_MAPPINGS: Record<string, string> = {
  "agent-tasks:dlq": "agent-tasks",
  "credit-grant:dlq": "credit-grant",
};

/**
 * Replays eligible jobs from dead letter queues back to their original queues.
 * A job is eligible if:
 * - It failed within the last 24 hours
 * - It has been replayed fewer than 3 times
 */
export async function processDLQReplay(): Promise<{
  replayed: number;
  expired: number;
  skipped: number;
}> {
  const connection = createRedisConnection();
  let replayed = 0;
  let expired = 0;
  let skipped = 0;

  try {
    for (const [dlqName, originalQueueName] of Object.entries(DLQ_MAPPINGS)) {
      const dlq = new Queue(dlqName, { connection });
      const originalQueue = new Queue(originalQueueName, { connection });

      // Get waiting jobs from the DLQ
      const jobs = await dlq.getWaiting(0, MAX_REPLAY_BATCH);

      for (const job of jobs) {
        const data = job.data as DLQJobData;
        const failedAt = new Date(data.failedAt).getTime();
        const age = Date.now() - failedAt;
        const replayAttempts = data.replayAttempts ?? 0;

        // Skip if too old
        if (age > MAX_REPLAY_AGE_MS) {
          expired++;
          await job.remove();
          logger.info(
            { dlq: dlqName, jobId: job.id, age: Math.round(age / 1000) },
            "DLQ entry expired, removing"
          );
          continue;
        }

        // Skip if already replayed too many times
        if (replayAttempts >= 3) {
          skipped++;
          logger.warn(
            { dlq: dlqName, jobId: job.id, replayAttempts },
            "DLQ entry exhausted replay attempts"
          );
          continue;
        }

        // Re-queue to original queue with backoff
        await originalQueue.add(`replay:${job.name}`, data.originalData, {
          attempts: 2,
          backoff: { type: "exponential", delay: 5000 },
          delay: 10_000 * (replayAttempts + 1), // Increasing delay per replay
        });

        // Update replay count in DLQ entry before removing
        await job.remove();
        replayed++;

        logger.info(
          {
            dlq: dlqName,
            originalQueue: originalQueueName,
            jobId: job.id,
            originalJobId: data.originalJobId,
            replayAttempt: replayAttempts + 1,
          },
          "DLQ entry replayed to original queue"
        );
      }

      await dlq.close();
      await originalQueue.close();
    }
  } finally {
    await connection.quit();
  }

  logger.info({ replayed, expired, skipped }, "DLQ replay completed");

  return { replayed, expired, skipped };
}
