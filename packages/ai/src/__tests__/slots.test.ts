import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY } from "../models";
import {
  autoDetectSlot,
  getAllSlots,
  getSlotConfig,
  SLOT_CONFIGS,
} from "../slots";

describe("SLOT_CONFIGS", () => {
  it("has all 8 expected slots", () => {
    const expected = [
      "default",
      "think",
      "longContext",
      "background",
      "vision",
      "review",
      "fastLoop",
      "premium",
    ];
    for (const slot of expected) {
      expect(SLOT_CONFIGS[slot as keyof typeof SLOT_CONFIGS]).toBeDefined();
    }
  });

  it("every slot has a non-empty chain", () => {
    for (const [, config] of Object.entries(SLOT_CONFIGS)) {
      expect(config.chain.length).toBeGreaterThan(0);
    }
  });

  it("every model in every chain exists in MODEL_REGISTRY", () => {
    for (const [_slotName, config] of Object.entries(SLOT_CONFIGS)) {
      for (const modelKey of config.chain) {
        expect(MODEL_REGISTRY[modelKey]).toBeDefined();
      }
    }
  });

  it("every slot has a temperature between 0 and 1", () => {
    for (const config of Object.values(SLOT_CONFIGS)) {
      expect(config.defaultTemperature).toBeGreaterThanOrEqual(0);
      expect(config.defaultTemperature).toBeLessThanOrEqual(1);
    }
  });
});

describe("getSlotConfig", () => {
  it("returns the correct config", () => {
    const config = getSlotConfig("default");
    expect(config.slot).toBe("default");
    expect(config.chain.length).toBeGreaterThan(0);
  });
});

describe("getAllSlots", () => {
  it("returns all slot names", () => {
    const slots = getAllSlots();
    expect(slots).toContain("default");
    expect(slots).toContain("premium");
    expect(slots).toContain("vision");
    expect(slots.length).toBe(8);
  });
});

describe("autoDetectSlot", () => {
  it("returns 'vision' when hasImages is true", () => {
    expect(autoDetectSlot({ hasImages: true })).toBe("vision");
  });

  it("returns 'longContext' for token counts > 32K", () => {
    expect(autoDetectSlot({ tokenCount: 50_000 })).toBe("longContext");
  });

  it("returns 'default' for token counts <= 32K without special task", () => {
    expect(autoDetectSlot({ tokenCount: 10_000 })).toBe("default");
  });

  it("returns 'think' for reasoning/planning task types", () => {
    expect(autoDetectSlot({ taskType: "reason about architecture" })).toBe(
      "think"
    );
    expect(autoDetectSlot({ taskType: "plan the sprint" })).toBe("think");
    expect(autoDetectSlot({ taskType: "architect the system" })).toBe("think");
  });

  it("returns 'review' for review/audit task types", () => {
    expect(autoDetectSlot({ taskType: "code review" })).toBe("review");
    expect(autoDetectSlot({ taskType: "security audit" })).toBe("review");
  });

  it("returns 'fastLoop' for CI-related task types", () => {
    expect(autoDetectSlot({ taskType: "fast CI loop" })).toBe("fastLoop");
    expect(autoDetectSlot({ taskType: "quick fix the test" })).toBe("fastLoop");
  });

  it("returns 'background' for indexing/embedding task types", () => {
    expect(autoDetectSlot({ taskType: "index the codebase" })).toBe(
      "background"
    );
    expect(autoDetectSlot({ taskType: "embed files" })).toBe("background");
  });

  it("returns 'premium' for complex/critical task types", () => {
    expect(autoDetectSlot({ taskType: "premium task" })).toBe("premium");
    expect(autoDetectSlot({ taskType: "complex refactoring" })).toBe("premium");
    expect(autoDetectSlot({ taskType: "high stakes deployment" })).toBe(
      "premium"
    );
  });

  it("returns 'default' when no heuristics match", () => {
    expect(autoDetectSlot({})).toBe("default");
    expect(autoDetectSlot({ taskType: "write some code" })).toBe("default");
  });

  it("prioritizes hasImages over tokenCount", () => {
    expect(autoDetectSlot({ hasImages: true, tokenCount: 50_000 })).toBe(
      "vision"
    );
  });
});
