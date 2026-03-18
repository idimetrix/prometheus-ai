import { describe, it, expect } from "vitest";
import { createSessionSchema } from "../session";

describe("createSessionSchema", () => {
  it("should validate a valid session", () => {
    const result = createSessionSchema.safeParse({
      projectId: "proj_123",
      mode: "task",
    });
    expect(result.success).toBe(true);
  });

  it("should require projectId", () => {
    const result = createSessionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should default mode to task", () => {
    const result = createSessionSchema.safeParse({ projectId: "proj_123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("task");
    }
  });

  it("should validate mode enum", () => {
    const valid = createSessionSchema.safeParse({ projectId: "p", mode: "ask" });
    expect(valid.success).toBe(true);

    const invalid = createSessionSchema.safeParse({ projectId: "p", mode: "invalid" });
    expect(invalid.success).toBe(false);
  });

  it("should accept all valid modes", () => {
    for (const mode of ["task", "ask", "plan", "watch", "fleet"]) {
      const result = createSessionSchema.safeParse({ projectId: "p", mode });
      expect(result.success).toBe(true);
    }
  });
});
