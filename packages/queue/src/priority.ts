import { createLogger } from "@prometheus/logger";

const logger = createLogger("queue:priority");

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

export interface QueueRoutingResult {
  concurrency: number;
  priority: number;
  queueName: string;
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
