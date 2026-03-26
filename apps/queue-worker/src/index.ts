import { createServer } from "node:http";
import { createLogger } from "@prometheus/logger";
import type {
  AgentTaskData,
  CleanupSandboxData,
  ContinueSessionData,
  CreditGrantData,
  GenerateEmbeddingsData,
  IndexProjectData,
  SendNotificationData,
  SetupProjectEnvironmentData,
  UsageRollupData,
  WebhookDeliveryData,
} from "@prometheus/queue";
import { createRedisConnection } from "@prometheus/queue";
import {
  initSentry,
  initTelemetry,
  metricsRegistry,
} from "@prometheus/telemetry";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
  registerShutdownHandler,
} from "@prometheus/utils";
import { Queue, Worker } from "bullmq";
import { processCleanupSandbox } from "./jobs/cleanup-sandbox";
import { processContinueSession } from "./jobs/continue-session";
import { processCreditGrant } from "./jobs/credit-grant";
import { processGenerateEmbeddings } from "./jobs/generate-embeddings";
import { processIndexProject } from "./jobs/index-project";
import { processSetupEnvironment } from "./jobs/setup-environment";
import { processUsageRollup } from "./jobs/usage-rollup";
import { processWebhookDelivery } from "./jobs/webhook-delivery";
import { processNotification } from "./notifications";
import { TaskProcessor } from "./processor";
import { setupScheduledJobs } from "./scheduler";

await initTelemetry({ serviceName: "queue-worker" });
initSentry({ serviceName: "queue-worker" });
installShutdownHandlers();

const logger = createLogger("queue-worker");
const healthRedis = createRedisConnection();
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
const agentTaskDLQ = new Queue("agent-tasks-dlq", {
  connection: createRedisConnection(),
});
const billingDLQ = new Queue("credit-grant-dlq", {
  connection: createRedisConnection(),
});
const webhookDLQ = new Queue("webhook-delivery-dlq", {
  connection: createRedisConnection(),
});
const indexingDLQ = new Queue("indexing-dlq", {
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

// ========== Retry & Timeout Configuration ==========
/** Default job options: 3 retries with escalating backoff (1s, 5s, 30s) */
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "custom" as const, delay: 1000 },
};

/** Job timeout in ms: configurable, default 10 minutes */
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 10 * 60 * 1000);

/**
 * Custom backoff schedule: 1s -> 5s -> 30s
 * Used instead of pure exponential for more predictable retry timing.
 */
const CUSTOM_BACKOFF_DELAYS = [1000, 5000, 30_000];

function getCustomBackoffDelay(attemptsMade: number): number {
  const idx = Math.min(attemptsMade, CUSTOM_BACKOFF_DELAYS.length - 1);
  return CUSTOM_BACKOFF_DELAYS[idx] ?? 30_000;
}

/**
 * Wrap a processor function with timeout handling.
 * Rejects with a clear timeout error if the job exceeds the configured limit.
 */
function withJobTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  jobId: string | undefined
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Job ${jobId ?? "unknown"} timed out after ${Math.round(timeoutMs / 1000)}s`
          )
        );
      }, timeoutMs);
    }),
  ]);
}

// ========== Agent Task Worker ==========
const agentWorker = new Worker<AgentTaskData>(
  "agent-tasks",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        taskId: job.data.taskId,
        attempt: job.attemptsMade + 1,
        maxAttempts: defaultJobOptions.attempts,
        priority: job.opts.priority,
      },
      "Processing agent task"
    );

    // Report progress phases
    await job.updateProgress({ phase: "started", percent: 0 });

    const result = await withJobTimeout(
      () => processor.process(job.data),
      JOB_TIMEOUT_MS,
      job.id
    );

    await job.updateProgress({ phase: "completed", percent: 100 });
    return result;
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.agentTasks,
    lockDuration: JOB_TIMEOUT_MS + 60_000, // Lock longer than timeout
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        getCustomBackoffDelay(attemptsMade),
    },
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

    await job.updateProgress({ phase: "started", percent: 0 });

    const result = await withJobTimeout(
      () => processor.process(job.data),
      JOB_TIMEOUT_MS,
      job.id
    );

    await job.updateProgress({ phase: "completed", percent: 100 });
    return result;
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.enterprise,
    lockDuration: JOB_TIMEOUT_MS + 60_000,
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        getCustomBackoffDelay(attemptsMade),
    },
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
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        getCustomBackoffDelay(attemptsMade),
    },
  }
);

// ========== Setup Project Environment Worker ==========
const setupEnvWorker = new Worker<SetupProjectEnvironmentData>(
  "setup-project-environment",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        projectId: job.data.projectId,
        sandboxId: job.data.sandboxId,
      },
      "Processing setup-project-environment job"
    );
    return await processSetupEnvironment(job.data, (progress) => {
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

// ========== Session Continuation Worker ==========
const sessionContinuationWorker = new Worker<ContinueSessionData>(
  "session-continuation",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        sessionId: job.data.sessionId,
        checkpointId: job.data.checkpointId,
        iterationBudget: job.data.iterationBudget,
      },
      "Processing session-continuation job"
    );
    return await processContinueSession(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.agentTasks,
    lockDuration: 35 * 60 * 1000, // 35 minutes (longer than max job duration)
  }
);

// ========== Webhook Delivery Worker ==========
const webhookDeliveryWorker = new Worker<WebhookDeliveryData>(
  "webhook-delivery",
  async (job) => {
    logger.info(
      {
        jobId: job.id,
        subscriptionId: job.data.subscriptionId,
        event: job.data.event,
        attempt: job.data.attempt,
      },
      "Processing webhook-delivery job"
    );
    return await processWebhookDelivery(job.data);
  },
  {
    connection: createRedisConnection(),
    concurrency: concurrency.notifications,
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        getCustomBackoffDelay(attemptsMade),
    },
  }
);

// ========== Event Handlers (logging, DLQ) ==========
const workers: Record<string, { worker: Worker; dlq?: Queue }> = {
  "agent-tasks": { worker: agentWorker, dlq: agentTaskDLQ },
  "enterprise-tasks": { worker: enterpriseWorker, dlq: agentTaskDLQ },
  "index-project": { worker: indexProjectWorker, dlq: indexingDLQ },
  "generate-embeddings": { worker: embeddingsWorker, dlq: indexingDLQ },
  "send-notification": { worker: notificationWorker },
  "cleanup-sandbox": { worker: cleanupWorker },
  "session-continuation": {
    worker: sessionContinuationWorker,
    dlq: agentTaskDLQ,
  },
  "setup-project-environment": { worker: setupEnvWorker },
  "usage-rollup": { worker: usageRollupWorker },
  "credit-grant": { worker: creditGrantWorker, dlq: billingDLQ },
  "webhook-delivery": { worker: webhookDeliveryWorker, dlq: webhookDLQ },
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
    // Async health check with Redis dependency verification
    (async () => {
      const dependencies: Record<string, string> = {};
      try {
        await healthRedis.ping();
        dependencies.redis = "ok";
      } catch {
        dependencies.redis = "unavailable";
      }
      const allHealthy = Object.values(dependencies).every((v) => v === "ok");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: allHealthy ? "ok" : "degraded",
          service: "queue-worker",
          version: process.env.APP_VERSION ?? "0.0.0",
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
          workers: Object.keys(workers),
          dependencies,
        })
      );
    })();
    return;
  }
  if (req.url === "/live") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.url === "/ready" || req.url === "/health/ready") {
    (async () => {
      const checks: Record<string, boolean> = {};

      try {
        await healthRedis.ping();
        checks.redis = true;
      } catch {
        checks.redis = false;
      }

      try {
        const { db } = await import("@prometheus/db");
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`SELECT 1`);
        checks.db = true;
      } catch {
        checks.db = false;
      }

      const allReady = Object.values(checks).every(Boolean);
      const statusCode = allReady ? 200 : 503;
      const status = allReady ? "ready" : "not ready";

      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status, checks }));
    })();
    return;
  }
  if (req.url === "/metrics") {
    metricsRegistry
      .render()
      .then((body) => {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(500);
        res.end("Failed to render metrics");
      });
    return;
  }
  res.writeHead(404);
  res.end();
});
healthServer.listen(healthPort, () => {
  logger.info({ port: healthPort }, "Health server running");
});

// ========== Graceful Shutdown ==========
registerShutdownHandler("queue-worker", async () => {
  logger.info("Shutting down workers...");
  healthServer.close();

  // Close all workers (waits for in-flight jobs to complete)
  await Promise.allSettled(
    Object.values(workers).map(({ worker }) => worker.close())
  );
  logger.info("All workers closed");

  // Close DLQ connections
  const dlqQueues = [agentTaskDLQ, billingDLQ, webhookDLQ, indexingDLQ];
  await Promise.allSettled(dlqQueues.map((q) => q.close()));
  logger.info("All DLQ connections closed");

  // Close health Redis connection
  try {
    await healthRedis.quit();
  } catch {
    // Best-effort cleanup
  }
  logger.info("Queue worker shutdown complete");
});
