import { describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@prometheus/db", () => ({
  db: {
    query: {
      creditBalances: { findFirst: vi.fn() },
      creditReservations: { findFirst: vi.fn(), findMany: vi.fn() },
      creditTransactions: { findMany: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
      })),
    })),
  },
  creditBalances: { orgId: "orgId", balance: "balance", reserved: "reserved" },
  creditReservations: {
    id: "id",
    orgId: "orgId",
    status: "status",
    expiresAt: "expiresAt",
  },
  creditTransactions: {
    orgId: "orgId",
    type: "type",
    amount: "amount",
    createdAt: "createdAt",
  },
  modelUsage: {
    orgId: "orgId",
    tokensIn: "tokensIn",
    tokensOut: "tokensOut",
    costUsd: "costUsd",
    createdAt: "createdAt",
    taskId: "taskId",
    model: "model",
  },
  usageRollups: {},
  organizations: {},
  subscriptions: {},
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@prometheus/utils", () => ({
  generateId: (prefix: string) => `${prefix}_test123`,
}));

vi.mock("@prometheus/queue", () => ({
  createRedisConnection: () => ({
    get: vi.fn().mockResolvedValue(null),
    pipeline: vi.fn(() => ({
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
  }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  lt: vi.fn((...args: unknown[]) => ({ type: "lt", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  lte: vi.fn((...args: unknown[]) => ({ type: "lte", args })),
  sql: vi.fn(),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { CreditService } from "../credits";
import {
  CREDIT_COSTS,
  CREDIT_PACKS,
  comparePlans,
  getCreditPackByPriceId,
  PLAN_RANK,
  PLAN_SLUGS,
  PRICING_TIERS,
  planSlugSchema,
  TASK_MODE_COSTS,
  taskModeSchema,
} from "../products";
import {
  checkQuota,
  getQuotasForPlan,
  isFeatureAvailable,
  PLAN_QUOTAS,
} from "../quotas";
import { RateLimiter } from "../rate-limiter";

// ── Products Tests ───────────────────────────────────────────────────────────

describe("PLAN_SLUGS", () => {
  it("contains all 6 plan tiers", () => {
    expect(PLAN_SLUGS).toEqual([
      "hobby",
      "starter",
      "pro",
      "team",
      "studio",
      "enterprise",
    ]);
  });

  it("planSlugSchema validates known slugs", () => {
    expect(planSlugSchema.safeParse("pro").success).toBe(true);
    expect(planSlugSchema.safeParse("hobby").success).toBe(true);
  });

  it("planSlugSchema rejects unknown slugs", () => {
    expect(planSlugSchema.safeParse("platinum").success).toBe(false);
  });
});

describe("PRICING_TIERS", () => {
  it("hobby tier is free", () => {
    expect(PRICING_TIERS.hobby.price).toBe(0);
  });

  it("hobby tier includes 50 credits", () => {
    expect(PRICING_TIERS.hobby.creditsIncluded).toBe(50);
  });

  it("enterprise tier has no fixed price", () => {
    expect(PRICING_TIERS.enterprise.price).toBeNull();
  });

  it("enterprise tier has no credit limit", () => {
    expect(PRICING_TIERS.enterprise.creditsIncluded).toBeNull();
  });

  it("all plan tiers have a name and slug", () => {
    for (const slug of PLAN_SLUGS) {
      const tier = PRICING_TIERS[slug];
      expect(tier.name).toBeTruthy();
      expect(tier.slug).toBe(slug);
    }
  });

  it("prices increase as tiers go up (excluding enterprise)", () => {
    const paidTiers = ["starter", "pro", "team", "studio"] as const;
    for (let i = 0; i < paidTiers.length - 1; i++) {
      const currentTier = paidTiers[i] ?? "starter";
      const nextTier = paidTiers[i + 1] ?? "pro";
      const current = PRICING_TIERS[currentTier].price ?? 0;
      const next = PRICING_TIERS[nextTier].price ?? 0;
      expect(next).toBeGreaterThan(current);
    }
  });
});

describe("comparePlans", () => {
  it("returns positive for upgrade", () => {
    expect(comparePlans("hobby", "pro")).toBeGreaterThan(0);
  });

  it("returns negative for downgrade", () => {
    expect(comparePlans("pro", "hobby")).toBeLessThan(0);
  });

  it("returns 0 for same plan", () => {
    expect(comparePlans("pro", "pro")).toBe(0);
  });

  it("correctly compares adjacent plans", () => {
    expect(comparePlans("starter", "pro")).toBe(1);
  });
});

describe("PLAN_RANK", () => {
  it("orders plans from hobby to enterprise", () => {
    expect(PLAN_RANK[0]).toBe("hobby");
    expect(PLAN_RANK.at(-1)).toBe("enterprise");
  });
});

describe("TASK_MODE_COSTS", () => {
  it("ask mode costs 2 credits", () => {
    expect(TASK_MODE_COSTS.ask).toBe(2);
  });

  it("simple mode costs 5 credits", () => {
    expect(TASK_MODE_COSTS.simple).toBe(5);
  });

  it("complex mode costs 75 credits", () => {
    expect(TASK_MODE_COSTS.complex).toBe(75);
  });

  it("costs increase with complexity", () => {
    expect(TASK_MODE_COSTS.ask).toBeLessThan(TASK_MODE_COSTS.simple);
    expect(TASK_MODE_COSTS.simple).toBeLessThan(TASK_MODE_COSTS.medium);
    expect(TASK_MODE_COSTS.medium).toBeLessThan(TASK_MODE_COSTS.complex);
  });
});

describe("taskModeSchema", () => {
  it("validates known modes", () => {
    expect(taskModeSchema.safeParse("ask").success).toBe(true);
    expect(taskModeSchema.safeParse("complex").success).toBe(true);
  });

  it("rejects unknown modes", () => {
    expect(taskModeSchema.safeParse("ultra").success).toBe(false);
  });
});

describe("CREDIT_PACKS", () => {
  it("has 4 credit pack options", () => {
    expect(CREDIT_PACKS).toHaveLength(4);
  });

  it("larger packs have lower per-credit cost", () => {
    for (let i = 0; i < CREDIT_PACKS.length - 1; i++) {
      expect(CREDIT_PACKS[i]?.perCreditCents).toBeGreaterThan(
        CREDIT_PACKS[i + 1]?.perCreditCents ?? 0
      );
    }
  });

  it("all packs have an id, name, and credits", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.id).toBeTruthy();
      expect(pack.name).toBeTruthy();
      expect(pack.credits).toBeGreaterThan(0);
      expect(pack.priceUsd).toBeGreaterThan(0);
    }
  });
});

describe("getCreditPackByPriceId", () => {
  it("returns undefined for unknown price IDs", () => {
    expect(getCreditPackByPriceId("price_nonexistent")).toBeUndefined();
  });
});

describe("CREDIT_COSTS (legacy)", () => {
  it("defines legacy cost aliases", () => {
    expect(CREDIT_COSTS.simple_fix).toBe(5);
    expect(CREDIT_COSTS.medium_task).toBe(25);
    expect(CREDIT_COSTS.complex_task).toBe(75);
    expect(CREDIT_COSTS.ask_mode).toBe(2);
    expect(CREDIT_COSTS.plan_mode).toBe(10);
  });
});

// ── Quotas Tests ─────────────────────────────────────────────────────────────

describe("PLAN_QUOTAS", () => {
  it("defines quotas for all plan tiers", () => {
    for (const slug of PLAN_SLUGS) {
      expect(PLAN_QUOTAS[slug]).toBeDefined();
    }
  });

  it("enterprise has unlimited credits per month (-1)", () => {
    expect(PLAN_QUOTAS.enterprise?.maxCreditsPerMonth).toBe(-1);
  });

  it("hobby tier has 1 max concurrent session", () => {
    expect(PLAN_QUOTAS.hobby?.maxConcurrentSessions).toBe(1);
  });
});

describe("getQuotasForPlan", () => {
  it("returns correct quotas for known plans", () => {
    const proQuotas = getQuotasForPlan("pro");
    expect(proQuotas.maxCreditsPerMonth).toBe(2000);
    expect(proQuotas.maxParallelAgents).toBe(5);
  });

  it("falls back to hobby for unknown plans", () => {
    const quotas = getQuotasForPlan("nonexistent");
    expect(quotas.maxCreditsPerMonth).toBe(50);
  });
});

describe("isFeatureAvailable", () => {
  it("hobby does not have fleetMode", () => {
    expect(isFeatureAvailable("hobby", "fleetMode")).toBe(false);
  });

  it("pro has fleetMode", () => {
    expect(isFeatureAvailable("pro", "fleetMode")).toBe(true);
  });

  it("enterprise has all features", () => {
    expect(isFeatureAvailable("enterprise", "sso")).toBe(true);
    expect(isFeatureAvailable("enterprise", "selfHosting")).toBe(true);
    expect(isFeatureAvailable("enterprise", "auditLog")).toBe(true);
  });

  it("hobby has no advanced features", () => {
    expect(isFeatureAvailable("hobby", "sso")).toBe(false);
    expect(isFeatureAvailable("hobby", "selfHosting")).toBe(false);
    expect(isFeatureAvailable("hobby", "moA")).toBe(false);
  });
});

describe("checkQuota", () => {
  it("allows when under quota", () => {
    const result = checkQuota("pro", "maxProjectsPerOrg", 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(15);
  });

  it("denies when at quota", () => {
    const result = checkQuota("hobby", "maxProjectsPerOrg", 3);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("returns unlimited for enterprise with -1 limits", () => {
    const result = checkQuota("enterprise", "maxCreditsPerMonth", 999_999);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1);
    expect(result.remaining).toBe(-1);
  });
});

// ── CreditService Tests ─────────────────────────────────────────────────────

describe("CreditService", () => {
  it("creates an instance", () => {
    const service = new CreditService();
    expect(service).toBeDefined();
  });

  it("estimateTaskCost returns correct cost for known modes", () => {
    const service = new CreditService();
    expect(service.estimateTaskCost("ask")).toBe(2);
    expect(service.estimateTaskCost("simple")).toBe(5);
    expect(service.estimateTaskCost("medium")).toBe(25);
    expect(service.estimateTaskCost("complex")).toBe(75);
  });

  it("estimateTaskCost falls back to complexity parameter", () => {
    const service = new CreditService();
    expect(service.estimateTaskCost("unknown", "simple")).toBe(5);
    expect(service.estimateTaskCost("unknown", "complex")).toBe(75);
  });

  it("estimateTaskCost defaults to medium cost for unknown inputs", () => {
    const service = new CreditService();
    expect(service.estimateTaskCost("unknown")).toBe(TASK_MODE_COSTS.medium);
  });
});

// ── RateLimiter Tests ────────────────────────────────────────────────────────

describe("RateLimiter", () => {
  it("creates an instance", () => {
    const limiter = new RateLimiter();
    expect(limiter).toBeDefined();
  });

  it("checkConcurrency allows when below limit", () => {
    const limiter = new RateLimiter();
    expect(limiter.checkConcurrency("org_1", "pro", 3)).toBe(true);
  });

  it("checkConcurrency denies when at limit", () => {
    const limiter = new RateLimiter();
    expect(limiter.checkConcurrency("org_1", "hobby", 1)).toBe(false);
  });

  it("checkConcurrency allows unlimited for enterprise", () => {
    const limiter = new RateLimiter();
    expect(limiter.checkConcurrency("org_1", "enterprise", 100)).toBe(true);
  });

  it("getPriorityForTier returns correct priorities", () => {
    const limiter = new RateLimiter();
    expect(limiter.getPriorityForTier("enterprise")).toBe(1);
    expect(limiter.getPriorityForTier("hobby")).toBe(10);
  });

  it("getPriorityForTier defaults to 10 for unknown tiers", () => {
    const limiter = new RateLimiter();
    expect(limiter.getPriorityForTier("unknown")).toBe(10);
  });

  it("getEstimatedWait returns 0 for enterprise", () => {
    const limiter = new RateLimiter();
    expect(limiter.getEstimatedWait("org_1", "enterprise")).toBe(0);
  });

  it("getEstimatedWait returns higher wait for lower tiers", () => {
    const limiter = new RateLimiter();
    const enterpriseWait = limiter.getEstimatedWait("org_1", "enterprise");
    const hobbyWait = limiter.getEstimatedWait("org_1", "hobby");
    expect(hobbyWait).toBeGreaterThan(enterpriseWait);
  });
});
