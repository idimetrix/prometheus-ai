import { describe, expect, it } from "vitest";
import { createFeatureFlags, DEFAULT_FLAGS, isEnabled } from "../index";

describe("createFeatureFlags - extended coverage", () => {
  describe("percentage rollout determinism", () => {
    it("same userId always gets the same result for the same flag", () => {
      const results: boolean[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(
          isEnabled("experimental.streaming-diffs", { userId: "stable_user" })
        );
      }
      const allSame = results.every((r) => r === results[0]);
      expect(allSame).toBe(true);
    });

    it("different userIds may get different results for percentage flag", () => {
      const results = new Set<boolean>();
      // Try enough users that statistically some should be true and some false
      for (let i = 0; i < 1000; i++) {
        results.add(
          isEnabled("experimental.streaming-diffs", {
            userId: `user_${i}`,
          })
        );
      }
      // With 10% rollout, we expect both true and false across 1000 users
      expect(results.size).toBe(2);
    });
  });

  describe("tier restrictions with percentage", () => {
    it("tier restriction is checked before percentage rollout", () => {
      const ff = createFeatureFlags({
        "tier-and-pct": {
          key: "tier-and-pct",
          description: "Test flag with both tier and percentage",
          defaultEnabled: true,
          allowedTiers: ["pro"],
          percentage: 100,
        },
      });

      // No tier: blocked by tier check
      expect(ff.isEnabled("tier-and-pct", { userId: "u1" })).toBe(false);

      // Wrong tier: blocked
      expect(
        ff.isEnabled("tier-and-pct", { userId: "u1", tier: "hobby" })
      ).toBe(false);

      // Correct tier + 100%: allowed
      expect(ff.isEnabled("tier-and-pct", { userId: "u1", tier: "pro" })).toBe(
        true
      );
    });
  });

  describe("override precedence", () => {
    it("override=true overrides tier restriction", () => {
      expect(
        isEnabled("agent.browser-tool", {
          tier: "hobby",
          overrides: { "agent.browser-tool": true },
        })
      ).toBe(true);
    });

    it("override=false overrides development mode", () => {
      expect(
        isEnabled("agent.auto-fix", {
          environment: "development",
          overrides: { "agent.auto-fix": false },
        })
      ).toBe(false);
    });

    it("override=true for undefined flag still returns true", () => {
      expect(
        isEnabled("does.not.exist", {
          overrides: { "does.not.exist": true },
        })
      ).toBe(true);
    });

    it("override=false for undefined flag returns false", () => {
      expect(
        isEnabled("does.not.exist", {
          overrides: { "does.not.exist": false },
        })
      ).toBe(false);
    });
  });

  describe("custom flag provider", () => {
    it("merges custom and default flags", () => {
      const ff = createFeatureFlags({
        "my.custom.flag": {
          key: "my.custom.flag",
          description: "Custom",
          defaultEnabled: true,
        },
      });

      // Custom flag
      expect(ff.isEnabled("my.custom.flag")).toBe(true);
      // Default flags still available
      expect(ff.isEnabled("agent.auto-fix")).toBe(true);
    });

    it("supports custom flags with all features", () => {
      const ff = createFeatureFlags({
        "custom.gated": {
          key: "custom.gated",
          description: "Gated custom flag",
          defaultEnabled: true,
          allowedTiers: ["enterprise"],
          percentage: 50,
        },
      });

      // No tier: blocked
      expect(ff.isEnabled("custom.gated", { userId: "u1" })).toBe(false);

      // Correct tier, need userId for percentage check
      expect(ff.isEnabled("custom.gated", { tier: "enterprise" })).toBe(false);

      // Correct tier + userId: result depends on hash
      const result = ff.isEnabled("custom.gated", {
        tier: "enterprise",
        userId: "test_user",
      });
      expect(typeof result).toBe("boolean");
    });
  });

  describe("getEnabledFlags edge cases", () => {
    it("returns different sets for different tiers", () => {
      const ff = createFeatureFlags();
      const hobbyFlags = ff.getEnabledFlags({ tier: "hobby" });
      const enterpriseFlags = ff.getEnabledFlags({ tier: "enterprise" });

      // Enterprise should have access to more tier-gated flags
      expect(enterpriseFlags.length).toBeGreaterThanOrEqual(hobbyFlags.length);
    });

    it("returns all flags including custom ones", () => {
      const ff = createFeatureFlags({
        "custom.test": {
          key: "custom.test",
          description: "A custom flag",
          defaultEnabled: true,
        },
      });

      const enabled = ff.getEnabledFlags();
      expect(enabled).toContain("custom.test");
    });
  });

  describe("getAllFlags", () => {
    it("returns a copy of flags", () => {
      const ff = createFeatureFlags();
      const flags1 = ff.getAllFlags();
      const flags2 = ff.getAllFlags();
      expect(flags1).toEqual(flags2);
      expect(flags1).not.toBe(flags2);
    });

    it("includes all default flags", () => {
      const ff = createFeatureFlags();
      const flags = ff.getAllFlags();
      for (const key of Object.keys(DEFAULT_FLAGS)) {
        expect(flags).toHaveProperty(key);
      }
    });
  });

  describe("DEFAULT_FLAGS data integrity", () => {
    it("all flags with allowedTiers have non-empty arrays", () => {
      for (const flag of Object.values(DEFAULT_FLAGS)) {
        if (flag.allowedTiers) {
          expect(flag.allowedTiers.length).toBeGreaterThan(0);
        }
      }
    });

    it("has flags in each category", () => {
      const keys = Object.keys(DEFAULT_FLAGS);
      const categories = new Set(keys.map((k) => k.split(".")[0]));
      expect(categories.has("agent")).toBe(true);
      expect(categories.has("ui")).toBe(true);
      expect(categories.has("platform")).toBe(true);
      expect(categories.has("experimental")).toBe(true);
    });
  });
});
