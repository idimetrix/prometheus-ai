import { describe, expect, it } from "vitest";
import {
  CREDIT_COSTS,
  CREDIT_PACKS,
  comparePlans,
  getCreditPackByPriceId,
  PLAN_RANK,
  PLAN_SLUGS,
  PRICING_TIERS,
  TASK_MODE_COSTS,
} from "../products";

describe("PRICING_TIERS", () => {
  it("defines all plan slugs", () => {
    for (const slug of PLAN_SLUGS) {
      expect(PRICING_TIERS[slug]).toBeDefined();
      expect(PRICING_TIERS[slug].name).toBeTruthy();
    }
  });

  it("hobby plan is free with 50 credits", () => {
    const hobby = PRICING_TIERS.hobby;
    expect(hobby.price).toBe(0);
    expect(hobby.creditsIncluded).toBe(50);
    expect(hobby.maxParallelAgents).toBe(1);
    expect(hobby.maxTasksPerDay).toBe(5);
  });

  it("enterprise plan has null limits (custom)", () => {
    const enterprise = PRICING_TIERS.enterprise;
    expect(enterprise.price).toBeNull();
    expect(enterprise.creditsIncluded).toBeNull();
    expect(enterprise.maxParallelAgents).toBeNull();
    expect(enterprise.maxTasksPerDay).toBeNull();
  });

  it("plans are in ascending order of credits", () => {
    const ordered = ["hobby", "starter", "pro", "team", "studio"] as const;
    for (let i = 0; i < ordered.length - 1; i++) {
      const key = ordered[i] ?? "hobby";
      const nextKey = ordered[i + 1] ?? "starter";
      const current = PRICING_TIERS[key];
      const next = PRICING_TIERS[nextKey];
      expect(current.creditsIncluded ?? 0).toBeLessThan(
        next.creditsIncluded ?? 0
      );
    }
  });
});

describe("comparePlans", () => {
  it("returns positive for upgrade", () => {
    expect(comparePlans("hobby", "pro")).toBeGreaterThan(0);
    expect(comparePlans("starter", "team")).toBeGreaterThan(0);
  });

  it("returns negative for downgrade", () => {
    expect(comparePlans("pro", "hobby")).toBeLessThan(0);
    expect(comparePlans("studio", "starter")).toBeLessThan(0);
  });

  it("returns 0 for same plan", () => {
    expect(comparePlans("pro", "pro")).toBe(0);
    expect(comparePlans("hobby", "hobby")).toBe(0);
  });
});

describe("PLAN_RANK", () => {
  it("has all plan slugs in order", () => {
    expect(PLAN_RANK).toEqual([
      "hobby",
      "starter",
      "pro",
      "team",
      "studio",
      "enterprise",
    ]);
  });
});

describe("CREDIT_PACKS", () => {
  it("has 4 credit packs", () => {
    expect(CREDIT_PACKS).toHaveLength(4);
  });

  it("packs are in ascending order of credits", () => {
    for (let i = 0; i < CREDIT_PACKS.length - 1; i++) {
      expect(CREDIT_PACKS[i]?.credits ?? 0).toBeLessThan(
        CREDIT_PACKS[i + 1]?.credits ?? 0
      );
    }
  });

  it("per-credit cost decreases with larger packs", () => {
    for (let i = 0; i < CREDIT_PACKS.length - 1; i++) {
      expect(CREDIT_PACKS[i]?.perCreditCents ?? 0).toBeGreaterThan(
        CREDIT_PACKS[i + 1]?.perCreditCents ?? 0
      );
    }
  });
});

describe("getCreditPackByPriceId", () => {
  it("returns undefined for unknown price ID", () => {
    expect(getCreditPackByPriceId("nonexistent")).toBeUndefined();
  });

  it("returns pack when price ID matches", () => {
    // Only works if env vars are set; test the logic
    const pack = CREDIT_PACKS.find((p) => p.stripePriceId !== null);
    if (pack?.stripePriceId) {
      const found = getCreditPackByPriceId(pack.stripePriceId);
      expect(found?.id).toBe(pack.id);
    }
  });
});

describe("TASK_MODE_COSTS", () => {
  it("has correct cost values", () => {
    expect(TASK_MODE_COSTS.ask).toBe(2);
    expect(TASK_MODE_COSTS.simple).toBe(5);
    expect(TASK_MODE_COSTS.plan).toBe(10);
    expect(TASK_MODE_COSTS.medium).toBe(25);
    expect(TASK_MODE_COSTS.complex).toBe(75);
  });
});

describe("CREDIT_COSTS (legacy)", () => {
  it("has backward-compatible cost values", () => {
    expect(CREDIT_COSTS.simple_fix).toBe(5);
    expect(CREDIT_COSTS.medium_task).toBe(25);
    expect(CREDIT_COSTS.complex_task).toBe(75);
    expect(CREDIT_COSTS.ask_mode).toBe(2);
    expect(CREDIT_COSTS.plan_mode).toBe(10);
  });
});
