import type { AgentMode, AgentRole, PlanTier } from "@prometheus/types";

// ========== Job Priority Levels ==========
export const JobPriority = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 5,
  LOW: 10,
} as const;
export type JobPriority = (typeof JobPriority)[keyof typeof JobPriority];

// ========== Retry Policies ==========
export interface RetryPolicy {
  attempts: number;
  backoff: {
    type: "exponential" | "fixed";
    delay: number;
  };
}

export const RetryPolicies = {
  /** Critical jobs: many retries with longer backoff */
  critical: {
    attempts: 10,
    backoff: { type: "exponential" as const, delay: 10_000 },
  },
  /** Standard jobs: moderate retries */
  standard: {
    attempts: 5,
    backoff: { type: "exponential" as const, delay: 5000 },
  },
  /** Light jobs: few retries with short backoff */
  light: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 2000 },
  },
  /** One-shot: single attempt, no retry */
  oneShot: {
    attempts: 1,
    backoff: { type: "fixed" as const, delay: 0 },
  },
} as const satisfies Record<string, RetryPolicy>;

// ========== Dead Letter Queue Config ==========
export interface DeadLetterQueueConfig {
  /** Max retries before moving to DLQ */
  maxRetries: number;
  /** DLQ name suffix appended to original queue name */
  queueSuffix: string;
  /** Auto-clean DLQ jobs older than this (ms). 0 = never clean. */
  ttlMs: number;
}

export const DEFAULT_DLQ_CONFIG: DeadLetterQueueConfig = {
  maxRetries: 5,
  queueSuffix: "-dlq",
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ========== Rate Limiting ==========
export interface RateLimitConfig {
  /** Max jobs per org in the given window */
  max: number;
  /** Window duration in ms */
  windowMs: number;
}

export const RateLimits: Record<string, RateLimitConfig> = {
  hobby: { max: 5, windowMs: 60_000 },
  starter: { max: 20, windowMs: 60_000 },
  pro: { max: 50, windowMs: 60_000 },
  team: { max: 100, windowMs: 60_000 },
  studio: { max: 300, windowMs: 60_000 },
  enterprise: { max: 1000, windowMs: 60_000 },
};

export function getRateLimitForTier(tier: PlanTier): RateLimitConfig {
  return (RateLimits[tier] ?? RateLimits.hobby) as RateLimitConfig;
}

// ========== Priority by Plan Tier ==========
const TIER_PRIORITY_MAP: Record<string, JobPriority> = {
  enterprise: JobPriority.CRITICAL,
  studio: JobPriority.HIGH,
  team: JobPriority.HIGH,
  pro: JobPriority.NORMAL,
  starter: JobPriority.NORMAL,
  hobby: JobPriority.LOW,
};

/** Get BullMQ priority value for a plan tier (lower = higher priority) */
export function getPriorityForTier(tier: PlanTier): JobPriority {
  return (TIER_PRIORITY_MAP[tier] ?? JobPriority.NORMAL) as JobPriority;
}

// ========== Job Data Types ==========

/** agent-task: Full agent execution with session/task context */
export interface AgentTaskData {
  agentRole: AgentRole | null;
  checkpointId?: string;
  creditsReserved: number;
  /** Task IDs that must complete before this task starts */
  dependsOn?: string[];
  description: string | null;
  mode: AgentMode;
  orgId: string;
  parentTaskId?: string;
  planTier: PlanTier;
  projectId: string;
  sessionId: string;
  taskId: string;
  title: string;
  userId: string;
}

/** index-project: File indexing for a project */
export interface IndexProjectData {
  filePaths: string[];
  fullReindex: boolean;
  orgId: string;
  projectId: string;
  triggeredBy: "push" | "manual" | "schedule";
}

/** generate-embeddings: Vector embedding generation for code chunks */
export interface GenerateEmbeddingsData {
  chunks: Array<{
    content: string;
    chunkIndex: number;
  }>;
  filePath: string;
  model: string;
  orgId: string;
  projectId: string;
}

/** send-notification: Email or in-app notification */
export interface SendNotificationData {
  channel: "email" | "in_app" | "both";
  data: Record<string, unknown>;
  orgId: string;
  type:
    | "task_complete"
    | "task_failed"
    | "queue_ready"
    | "credits_low"
    | "weekly_summary"
    | "invite"
    | "security_alert";
  userId: string;
}

/** cleanup-sandbox: Container cleanup after agent run */
export interface CleanupSandboxData {
  orgId: string;
  preserveArtifacts: boolean;
  projectId: string;
  reason: "completed" | "failed" | "timeout" | "manual";
  sandboxId: string;
  sessionId: string;
}

/** usage-rollup: Aggregate usage statistics for a period */
export interface UsageRollupData {
  metrics: {
    tasksCompleted: number;
    creditsUsed: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  };
  orgId: string;
  periodEnd: string; // ISO datetime
  periodStart: string; // ISO datetime
}

/** credit-grant: Monthly or manual credit grants */
export interface CreditGrantData {
  amount: number;
  orgId: string;
  periodEnd: string; // ISO datetime
  periodStart: string; // ISO datetime
  planTier: PlanTier;
  reason: "subscription_monthly" | "bonus" | "refund" | "manual";
}

/** preview-deployment: Build and deploy a preview environment */
export interface PreviewDeploymentData {
  branch?: string;
  deploymentId: string;
  orgId: string;
  projectId: string;
  provider: "vercel" | "netlify" | "cloudflare" | "docker";
  sessionId?: string;
}

/** continue-session: Resume a long-running session from a checkpoint */
export interface ContinueSessionData {
  checkpointId: string;
  iterationBudget: number;
  orgId: string;
  remainingCredits: number;
  sessionId: string;
}

/** credit-reconciliation: Verify credit balance integrity */
export interface ReconciliationData {
  /** When provided, only reconcile this org */
  orgId?: string;
  /** "scheduled" for cron jobs, "manual" for admin-triggered */
  trigger: "scheduled" | "manual";
}

/** webhook-delivery: Outbound webhook delivery to registered endpoints */
export interface WebhookDeliveryData {
  attempt: number;
  event: string;
  payload: Record<string, unknown>;
  subscriptionId: string;
}

/** audit-archival: Archive old audit logs to cold storage */
export interface AuditArchivalData {
  /** If provided, only archive this org. Otherwise archive all orgs. */
  orgId?: string;
  /** "scheduled" for daily cron, "manual" for admin-triggered */
  trigger: "scheduled" | "manual";
}

/** setup-project-environment: Auto-detect stack, install deps, verify build */
export interface SetupProjectEnvironmentData {
  /** Git hosting provider (default: github.com) */
  gitHost?: string;
  /** Encrypted GitHub OAuth token for private repo access and push/PR creation */
  gitToken?: string;
  orgId: string;
  projectId: string;
  /** Optional override for the repo clone URL */
  repoUrl?: string;
  sandboxId: string;
}

// ========== Job Name Registry ==========
export interface JobDataMap {
  "agent-task": AgentTaskData;
  "audit-archival": AuditArchivalData;
  "cleanup-sandbox": CleanupSandboxData;
  "continue-session": ContinueSessionData;
  "credit-grant": CreditGrantData;
  "credit-reconciliation": ReconciliationData;
  "generate-embeddings": GenerateEmbeddingsData;
  "index-project": IndexProjectData;
  "preview-deployment": PreviewDeploymentData;
  "send-notification": SendNotificationData;
  "setup-project-environment": SetupProjectEnvironmentData;
  "usage-rollup": UsageRollupData;
  "webhook-delivery": WebhookDeliveryData;
}

export type JobName = keyof JobDataMap;

// Re-export for backward compat
export type IndexingJobData = IndexProjectData;
export type NotificationJobData = SendNotificationData;
export type BillingEventData = CreditGrantData;
