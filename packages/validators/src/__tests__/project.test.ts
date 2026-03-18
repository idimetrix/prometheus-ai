import { describe, it, expect } from "vitest";
import { createProjectSchema } from "../project";

describe("createProjectSchema", () => {
  it("should validate a valid project", () => {
    const result = createProjectSchema.safeParse({
      name: "My Project",
      description: "A test project",
      techStackPreset: "modern-saas",
    });
    expect(result.success).toBe(true);
  });

  it("should require name", () => {
    const result = createProjectSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject empty name", () => {
    const result = createProjectSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("should reject name over 100 chars", () => {
    const result = createProjectSchema.safeParse({ name: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("should allow optional fields", () => {
    const result = createProjectSchema.safeParse({ name: "Test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.techStackPreset).toBeUndefined();
    }
  });

  it("should validate repo URL format", () => {
    const valid = createProjectSchema.safeParse({
      name: "Test",
      repoUrl: "https://github.com/user/repo",
    });
    expect(valid.success).toBe(true);

    const invalid = createProjectSchema.safeParse({
      name: "Test",
      repoUrl: "not-a-url",
    });
    expect(invalid.success).toBe(false);
  });
});
