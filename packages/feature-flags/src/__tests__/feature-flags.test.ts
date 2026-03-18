import { describe, expect, it } from "vitest";
import {
  createFeatureFlags,
  DEFAULT_FLAGS,
  featureFlags,
  isEnabled,
} from "../index";
import type { FlagContext } from "../types";

describe("createFeatureFlags", () => {
  it("creates a provider with default flags", () => {
    const ff = createFeatureFlags();
    const flags = ff.getAllFlags();
    expect(Object.keys(flags).length).toBeGreaterThan(0);
    expect(flags["agent.fleet-mode"]).toBeDefined();
  });

  it("allows custom flags to override defaults", () => {
    const ff = createFeatureFlags({
      "custom.flag": {
        key: "custom.flag",
        description: "A custom flag",
        defaultEnabled: true,
      },
    });
    expect(ff.isEnabled("custom.flag")).toBe(true);
  });

  it("custom flags override default flags with the same key", () => {
    const ff = createFeatureFlags({
      "agent.auto-fix": {
        key: "agent.auto-fix",
        description: "Override",
        defaultEnabled: false,
      },
    });
    // agent.auto-fix is defaultEnabled: true in defaults, but overridden to false
    expect(ff.isEnabled("agent.auto-fix")).toBe(false);
  });
});

describe("isEnabled", () => {
  it("returns false for unknown flags", () => {
    expect(isEnabled("nonexistent.flag")).toBe(false);
  });

  it("returns true for flags with defaultEnabled: true and no restrictions", () => {
    expect(isEnabled("agent.auto-fix")).toBe(true);
    expect(isEnabled("ui.transparency-panel")).toBe(true);
    expect(isEnabled("ui.command-palette")).toBe(true);
  });

  it("returns false for flags with defaultEnabled: false", () => {
    // platform.webhooks is defaultEnabled: false with no tier restriction
    expect(isEnabled("platform.webhooks")).toBe(false);
  });

  describe("tier restrictions", () => {
    it("returns false when flag has allowedTiers but no tier in context", () => {
      expect(isEnabled("agent.fleet-mode")).toBe(false);
      expect(isEnabled("agent.fleet-mode", {})).toBe(false);
    });

    it("returns false when tier is not in allowedTiers", () => {
      expect(isEnabled("agent.fleet-mode", { tier: "hobby" })).toBe(false);
      expect(isEnabled("agent.fleet-mode", { tier: "starter" })).toBe(false);
    });

    it("returns true when tier matches allowedTiers", () => {
      expect(isEnabled("agent.fleet-mode", { tier: "pro" })).toBe(true);
      expect(isEnabled("agent.fleet-mode", { tier: "team" })).toBe(true);
      expect(isEnabled("agent.fleet-mode", { tier: "enterprise" })).toBe(true);
    });
  });

  describe("percentage rollouts", () => {
    it("returns false when no userId is provided for percentage flag", () => {
      // experimental.streaming-diffs has percentage: 10
      expect(isEnabled("experimental.streaming-diffs")).toBe(false);
    });

    it("is deterministic for the same userId", () => {
      const ctx: FlagContext = { userId: "user_test_123" };
      const first = isEnabled("experimental.streaming-diffs", ctx);
      const second = isEnabled("experimental.streaming-diffs", ctx);
      expect(first).toBe(second);
    });

    it("returns false for 0% rollout even with userId", () => {
      // experimental.voice-input has percentage: 0
      expect(isEnabled("experimental.voice-input", { userId: "user_1" })).toBe(
        false
      );
      expect(isEnabled("experimental.voice-input", { userId: "user_2" })).toBe(
        false
      );
    });
  });

  describe("explicit overrides", () => {
    it("override takes precedence over everything", () => {
      // agent.fleet-mode requires pro+ tier, but override forces it
      expect(
        isEnabled("agent.fleet-mode", {
          tier: "hobby",
          overrides: { "agent.fleet-mode": true },
        })
      ).toBe(true);

      // Force disable an enabled flag
      expect(
        isEnabled("agent.auto-fix", {
          overrides: { "agent.auto-fix": false },
        })
      ).toBe(false);
    });
  });

  describe("development environment", () => {
    it("enables all defined flags in development", () => {
      const ctx: FlagContext = { environment: "development" };
      // Even tier-restricted flags should be enabled
      expect(isEnabled("agent.fleet-mode", ctx)).toBe(true);
      expect(isEnabled("agent.browser-tool", ctx)).toBe(true);
      expect(isEnabled("platform.webhooks", ctx)).toBe(true);
    });

    it("returns false for undefined flags even in development", () => {
      expect(
        isEnabled("nonexistent.flag", { environment: "development" })
      ).toBe(false);
    });
  });
});

describe("getEnabledFlags", () => {
  it("returns flags that are enabled for the given context", () => {
    const ff = createFeatureFlags();
    const enabled = ff.getEnabledFlags({ tier: "pro" });
    expect(enabled).toContain("agent.fleet-mode");
    expect(enabled).toContain("agent.auto-fix");
    expect(enabled).toContain("ui.transparency-panel");
  });

  it("returns fewer flags for hobby tier", () => {
    const ff = createFeatureFlags();
    const hobbyFlags = ff.getEnabledFlags({ tier: "hobby" });
    const proFlags = ff.getEnabledFlags({ tier: "pro" });
    expect(proFlags.length).toBeGreaterThan(hobbyFlags.length);
  });

  it("returns all defined flags in development", () => {
    const ff = createFeatureFlags();
    const devFlags = ff.getEnabledFlags({ environment: "development" });
    // Should include nearly all flags (except undefined ones)
    expect(devFlags.length).toBeGreaterThan(10);
  });
});

describe("DEFAULT_FLAGS", () => {
  it("every flag key matches its key property", () => {
    for (const [key, flag] of Object.entries(DEFAULT_FLAGS)) {
      expect(flag.key).toBe(key);
    }
  });

  it("every flag has a non-empty description", () => {
    for (const flag of Object.values(DEFAULT_FLAGS)) {
      expect(flag.description.length).toBeGreaterThan(0);
    }
  });

  it("percentage values are between 0 and 100 when defined", () => {
    for (const flag of Object.values(DEFAULT_FLAGS)) {
      if (flag.percentage !== undefined) {
        expect(flag.percentage).toBeGreaterThanOrEqual(0);
        expect(flag.percentage).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("singleton featureFlags", () => {
  it("is the same instance returned by createFeatureFlags()", () => {
    // Test that the singleton works
    expect(featureFlags.isEnabled("agent.auto-fix")).toBe(true);
    expect(featureFlags.getAllFlags()["agent.auto-fix"]).toBeDefined();
  });
});
