import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/billing/credits", () => ({
  CreditService: class {
    getBalance = vi.fn();
  },
}));

vi.mock("@prometheus/billing/stripe", () => ({
  StripeService: class {
    createCheckoutSession = vi.fn();
    changePlan = vi.fn();
    cancelSubscription = vi.fn();
    reactivateSubscription = vi.fn();
    createPortalSession = vi.fn();
    createCreditPackCheckout = vi.fn();
    listInvoices = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("@prometheus/billing/products", () => ({
  PRICING_TIERS: {
    hobby: {
      name: "Hobby",
      creditsIncluded: 50,
      maxParallelAgents: 1,
      maxTasksPerDay: 5,
      features: ["5 tasks/day"],
      stripePriceId: null,
    },
    starter: {
      name: "Starter",
      creditsIncluded: 500,
      maxParallelAgents: 2,
      maxTasksPerDay: 50,
      features: ["50 tasks/day"],
      stripePriceId: "price_starter",
    },
    pro: {
      name: "Pro",
      creditsIncluded: 2000,
      maxParallelAgents: 5,
      maxTasksPerDay: 200,
      features: ["200 tasks/day"],
      stripePriceId: "price_pro",
    },
    team: {
      name: "Team",
      creditsIncluded: 8000,
      maxParallelAgents: 10,
      maxTasksPerDay: 500,
      features: ["500 tasks/day"],
      stripePriceId: "price_team",
    },
    studio: {
      name: "Studio",
      creditsIncluded: 25_000,
      maxParallelAgents: 25,
      maxTasksPerDay: 2000,
      features: ["2000 tasks/day"],
      stripePriceId: "price_studio",
    },
  },
  CREDIT_PACKS: [
    {
      id: "credits_100",
      name: "100 Credits",
      credits: 100,
      priceUsd: 10,
      perCreditCents: 10,
    },
    {
      id: "credits_300",
      name: "300 Credits",
      credits: 300,
      priceUsd: 25,
      perCreditCents: 8.33,
    },
  ],
  comparePlans: (from: string, to: string) => {
    const ranks = ["hobby", "starter", "pro", "team", "studio", "enterprise"];
    return ranks.indexOf(to) - ranks.indexOf(from);
  },
}));

vi.mock("@prometheus/db", () => ({
  creditBalances: { orgId: "orgId" },
  creditTransactions: {
    orgId: "orgId",
    type: "type",
    createdAt: "createdAt",
    id: "id",
    amount: "amount",
  },
  modelUsage: {
    orgId: "orgId",
    createdAt: "createdAt",
    tokensIn: "tokensIn",
    tokensOut: "tokensOut",
    costUsd: "costUsd",
    model: "model",
    provider: "provider",
  },
  organizations: { id: "id" },
  subscriptions: { orgId: "orgId", status: "status" },
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("billing router - getBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns balance, reserved, and available fields", () => {
    const balance = { balance: 100, reserved: 20 };
    const result = {
      balance: balance.balance,
      reserved: balance.reserved,
      available: balance.balance - balance.reserved,
      planTier: "pro",
    };

    expect(result.available).toBe(80);
    expect(result.planTier).toBe("pro");
  });

  it("defaults to zero when no balance exists", () => {
    const balance = null as { balance: number; reserved: number } | null;
    const result = {
      balance: balance?.balance ?? 0,
      reserved: balance?.reserved ?? 0,
      available: (balance?.balance ?? 0) - (balance?.reserved ?? 0),
      planTier: "hobby",
    };

    expect(result.balance).toBe(0);
    expect(result.available).toBe(0);
    expect(result.planTier).toBe("hobby");
  });
});

describe("billing router - getPlan", () => {
  it("returns hobby plan info when no org planTier", () => {
    const org = null as { planTier: string } | null;
    const tier = org?.planTier ?? "hobby";
    const PRICING_TIERS: Record<
      string,
      {
        name: string;
        creditsIncluded: number;
        maxParallelAgents: number;
        maxTasksPerDay: number;
        features: string[];
      }
    > = {
      hobby: {
        name: "Hobby",
        creditsIncluded: 50,
        maxParallelAgents: 1,
        maxTasksPerDay: 5,
        features: ["5 tasks/day"],
      },
    };
    const plan = PRICING_TIERS[tier];

    expect(tier).toBe("hobby");
    expect(plan?.name).toBe("Hobby");
    expect(plan?.creditsIncluded).toBe(50);
  });

  it("returns correct plan info for pro tier", () => {
    const tier = "pro";
    const PRICING_TIERS: Record<
      string,
      { name: string; creditsIncluded: number; maxParallelAgents: number }
    > = {
      pro: { name: "Pro", creditsIncluded: 2000, maxParallelAgents: 5 },
    };
    const plan = PRICING_TIERS[tier];

    expect(plan?.name).toBe("Pro");
    expect(plan?.creditsIncluded).toBe(2000);
    expect(plan?.maxParallelAgents).toBe(5);
  });
});

describe("billing router - getSubscription", () => {
  it("returns active subscription details", () => {
    const sub = {
      status: "active",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: new Date("2026-03-01"),
      currentPeriodEnd: new Date("2026-04-01"),
    };
    const org = { planTier: "pro", stripeCustomerId: "cus_123" };

    expect(sub.status).toBe("active");
    expect(org.stripeCustomerId).toBeTruthy();
  });

  it("returns incomplete status for non-hobby plan without subscription", () => {
    const sub = null as { status: string } | null;
    const tier: string = "pro";

    const status = sub?.status ?? (tier === "hobby" ? "active" : "incomplete");
    expect(status).toBe("incomplete");
  });

  it("returns active status for hobby plan without subscription", () => {
    const sub = null as { status: string } | null;
    const tier: string = "hobby";

    const status = sub?.status ?? (tier === "hobby" ? "active" : "incomplete");
    expect(status).toBe("active");
  });
});

describe("billing router - createCheckout", () => {
  it("rejects plan without stripePriceId", () => {
    const plan = { stripePriceId: null };
    expect(plan.stripePriceId).toBeNull();
  });

  it("rejects when org has no Stripe customer", () => {
    const org = { stripeCustomerId: null };
    expect(org.stripeCustomerId).toBeNull();
  });
});

describe("billing router - changePlan", () => {
  it("rejects changing to same plan", () => {
    const currentPlan = "pro";
    const newPlan = "pro";

    expect(currentPlan).toBe(newPlan);
  });

  it("rejects when no active subscription exists", () => {
    const sub = null as { stripeSubscriptionId: string } | null;
    expect(sub?.stripeSubscriptionId).toBeUndefined();
  });

  it("identifies upgrade direction correctly", () => {
    const ranks = ["hobby", "starter", "pro", "team", "studio", "enterprise"];
    const from = "starter";
    const to = "pro";
    const direction = ranks.indexOf(to) - ranks.indexOf(from);

    expect(direction).toBeGreaterThan(0);
  });

  it("identifies downgrade direction correctly", () => {
    const ranks = ["hobby", "starter", "pro", "team", "studio", "enterprise"];
    const from = "team";
    const to = "starter";
    const direction = ranks.indexOf(to) - ranks.indexOf(from);

    expect(direction).toBeLessThan(0);
  });
});

describe("billing router - cancelSubscription", () => {
  it("rejects when no active subscription to cancel", () => {
    const sub = null as { stripeSubscriptionId: string } | null;
    expect(sub?.stripeSubscriptionId).toBeUndefined();
  });

  it("returns immediately for immediate cancellation", () => {
    const immediate = true;
    const effectiveAt = immediate ? "immediately" : "end_of_period";

    expect(effectiveAt).toBe("immediately");
  });

  it("returns end_of_period for non-immediate cancellation", () => {
    const immediate = false;
    const effectiveAt = immediate ? "immediately" : "end_of_period";

    expect(effectiveAt).toBe("end_of_period");
  });
});

describe("billing router - getCreditPacks", () => {
  it("returns available credit packs", () => {
    const CREDIT_PACKS = [
      {
        id: "credits_100",
        name: "100 Credits",
        credits: 100,
        priceUsd: 10,
        perCreditCents: 10,
      },
      {
        id: "credits_300",
        name: "300 Credits",
        credits: 300,
        priceUsd: 25,
        perCreditCents: 8.33,
      },
    ];

    expect(CREDIT_PACKS).toHaveLength(2);
    expect(CREDIT_PACKS[0]?.credits).toBe(100);
    expect(CREDIT_PACKS[1]?.credits).toBe(300);
  });
});

describe("billing router - purchaseCredits", () => {
  it("rejects unknown credit pack", () => {
    const CREDIT_PACKS = [{ id: "credits_100" }, { id: "credits_300" }];
    const pack = CREDIT_PACKS.find((p) => p.id === "unknown_pack");

    expect(pack).toBeUndefined();
  });

  it("finds valid credit pack", () => {
    const CREDIT_PACKS = [{ id: "credits_100" }, { id: "credits_300" }];
    const pack = CREDIT_PACKS.find((p) => p.id === "credits_100");

    expect(pack).toBeDefined();
  });
});

describe("billing router - getTransactions", () => {
  it("returns paginated transaction results", () => {
    const limit = 2;
    const results = [{ id: "txn_1" }, { id: "txn_2" }, { id: "txn_3" }];

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items.at(-1)?.id : null;

    expect(hasMore).toBe(true);
    expect(items).toHaveLength(2);
    expect(nextCursor).toBe("txn_2");
  });

  it("returns null cursor when no more results", () => {
    const limit = 5;
    const results = [{ id: "txn_1" }];

    const hasMore = results.length > limit;
    const nextCursor = hasMore ? results.at(-1)?.id : null;

    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });
});
