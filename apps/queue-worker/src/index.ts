import { createServer } from "node:http";
import { createLogger } from "@prometheus/logger";
import type {
  AgentTaskData,
  CleanupSandboxData,
  CreditGrantData,
  GenerateEmbeddingsData,
  IndexProjectData,
  SendNotificationData,
  UsageRollupData,
} from "@prometheus/queue";
import { createRedisConnection } from "@prometheus/queue";
import { initSentry, initTelemetry } from "@prometheus/telemetry";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
} from "@prometheus/utils";
import { Queue, Worker } from "bullmq";
import { processCleanupSandbox } from "./jobs/cleanup-sandbox";
import { processCreditGrant } from "./jobs/credit-grant";
import { processGenerateEmbeddings } from "./jobs/generate-embeddings";
import { processIndexProject } from "./jobs/index-project";
import { processUsageRollup } from "./jobs/usage-rollup";
import { processNotification } from "./notifications";
import { TaskProcessor } from "./processor";
import { setupScheduledJobs } from "./scheduler";

await initTelemetry({ serviceName: "queue-worker" });
initSentry({ serviceName: "queue-worker" });
installShutdownHandlers();

const logger = createLogger("queue-worker");
const processor = new TaskProcessor();

// Register scheduled/repeatable jobs
setupScheduledJobs().catch((err) => {
  logger.error({ err }, "Failed to setup scheduled jobs");
});

// ========== Worker Concurrency Configuration ==========
const concurrency = {
  agentTasks: Number(process.env.WORKER_CONCURRENCY ?? 2),
  enterprise: Number(process.env.ENTERPRISE_CONCURRENCY ?? 4),
  indexing: Number(process.env.INDEXING_CONCURRENCY ?? 1),
  embeddings: Number(process.env.EMBEDDINGS_CONCURRENCY ?? 2),
  notifications: Number(process.env.NOTIFICATION_CONCURRENCY ?? 5),
  cleanup: Number(process.env.CLEANUP_CONCURRENCY ?? 2),
  billing: Number(process.env.BILLING_CONCURRENCY ?? 3),
};

// ========== Dead Letter Queues ==========
const agentTaskDLQ = new Queue("agent-tasks:dlq", {
  connection: createRedisConnection(),
});
const billingDLQ = new Queue("credit-grant:dlq", {
  connection: createRedisConnection(),
});

// ========== Helper: Move to DLQ ==========
async function moveToDLQ(
  dlq: Queue,
  job: { id?: string; name: string; data: unknown },
  error: Error
) {
  try {
    await dlq.add(`dlq:${job.name}`, {
      originalJobId: job.id,
      originalData: job.data,
      error: error.message,
      failedAt: new Date().toISOString(),
    });
    logger.warn(
      { jobId: job.id, dlq: dlq.name },
      "Job moved to dead letter queue"
    );
  } catch (dlqError) {
    logger.error({ jobId: job.id, dlqError }, "Failed to move job to DLQ");
  }
}

// ========== Agent Task Worker ==========
const _defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 1000 },
};

const agentWorker = new Worker<AgentTaskData>(
  "agent-tasks",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        taskId: job.data.taskId,
        attempt: job.attemptsMade + 1,
        priority: job.opts.priority,
      },
      "Processing agent task"
    );
    return await processor.process(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.agentTasks,
    limiter: {
      max: 10,
      duration: 60_000,
    },
  }
);

// ========== Enterprise Task Worker ==========
const enterpriseWorker = new Worker<AgentTaskData>(
  "enterprise-tasks",
  async (job) => {
    logger.info(
      { jobId: job.id, taskId: job.data.taskId, attempt: job.attemptsMade + 1 },
      "Processing enterprise task"
    );
    return await processor.process(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.enterprise,
  }
);

// ========== Index Project Worker ==========
const indexProjectWorker = new Worker<IndexProjectData>(
  "index-project",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        projectId: job.data.projectId,
        files: job.data.filePaths.length,
        fullReindex: job.data.fullReindex,
      },
      "Processing index-project job"
    );
    return await processIndexProject(job.data, (progress) => {
      job.updateProgress(progress).catch(() => {
        /* fire-and-forget */
      });
    });
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.indexing,
  }
);

// ========== Generate Embeddings Worker ==========
const embeddingsWorker = new Worker<GenerateEmbeddingsData>(
  "generate-embeddings",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        projectId: job.data.projectId,
        filePath: job.data.filePath,
        chunks: job.data.chunks.length,
      },
      "Processing generate-embeddings job"
    );
    return await processGenerateEmbeddings(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.embeddings,
  }
);

// ========== Send Notification Worker ==========
const notificationWorker = new Worker<SendNotificationData>(
  "send-notification",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        type: job.data.type,
        userId: job.data.userId,
        channel: job.data.channel,
      },
      "Processing send-notification job"
    );
    await processNotification(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.notifications,
  }
);

// ========== Cleanup Sandbox Worker ==========
const cleanupWorker = new Worker<CleanupSandboxData>(
  "cleanup-sandbox",
  async (job) => {
    logger.info(
      { jobId: job.id, sandboxId: job.data.sandboxId, reason: job.data.reason },
      "Processing cleanup-sandbox job"
    );
    return await processCleanupSandbox(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.cleanup,
  }
);

// ========== Usage Rollup Worker ==========
const usageRollupWorker = new Worker<UsageRollupData>(
  "usage-rollup",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        orgId: job.data.orgId,
        periodStart: job.data.periodStart,
      },
      "Processing usage-rollup job"
    );
    return await processUsageRollup(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: 1, // Rollups must be serialized per org
  }
);

// ========== Credit Grant Worker ==========
const creditGrantWorker = new Worker<CreditGrantData>(
  "credit-grant",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        orgId: job.data.orgId,
        amount: job.data.amount,
        reason: job.data.reason,
      },
      "Processing credit-grant job"
    );
    return await processCreditGrant(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.billing,
  }
);

// ========== Event Handlers (logging, DLQ) ==========
const workers: Record<string, { worker: Worker; dlq?: Queue }> = {
  "agent-tasks": { worker: agentWorker, dlq: agentTaskDLQ },
  "enterprise-tasks": { worker: enterpriseWorker, dlq: agentTaskDLQ },
  "index-project": { worker: indexProjectWorker },
  "generate-embeddings": { worker: embeddingsWorker },
  "send-notification": { worker: notificationWorker },
  "cleanup-sandbox": { worker: cleanupWorker },
  "usage-rollup": { worker: usageRollupWorker },
  "credit-grant": { worker: creditGrantWorker, dlq: billingDLQ },
};

for (const [name, { worker, dlq }] of Object.entries(workers)) {
  worker.on("completed", (job) => {
    logger.info({ worker: name, jobId: job.id }, "Job completed");
  });

  worker.on("failed", (job, error) => {
    const isLastAttempt = job
      ? job.attemptsMade >= (job.opts.attempts ?? 1)
      : true;
    logger.error(
      {
        worker: name,
        jobId: job?.id,
        error: error.message,
        attempt: job?.attemptsMade,
        maxAttempts: job?.opts.attempts,
        isLastAttempt,
      },
      "Job failed"
    );

    // Move to DLQ if all retries exhausted
    if (isLastAttempt && dlq && job) {
      moveToDLQ(dlq, job, error);
    }
  });

  worker.on("error", (error) => {
    logger.error({ worker: name, error: error.message }, "Worker error");
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ worker: name, jobId }, "Job stalled");
  });
}

logger.info(
  {
    workers: Object.keys(workers),
    concurrency,
  },
  "Queue Workers started"
);

// ========== Health Endpoints ==========
const healthPort = Number(process.env.HEALTH_PORT ?? 4007);
const healthServer = createServer((req, res) => {
  if (req.url === "/health") {
    if (isProcessShuttingDown()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "draining" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "queue-worker",
        version: process.env.APP_VERSION ?? "0.0.0",
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        workers: Object.keys(workers),
      })
    );
    return;
  }
  if (req.url === "/live") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.url === "/ready") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ready" }));
    return;
  }
  res.writeHead(404);
  res.end();
});
healthServer.listen(healthPort, () => {
  logger.info({ port: healthPort }, "Health server running");
});

// ========== Graceful Shutdown ==========
const shutdown = async () => {
  logger.info("Shutting down workers...");
  healthServer.close();
  await Promise.allSettled(
    Object.values(workers).map(({ worker }) => worker.close())
  );
  logger.info("All workers closed");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
