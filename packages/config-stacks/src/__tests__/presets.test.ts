import { describe, it, expect } from "vitest";
import { TECH_STACK_PRESETS, getPreset } from "../presets";

describe("TECH_STACK_PRESETS", () => {
  it("should have 9 presets", () => {
    expect(Object.keys(TECH_STACK_PRESETS)).toHaveLength(9);
  });

  it("should have all required presets", () => {
    const required = [
      "modern-saas", "fullstack-minimal", "django-react", "rails",
      "go-microservices", "laravel-vue", "react-native", "rust-backend", "custom",
    ];
    for (const id of required) {
      expect(TECH_STACK_PRESETS).toHaveProperty(id);
    }
  });

  it("should have valid preset structure", () => {
    for (const [id, preset] of Object.entries(TECH_STACK_PRESETS)) {
      if (id === "custom") continue; // custom is allowed to have empty arrays
      expect(preset.id).toBe(id);
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.languages.length).toBeGreaterThan(0);
      expect(preset.frameworks.length).toBeGreaterThan(0);
    }
  });
});

describe("getPreset", () => {
  it("should return preset by id", () => {
    const preset = getPreset("modern-saas");
    expect(preset).toBeTruthy();
    expect(preset?.name).toBe("Modern SaaS");
  });

  it("should return undefined for unknown preset", () => {
    expect(getPreset("nonexistent")).toBeUndefined();
  });
});
