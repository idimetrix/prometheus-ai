import { Worker } from "bullmq";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type { AgentTaskData, IndexingJobData, NotificationJobData } from "@prometheus/queue";
import { TaskProcessor } from "./processor";

const logger = createLogger("queue-worker");
const processor = new TaskProcessor();

// Main agent task worker
const agentWorker = new Worker<AgentTaskData>(
  "agent-tasks",
  async (job) => {
    logger.info({ jobId: job.id, taskId: job.data.taskId, priority: job.opts.priority }, "Processing agent task");
    return processor.process(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
    limiter: {
      max: 10,
      duration: 60000,
    },
  },
);

// Enterprise isolated worker (separate queue for enterprise tier)
const enterpriseWorker = new Worker<AgentTaskData>(
  "enterprise-tasks",
  async (job) => {
    logger.info({ jobId: job.id, taskId: job.data.taskId }, "Processing enterprise task");
    return processor.process(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: Number(process.env.ENTERPRISE_CONCURRENCY ?? 4),
  },
);

// Indexing worker
const indexingWorker = new Worker<IndexingJobData>(
  "indexing",
  async (job) => {
    logger.info({ projectId: job.data.projectId, files: job.data.filePaths.length }, "Processing indexing job");
    const brainUrl = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

    if (job.data.fullReindex) {
      await fetch(`${brainUrl}/index/directory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: job.data.projectId }),
      });
    } else {
      for (const filePath of job.data.filePaths) {
        await fetch(`${brainUrl}/index/file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: job.data.projectId, filePath }),
        });
      }
    }
  },
  {
    connection: createRedisConnection(),
    concurrency: 1,
  },
);

// Notification worker
const notificationWorker = new Worker<NotificationJobData>(
  "notifications",
  async (job) => {
    const { type, userId, orgId, data } = job.data;
    logger.info({ type, userId }, "Processing notification");

    // Send notifications based on type
    switch (type) {
      case "task_complete":
        logger.info({ userId, taskId: data.taskId }, "Task complete notification");
        break;
      case "task_failed":
        logger.info({ userId, taskId: data.taskId }, "Task failed notification");
        break;
      case "credits_low":
        logger.info({ orgId, balance: data.balance }, "Credits low notification");
        break;
      case "queue_ready":
        logger.info({ userId }, "Queue ready notification");
        break;
      case "weekly_summary":
        logger.info({ orgId }, "Weekly summary notification");
        break;
    }
  },
  {
    connection: createRedisConnection(),
    concurrency: 5,
  },
);

// Event handlers
for (const [name, worker] of Object.entries({
  agent: agentWorker,
  enterprise: enterpriseWorker,
  indexing: indexingWorker,
  notification: notificationWorker,
})) {
  worker.on("completed", (job) => {
    logger.info({ worker: name, jobId: job.id }, "Job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ worker: name, jobId: job?.id, error: error.message }, "Job failed");
  });

  worker.on("error", (error) => {
    logger.error({ worker: name, error: error.message }, "Worker error");
  });
}

logger.info("Queue Workers started (agent, enterprise, indexing, notification)");

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down workers...");
  await Promise.all([
    agentWorker.close(),
    enterpriseWorker.close(),
    indexingWorker.close(),
    notificationWorker.close(),
  ]);
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
