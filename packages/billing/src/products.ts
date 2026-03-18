export interface PricingTier {
  name: string;
  stripePriceId: string | null;
  price: number | null;
  creditsIncluded: number | null;
  maxParallelAgents: number | null;
  maxTasksPerDay: number | null;
  features: string[];
}

export const PRICING_TIERS: Record<string, PricingTier> = {
  hobby: {
    name: "Hobby",
    stripePriceId: null,
    price: 0,
    creditsIncluded: 50,
    maxParallelAgents: 1,
    maxTasksPerDay: 5,
    features: ["3 tasks/day", "1 agent", "Community support"],
  },
  starter: {
    name: "Starter",
    stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
    price: 2900,
    creditsIncluded: 500,
    maxParallelAgents: 2,
    maxTasksPerDay: 50,
    features: ["50 tasks/day", "2 agents", "Email support", "Unlimited repos"],
  },
  pro: {
    name: "Pro",
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    price: 7900,
    creditsIncluded: 2000,
    maxParallelAgents: 5,
    maxTasksPerDay: 200,
    features: ["200 tasks/day", "5 agents", "Priority support", "Standard queue"],
  },
  team: {
    name: "Team",
    stripePriceId: process.env.STRIPE_PRICE_TEAM ?? null,
    price: 19900,
    creditsIncluded: 8000,
    maxParallelAgents: 10,
    maxTasksPerDay: 500,
    features: ["500 tasks/day", "10 agents", "Priority queue", "Team management"],
  },
  studio: {
    name: "Studio",
    stripePriceId: process.env.STRIPE_PRICE_STUDIO ?? null,
    price: 49900,
    creditsIncluded: 25000,
    maxParallelAgents: 25,
    maxTasksPerDay: 2000,
    features: ["2000 tasks/day", "25 agents", "Top priority", "Dedicated support"],
  },
  enterprise: {
    name: "Enterprise",
    stripePriceId: null,
    price: null,
    creditsIncluded: null,
    maxParallelAgents: null,
    maxTasksPerDay: null,
    features: ["Unlimited", "Unlimited agents", "On-prem option", "Custom SLA"],
  },
};

export const CREDIT_COSTS = {
  simple_fix: 5,
  medium_task: 25,
  complex_task: 75,
  ask_mode: 2,
  plan_mode: 10,
} as const;
