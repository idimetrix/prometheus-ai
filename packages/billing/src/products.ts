import { z } from "zod";

// ---------------------------------------------------------------------------
// Plan tiers
// ---------------------------------------------------------------------------

export interface PricingTier {
  creditsIncluded: number | null; // monthly grant
  features: string[];
  maxParallelAgents: number | null;
  maxTasksPerDay: number | null;
  name: string;
  price: number | null; // cents (monthly)
  slug: string;
  stripePriceId: string | null;
}

export const PLAN_SLUGS = [
  "hobby",
  "starter",
  "pro",
  "team",
  "studio",
  "enterprise",
] as const;

export type PlanSlug = (typeof PLAN_SLUGS)[number];

export const planSlugSchema = z.enum(PLAN_SLUGS);

export const PRICING_TIERS: Record<PlanSlug, PricingTier> = {
  hobby: {
    name: "Hobby",
    slug: "hobby",
    stripePriceId: null,
    price: 0,
    creditsIncluded: 50,
    maxParallelAgents: 1,
    maxTasksPerDay: 5,
    features: ["5 tasks/day", "1 agent", "Community support"],
  },
  starter: {
    name: "Starter",
    slug: "starter",
    stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
    price: 2900,
    creditsIncluded: 500,
    maxParallelAgents: 2,
    maxTasksPerDay: 50,
    features: ["50 tasks/day", "2 agents", "Email support", "Unlimited repos"],
  },
  pro: {
    name: "Pro",
    slug: "pro",
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    price: 7900,
    creditsIncluded: 2000,
    maxParallelAgents: 5,
    maxTasksPerDay: 200,
    features: [
      "200 tasks/day",
      "5 agents",
      "Priority support",
      "Standard queue",
    ],
  },
  team: {
    name: "Team",
    slug: "team",
    stripePriceId: process.env.STRIPE_PRICE_TEAM ?? null,
    price: 19_900,
    creditsIncluded: 8000,
    maxParallelAgents: 10,
    maxTasksPerDay: 500,
    features: [
      "500 tasks/day",
      "10 agents",
      "Priority queue",
      "Team management",
    ],
  },
  studio: {
    name: "Studio",
    slug: "studio",
    stripePriceId: process.env.STRIPE_PRICE_STUDIO ?? null,
    price: 49_900,
    creditsIncluded: 25_000,
    maxParallelAgents: 25,
    maxTasksPerDay: 2000,
    features: [
      "2000 tasks/day",
      "25 agents",
      "Top priority",
      "Dedicated support",
    ],
  },
  enterprise: {
    name: "Enterprise",
    slug: "enterprise",
    stripePriceId: null,
    price: null,
    creditsIncluded: null,
    maxParallelAgents: null,
    maxTasksPerDay: null,
    features: ["Unlimited", "Unlimited agents", "On-prem option", "Custom SLA"],
  },
};

// Ordered list for upgrade/downgrade comparisons (index = rank)
export const PLAN_RANK: PlanSlug[] = [
  "hobby",
  "starter",
  "pro",
  "team",
  "studio",
  "enterprise",
];

/**
 * Returns positive if `to` is an upgrade, negative if downgrade, 0 if same.
 */
export function comparePlans(from: PlanSlug, to: PlanSlug): number {
  return PLAN_RANK.indexOf(to) - PLAN_RANK.indexOf(from);
}

// ---------------------------------------------------------------------------
// Credit packs (one-time purchases)
// ---------------------------------------------------------------------------

export interface CreditPack {
  credits: number;
  id: string;
  name: string;
  perCreditCents: number; // effective per-credit cost in cents
  priceCents: number; // cents
  priceUsd: number; // dollars
  stripePriceId: string | null;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "credits_100",
    name: "100 Credits",
    credits: 100,
    priceUsd: 10,
    priceCents: 1000,
    stripePriceId: process.env.STRIPE_PRICE_CREDITS_100 ?? null,
    perCreditCents: 10,
  },
  {
    id: "credits_300",
    name: "300 Credits",
    credits: 300,
    priceUsd: 25,
    priceCents: 2500,
    stripePriceId: process.env.STRIPE_PRICE_CREDITS_300 ?? null,
    perCreditCents: 8.33,
  },
  {
    id: "credits_750",
    name: "750 Credits",
    credits: 750,
    priceUsd: 50,
    priceCents: 5000,
    stripePriceId: process.env.STRIPE_PRICE_CREDITS_750 ?? null,
    perCreditCents: 6.67,
  },
  {
    id: "credits_2000",
    name: "2000 Credits",
    credits: 2000,
    priceUsd: 100,
    priceCents: 10_000,
    stripePriceId: process.env.STRIPE_PRICE_CREDITS_2000 ?? null,
    perCreditCents: 5,
  },
];

export function getCreditPackByPriceId(
  priceId: string
): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.stripePriceId === priceId);
}

// ---------------------------------------------------------------------------
// Per-task credit costs
// ---------------------------------------------------------------------------

export const TASK_MODE_COSTS = {
  ask: 2,
  simple: 5,
  plan: 10,
  medium: 25,
  complex: 75,
} as const;

export type TaskMode = keyof typeof TASK_MODE_COSTS;

export const taskModeSchema = z.enum([
  "ask",
  "simple",
  "plan",
  "medium",
  "complex",
]);

/** Legacy alias kept for backward compatibility. */
export const CREDIT_COSTS = {
  simple_fix: 5,
  medium_task: 25,
  complex_task: 75,
  ask_mode: 2,
  plan_mode: 10,
} as const;
