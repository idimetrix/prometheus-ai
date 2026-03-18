import { Worker } from "bullmq";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type { AgentTaskData } from "@prometheus/queue";
import { TaskProcessor } from "./processor";

const logger = createLogger("queue-worker");
const processor = new TaskProcessor();

const worker = new Worker<AgentTaskData>(
  "agent-tasks",
  async (job) => {
    logger.info({ jobId: job.id, taskId: job.data.taskId }, "Processing task");
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

worker.on("completed", (job) => {
  logger.info({ jobId: job.id, taskId: job.data.taskId }, "Task completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, taskId: job?.data.taskId, error: error.message }, "Task failed");
});

worker.on("error", (error) => {
  logger.error({ error: error.message }, "Worker error");
});

logger.info("Queue Worker started");

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down worker...");
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
