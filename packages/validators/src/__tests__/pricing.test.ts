import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, PRICING_TIERS } from "../pricing";

describe("PRICING_TIERS", () => {
  it("should have all 6 tiers", () => {
    expect(Object.keys(PRICING_TIERS)).toHaveLength(6);
    expect(PRICING_TIERS).toHaveProperty("hobby");
    expect(PRICING_TIERS).toHaveProperty("starter");
    expect(PRICING_TIERS).toHaveProperty("pro");
    expect(PRICING_TIERS).toHaveProperty("team");
    expect(PRICING_TIERS).toHaveProperty("studio");
    expect(PRICING_TIERS).toHaveProperty("enterprise");
  });

  it("should have hobby tier as free", () => {
    expect(PRICING_TIERS.hobby.price).toBe(0);
    expect(PRICING_TIERS.hobby.creditsIncluded).toBe(50);
  });

  it("should have increasing prices", () => {
    const prices = [
      PRICING_TIERS.hobby.price,
      PRICING_TIERS.starter.price,
      PRICING_TIERS.pro.price,
      PRICING_TIERS.team.price,
      PRICING_TIERS.studio.price,
    ];
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1] as number);
    }
  });

  it("should have increasing credits", () => {
    const credits = [
      PRICING_TIERS.hobby.creditsIncluded as number,
      PRICING_TIERS.starter.creditsIncluded as number,
      PRICING_TIERS.pro.creditsIncluded as number,
      PRICING_TIERS.team.creditsIncluded as number,
      PRICING_TIERS.studio.creditsIncluded as number,
    ];
    for (let i = 1; i < credits.length; i++) {
      expect(credits[i]).toBeGreaterThan(credits[i - 1] as number);
    }
  });

  it("should have features array for each tier", () => {
    for (const tier of Object.values(PRICING_TIERS)) {
      expect(Array.isArray(tier.features)).toBe(true);
      expect(tier.features.length).toBeGreaterThan(0);
    }
  });
});

describe("CREDIT_COSTS", () => {
  it("should have all cost types", () => {
    expect(CREDIT_COSTS.simple_fix).toBe(5);
    expect(CREDIT_COSTS.medium_task).toBe(25);
    expect(CREDIT_COSTS.complex_task).toBe(75);
    expect(CREDIT_COSTS.ask_mode).toBe(2);
    expect(CREDIT_COSTS.plan_mode).toBe(10);
  });

  it("should have increasing costs by complexity", () => {
    expect(CREDIT_COSTS.simple_fix).toBeLessThan(CREDIT_COSTS.medium_task);
    expect(CREDIT_COSTS.medium_task).toBeLessThan(CREDIT_COSTS.complex_task);
  });
});
