import { createLogger } from "@prometheus/logger";

const logger = createLogger("queue:priority");

/** Priority levels: lower = higher priority */
export const PriorityLevel = {
  Critical: 0,
  High: 1,
  Normal: 2,
  Low: 3,
  Background: 4,
} as const;

export type PriorityLevel = (typeof PriorityLevel)[keyof typeof PriorityLevel];

/** Priority values: lower = higher priority */
export const TIER_PRIORITY: Record<string, number> = {
  enterprise: 1,
  studio: 5,
  team: 10,
  pro: 20,
  starter: 50,
  hobby: 100,
};

/** Max concurrent jobs per tier */
export const TIER_CONCURRENCY: Record<string, number> = {
  enterprise: 50,
  studio: 25,
  team: 10,
  pro: 5,
  starter: 2,
  hobby: 1,
};

/** Aging configuration */
const AGING_CONFIG = {
  /** Time in ms before priority boost kicks in */
  thresholdMs: 5 * 60 * 1000, // 5 minutes
  /** Priority boost applied after threshold */
  boostAmount: 10,
  /** Maximum boost that can be applied */
  maxBoost: 50,
};

/** Fair scheduling: max capacity share per org */
const FAIR_SCHEDULING = {
  /** Maximum percentage of total capacity any single org can use */
  maxOrgCapacityPercent: 30,
  /** Total capacity units */
  totalCapacity: 100,
};

/** Enterprise tiers eligible for preemption */
const PREEMPTION_TIERS = new Set(["enterprise", "studio"]);

export interface QueueRoutingResult {
  concurrency: number;
  priority: number;
  queueName: string;
}

/** Extended job metadata for priority scheduling */
export interface PriorityJobMeta {
  /** Whether this job can preempt lower-priority jobs */
  canPreempt: boolean;
  /** The effective priority after aging */
  effectivePriority: number;
  /** Time the job was enqueued */
  enqueuedAt: number;
  /** Organization ID for fair scheduling */
  orgId: string;
  /** Original priority at enqueue time */
  originalPriority: number;
  /** Plan tier */
  planTier: string;
}

/**
 * Route a task to the appropriate queue with correct priority
 * based on the organization's plan tier.
 */
export function routeTaskToQueue(
  planTier: string,
  taskType = "default"
): QueueRoutingResult {
  const priority = TIER_PRIORITY[planTier] ?? TIER_PRIORITY.hobby ?? 100;
  const concurrency = TIER_CONCURRENCY[planTier] ?? TIER_CONCURRENCY.hobby ?? 1;

  // High-priority tiers get their own queue for isolation
  let queueName: string;
  if (priority <= 5) {
    queueName = "tasks:priority";
  } else if (priority <= 20) {
    queueName = "tasks:standard";
  } else {
    queueName = "tasks:default";
  }

  logger.debug(
    { planTier, queueName, priority, concurrency, taskType },
    "Task routed to queue"
  );

  return { queueName, priority, concurrency };
}

/**
 * Get the concurrency limit for a specific tier.
 */
export function getConcurrencyForTier(planTier: string): number {
  return TIER_CONCURRENCY[planTier] ?? 1;
}

/**
 * Calculate effective priority with aging boost.
 *
 * Jobs waiting longer than the threshold get a priority boost,
 * preventing starvation of low-priority tasks.
 */
export function calculateEffectivePriority(
  originalPriority: number,
  enqueuedAt: number,
  now = Date.now()
): number {
  const waitTimeMs = now - enqueuedAt;

  if (waitTimeMs < AGING_CONFIG.thresholdMs) {
    return originalPriority;
  }

  // Calculate boost based on how many threshold periods have elapsed
  const periods = Math.floor(waitTimeMs / AGING_CONFIG.thresholdMs);
  const boost = Math.min(
    periods * AGING_CONFIG.boostAmount,
    AGING_CONFIG.maxBoost
  );

  const effective = Math.max(0, originalPriority - boost);

  logger.debug(
    { originalPriority, effective, waitTimeMs, boost },
    "Priority aged"
  );

  return effective;
}

/**
 * Check if an organization has exceeded its fair share of capacity.
 *
 * Prevents any single org from consuming more than 30% of total capacity.
 */
export function checkFairScheduling(
  orgId: string,
  currentOrgJobs: number,
  totalActiveJobs: number
): { allowed: boolean; reason?: string } {
  if (totalActiveJobs === 0) {
    return { allowed: true };
  }

  const orgPercent = (currentOrgJobs / totalActiveJobs) * 100;
  const maxPercent = FAIR_SCHEDULING.maxOrgCapacityPercent;

  if (orgPercent >= maxPercent && totalActiveJobs > 3) {
    logger.warn(
      { orgId, orgPercent, maxPercent, currentOrgJobs, totalActiveJobs },
      "Fair scheduling limit reached"
    );
    return {
      allowed: false,
      reason: `Organization ${orgId} is using ${orgPercent.toFixed(1)}% of capacity (max ${maxPercent}%)`,
    };
  }

  return { allowed: true };
}

/**
 * Determine if a job from a higher tier can preempt a lower-priority job.
 *
 * Only enterprise and studio tiers can preempt, and only when their
 * priority is significantly higher than the running job.
 */
export function canPreempt(
  incomingTier: string,
  incomingPriority: number,
  runningPriority: number
): boolean {
  if (!PREEMPTION_TIERS.has(incomingTier)) {
    return false;
  }

  // Must be significantly higher priority (lower number)
  const priorityGap = runningPriority - incomingPriority;
  return priorityGap >= 20;
}

/**
 * Create priority job metadata for a new job.
 */
export function createPriorityJobMeta(
  orgId: string,
  planTier: string
): PriorityJobMeta {
  const priority = TIER_PRIORITY[planTier] ?? TIER_PRIORITY.hobby ?? 100;

  return {
    effectivePriority: priority,
    originalPriority: priority,
    orgId,
    planTier,
    enqueuedAt: Date.now(),
    canPreempt: PREEMPTION_TIERS.has(planTier),
  };
}
