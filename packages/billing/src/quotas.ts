import { createLogger } from "@prometheus/logger";

const _logger = createLogger("billing:quotas");

export interface PlanQuotas {
  features: {
    fleetMode: boolean;
    moA: boolean;
    customModels: boolean;
    priorityQueue: boolean;
    advancedAnalytics: boolean;
    sso: boolean;
    auditLog: boolean;
    selfHosting: boolean;
  };
  maxApiRequestsPerMinute: number;
  maxConcurrentSessions: number;
  maxCreditsPerMonth: number;
  maxParallelAgents: number;
  maxProjectsPerOrg: number;
  maxStorageGb: number;
  maxTokensPerRequest: number;
}

export const PLAN_QUOTAS: Record<string, PlanQuotas> = {
  hobby: {
    maxCreditsPerMonth: 50,
    maxConcurrentSessions: 1,
    maxParallelAgents: 1,
    maxProjectsPerOrg: 3,
    maxStorageGb: 1,
    maxApiRequestsPerMinute: 10,
    maxTokensPerRequest: 8192,
    features: {
      fleetMode: false,
      moA: false,
      customModels: false,
      priorityQueue: false,
      advancedAnalytics: false,
      sso: false,
      auditLog: false,
      selfHosting: false,
    },
  },
  starter: {
    maxCreditsPerMonth: 500,
    maxConcurrentSessions: 2,
    maxParallelAgents: 2,
    maxProjectsPerOrg: 10,
    maxStorageGb: 5,
    maxApiRequestsPerMinute: 30,
    maxTokensPerRequest: 16_384,
    features: {
      fleetMode: false,
      moA: false,
      customModels: false,
      priorityQueue: false,
      advancedAnalytics: false,
      sso: false,
      auditLog: false,
      selfHosting: false,
    },
  },
  pro: {
    maxCreditsPerMonth: 2000,
    maxConcurrentSessions: 5,
    maxParallelAgents: 5,
    maxProjectsPerOrg: 25,
    maxStorageGb: 20,
    maxApiRequestsPerMinute: 60,
    maxTokensPerRequest: 32_768,
    features: {
      fleetMode: true,
      moA: true,
      customModels: true,
      priorityQueue: true,
      advancedAnalytics: false,
      sso: false,
      auditLog: false,
      selfHosting: false,
    },
  },
  team: {
    maxCreditsPerMonth: 5000,
    maxConcurrentSessions: 10,
    maxParallelAgents: 10,
    maxProjectsPerOrg: 50,
    maxStorageGb: 50,
    maxApiRequestsPerMinute: 120,
    maxTokensPerRequest: 65_536,
    features: {
      fleetMode: true,
      moA: true,
      customModels: true,
      priorityQueue: true,
      advancedAnalytics: true,
      sso: true,
      auditLog: true,
      selfHosting: false,
    },
  },
  studio: {
    maxCreditsPerMonth: 15_000,
    maxConcurrentSessions: 25,
    maxParallelAgents: 25,
    maxProjectsPerOrg: 100,
    maxStorageGb: 200,
    maxApiRequestsPerMinute: 300,
    maxTokensPerRequest: 131_072,
    features: {
      fleetMode: true,
      moA: true,
      customModels: true,
      priorityQueue: true,
      advancedAnalytics: true,
      sso: true,
      auditLog: true,
      selfHosting: true,
    },
  },
  enterprise: {
    maxCreditsPerMonth: -1, // unlimited
    maxConcurrentSessions: 50,
    maxParallelAgents: 50,
    maxProjectsPerOrg: -1, // unlimited
    maxStorageGb: -1, // unlimited
    maxApiRequestsPerMinute: 1000,
    maxTokensPerRequest: 200_000,
    features: {
      fleetMode: true,
      moA: true,
      customModels: true,
      priorityQueue: true,
      advancedAnalytics: true,
      sso: true,
      auditLog: true,
      selfHosting: true,
    },
  },
};

/**
 * Get quotas for a plan tier.
 */
export function getQuotasForPlan(planTier: string): PlanQuotas {
  const hobbyQuotas = PLAN_QUOTAS.hobby;
  if (!hobbyQuotas) {
    throw new Error("hobby plan quotas not found");
  }
  return PLAN_QUOTAS[planTier] ?? hobbyQuotas;
}

/**
 * Check if a specific feature is available for a plan tier.
 */
export function isFeatureAvailable(
  planTier: string,
  feature: keyof PlanQuotas["features"]
): boolean {
  const quotas = getQuotasForPlan(planTier);
  return quotas.features[feature] ?? false;
}

/**
 * Check if an operation would exceed quota.
 */
export function checkQuota(
  planTier: string,
  metric: keyof Omit<PlanQuotas, "features">,
  currentValue: number
): { allowed: boolean; limit: number; current: number; remaining: number } {
  const quotas = getQuotasForPlan(planTier);
  const limit = quotas[metric] as number;

  // -1 means unlimited
  if (limit === -1) {
    return { allowed: true, limit: -1, current: currentValue, remaining: -1 };
  }

  const remaining = Math.max(0, limit - currentValue);
  return {
    allowed: currentValue < limit,
    limit,
    current: currentValue,
    remaining,
  };
}
