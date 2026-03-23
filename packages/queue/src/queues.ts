import { Queue } from "bullmq";
import { redis } from "./connection";
import {
  type AgentTaskData,
  type CleanupSandboxData,
  type CreditGrantData,
  DEFAULT_DLQ_CONFIG,
  type GenerateEmbeddingsData,
  type IndexProjectData,
  JobPriority,
  type PreviewDeploymentData,
  RetryPolicies,
  type SendNotificationData,
  type UsageRollupData,
} from "./types";

// ========== Helper: Build default job options ==========
function buildJobOptions(
  retry: (typeof RetryPolicies)[keyof typeof RetryPolicies],
  opts?: {
    removeOnComplete?: number;
    removeOnFail?: number;
    priority?: number;
  }
) {
  return {
    attempts: retry.attempts,
    backoff: retry.backoff,
    removeOnComplete: { count: opts?.removeOnComplete ?? 1000 },
    removeOnFail: { count: opts?.removeOnFail ?? 5000 },
    ...(opts?.priority == null ? {} : { priority: opts.priority }),
  };
}

// ========== Agent Task Queues ==========

/** Standard agent task queue — used for hobby through studio tiers */
export const agentTaskQueue = new Queue<AgentTaskData>("agent-tasks", {
  connection: redis,
  defaultJobOptions: buildJobOptions(RetryPolicies.standard, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    priority: JobPriority.NORMAL,
  }),
});

/** Enterprise-tier agent task queue — higher priority, isolated */
export const enterpriseTaskQueue = new Queue<AgentTaskData>(
  "enterprise-tasks",
  {
    connection: redis,
    defaultJobOptions: buildJobOptions(RetryPolicies.critical, {
      removeOnComplete: 2000,
      removeOnFail: 10_000,
      priority: JobPriority.HIGH,
    }),
  }
);

// ========== Indexing & Embeddings ==========

/** File indexing queue */
export const indexingQueue = new Queue<IndexProjectData>("index-project", {
  connection: redis,
  defaultJobOptions: buildJobOptions(RetryPolicies.light, {
    removeOnComplete: 500,
    removeOnFail: 1000,
    priority: JobPriority.NORMAL,
  }),
});

/** Embedding generation queue */
export const embeddingsQueue = new Queue<GenerateEmbeddingsData>(
  "generate-embeddings",
  {
    connection: redis,
    defaultJobOptions: buildJobOptions(RetryPolicies.standard, {
      removeOnComplete: 500,
      removeOnFail: 2000,
      priority: JobPriority.LOW,
    }),
  }
);

// ========== Notifications ==========

/** Notification delivery queue */
export const notificationQueue = new Queue<SendNotificationData>(
  "send-notification",
  {
    connection: redis,
    defaultJobOptions: buildJobOptions(RetryPolicies.standard, {
      removeOnComplete: 200,
      removeOnFail: 500,
      priority: JobPriority.NORMAL,
    }),
  }
);

// ========== Sandbox Cleanup ==========

/** Container cleanup queue */
export const cleanupSandboxQueue = new Queue<CleanupSandboxData>(
  "cleanup-sandbox",
  {
    connection: redis,
    defaultJobOptions: buildJobOptions(RetryPolicies.light, {
      removeOnComplete: 200,
      removeOnFail: 500,
      priority: JobPriority.LOW,
    }),
  }
);

// ========== Preview Deployments ==========

/** Preview deployment queue */
export const previewDeploymentQueue = new Queue<PreviewDeploymentData>(
  "preview-deployment",
  {
    connection: redis,
    defaultJobOptions: buildJobOptions(RetryPolicies.standard, {
      removeOnComplete: 500,
      removeOnFail: 1000,
      priority: JobPriority.NORMAL,
    }),
  }
);

// ========== Billing & Usage ==========

/** Usage rollup aggregation queue */
export const usageRollupQueue = new Queue<UsageRollupData>("usage-rollup", {
  connection: redis,
  defaultJobOptions: buildJobOptions(RetryPolicies.standard, {
    removeOnComplete: 500,
    removeOnFail: 1000,
    priority: JobPriority.LOW,
  }),
});

/** Credit grant queue (monthly grants, refunds) */
export const creditGrantQueue = new Queue<CreditGrantData>("credit-grant", {
  connection: redis,
  defaultJobOptions: buildJobOptions(RetryPolicies.critical, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    priority: JobPriority.HIGH,
  }),
});

/** Credit reconciliation queue */
export const reconciliationQueue = new Queue("credit-reconciliation", {
  connection: redis,
  defaultJobOptions: buildJobOptions(RetryPolicies.standard, {
    removeOnComplete: 500,
    removeOnFail: 1000,
    priority: JobPriority.NORMAL,
  }),
});

// Re-export the old billingQueue name for backward compat
export const billingQueue = creditGrantQueue;

// ========== Dead Letter Queues ==========

/** DLQ for agent tasks that exhausted all retries */
export const agentTaskDLQ = new Queue<AgentTaskData>(
  `agent-tasks${DEFAULT_DLQ_CONFIG.queueSuffix}`,
  {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: { age: DEFAULT_DLQ_CONFIG.ttlMs / 1000 },
      removeOnFail: false,
    },
  }
);

/** DLQ for billing/credit jobs that exhausted all retries */
export const billingDLQ = new Queue<CreditGrantData>(
  `credit-grant${DEFAULT_DLQ_CONFIG.queueSuffix}`,
  {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: { age: DEFAULT_DLQ_CONFIG.ttlMs / 1000 },
      removeOnFail: false,
    },
  }
);

// ========== Queue Registry ==========

export const ALL_QUEUES = {
  "agent-tasks": agentTaskQueue,
  "enterprise-tasks": enterpriseTaskQueue,
  "index-project": indexingQueue,
  "generate-embeddings": embeddingsQueue,
  "send-notification": notificationQueue,
  "cleanup-sandbox": cleanupSandboxQueue,
  "preview-deployment": previewDeploymentQueue,
  "usage-rollup": usageRollupQueue,
  "credit-grant": creditGrantQueue,
  "credit-reconciliation": reconciliationQueue,
} as const;

export type QueueName = keyof typeof ALL_QUEUES;
