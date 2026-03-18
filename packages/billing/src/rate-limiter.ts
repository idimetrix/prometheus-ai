import { createLogger } from "@prometheus/logger";

const logger = createLogger("billing:rate-limiter");

interface TierLimits {
  maxTasksPerDay: number;
  maxConcurrentAgents: number;
}

const DEFAULT_LIMITS: TierLimits = { maxTasksPerDay: 5, maxConcurrentAgents: 1 };

const TIER_LIMITS: Record<string, TierLimits> = {
  hobby: { maxTasksPerDay: 5, maxConcurrentAgents: 1 },
  starter: { maxTasksPerDay: 50, maxConcurrentAgents: 2 },
  pro: { maxTasksPerDay: 200, maxConcurrentAgents: 5 },
  team: { maxTasksPerDay: 500, maxConcurrentAgents: 10 },
  studio: { maxTasksPerDay: 2000, maxConcurrentAgents: 25 },
  enterprise: { maxTasksPerDay: Infinity, maxConcurrentAgents: Infinity },
};

export class RateLimiter {
  // In-memory counters (TODO: use Redis for distributed rate limiting)
  private dailyCounters = new Map<string, { count: number; resetAt: number }>();

  async checkRateLimit(orgId: string, planTier: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    const limits = TIER_LIMITS[planTier] ?? DEFAULT_LIMITS;
    const counter = this.getOrCreateCounter(orgId);

    if (counter.count >= limits.maxTasksPerDay) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(counter.resetAt),
      };
    }

    return {
      allowed: true,
      remaining: limits.maxTasksPerDay - counter.count,
      resetAt: new Date(counter.resetAt),
    };
  }

  async recordUsage(orgId: string): Promise<void> {
    const counter = this.getOrCreateCounter(orgId);
    counter.count++;
  }

  async checkConcurrency(orgId: string, planTier: string, currentActive: number): Promise<boolean> {
    const limits = TIER_LIMITS[planTier] ?? DEFAULT_LIMITS;
    return currentActive < limits.maxConcurrentAgents;
  }

  getPriorityForTier(planTier: string): number {
    const priorities: Record<string, number> = {
      enterprise: 1,
      studio: 2,
      team: 3,
      pro: 5,
      starter: 8,
      hobby: 10,
    };
    return priorities[planTier] ?? 10;
  }

  private getOrCreateCounter(orgId: string): { count: number; resetAt: number } {
    const now = Date.now();
    let counter = this.dailyCounters.get(orgId);

    if (!counter || now >= counter.resetAt) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      counter = { count: 0, resetAt: tomorrow.getTime() };
      this.dailyCounters.set(orgId, counter);
    }

    return counter;
  }
}
