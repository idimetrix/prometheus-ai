import { Queue } from "bullmq";
import { redis } from "./connection";
import type { AgentTaskData, IndexingJobData, NotificationJobData, BillingEventData } from "./types";

export const agentTaskQueue = new Queue<AgentTaskData>("agent-tasks", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const indexingQueue = new Queue<IndexingJobData>("indexing", {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

export const notificationQueue = new Queue<NotificationJobData>("notifications", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export const billingQueue = new Queue<BillingEventData>("billing-events", {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});
