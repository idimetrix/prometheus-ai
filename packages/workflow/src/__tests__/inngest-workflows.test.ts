import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { TIER_CONCURRENCY_LIMITS } from "../inngest";
import { routeWorkflow, type TaskMode } from "../workflow-router";

// ---------------------------------------------------------------------------
// routeWorkflow
// ---------------------------------------------------------------------------

describe("routeWorkflow", () => {
  it("returns all 10 phases for full mode", () => {
    const route = routeWorkflow("full", "Build the entire feature");
    expect(route.phases).toEqual([
      "discovery",
      "architecture",
      "planning",
      "approval",
      "coding",
      "testing",
      "ci",
      "security",
      "review",
      "deploy",
    ]);
    expect(route.mode).toBe("full");
    expect(route.requiresApproval).toBe(true);
    expect(route.estimatedComplexity).toBe("high");
  });

  it("returns analysis-only phases for ask mode", () => {
    const route = routeWorkflow("ask", "What does this function do?");
    expect(route.phases).toEqual(["discovery", "architecture", "planning"]);
    expect(route.mode).toBe("ask");
    expect(route.requiresApproval).toBe(false);
    expect(route.estimatedComplexity).toBe("low");
  });

  it("returns quick-fix phases for simple_fix mode", () => {
    const route = routeWorkflow("simple_fix", "Fix typo in readme");
    expect(route.phases).toEqual([
      "planning",
      "coding",
      "testing",
      "ci",
      "deploy",
    ]);
    expect(route.requiresApproval).toBe(false);
    expect(route.estimatedComplexity).toBe("low");
  });

  it("returns refactor phases with approval", () => {
    const route = routeWorkflow("refactor", "Extract shared utility");
    expect(route.phases).toEqual([
      "discovery",
      "architecture",
      "planning",
      "coding",
      "testing",
      "ci",
      "review",
      "deploy",
    ]);
    expect(route.requiresApproval).toBe(true);
    expect(route.estimatedComplexity).toBe("medium");
  });

  it("returns test generation phases for test mode", () => {
    const route = routeWorkflow("test", "Add unit tests for auth module");
    expect(route.phases).toEqual([
      "discovery",
      "planning",
      "coding",
      "testing",
      "ci",
      "deploy",
    ]);
    expect(route.requiresApproval).toBe(false);
    expect(route.estimatedComplexity).toBe("medium");
  });

  it("returns review phases for review mode", () => {
    const route = routeWorkflow("review", "Review PR #42");
    expect(route.phases).toEqual(["discovery", "architecture", "review"]);
    expect(route.requiresApproval).toBe(false);
    expect(route.estimatedComplexity).toBe("low");
  });

  it("defaults to full mode for unknown mode strings", () => {
    const route = routeWorkflow("nonexistent_mode", "Do something");
    expect(route.mode).toBe("full");
    expect(route.phases.length).toBe(10);
    expect(route.requiresApproval).toBe(true);
  });

  it("includes a description that references the task", () => {
    const route = routeWorkflow("ask", "Explain the auth middleware");
    expect(route.description).toContain("Explain the auth middleware");
    expect(route.description).toContain("Analysis-only");
  });

  it("truncates long task descriptions in the route description", () => {
    const longDesc = "A".repeat(200);
    const route = routeWorkflow("full", longDesc);
    expect(route.description.length).toBeLessThan(200);
    expect(route.description).toContain("...");
  });

  it("each mode produces a unique set of phases", () => {
    const modes: TaskMode[] = [
      "full",
      "ask",
      "simple_fix",
      "refactor",
      "test",
      "review",
    ];
    const phaseSets = modes.map((m) =>
      routeWorkflow(m, "task").phases.join(",")
    );
    const unique = new Set(phaseSets);
    expect(unique.size).toBe(modes.length);
  });
});

// ---------------------------------------------------------------------------
// TIER_CONCURRENCY_LIMITS
// ---------------------------------------------------------------------------

describe("TIER_CONCURRENCY_LIMITS", () => {
  it("has all expected tiers", () => {
    expect(TIER_CONCURRENCY_LIMITS).toHaveProperty("hobby");
    expect(TIER_CONCURRENCY_LIMITS).toHaveProperty("starter");
    expect(TIER_CONCURRENCY_LIMITS).toHaveProperty("pro");
    expect(TIER_CONCURRENCY_LIMITS).toHaveProperty("team");
    expect(TIER_CONCURRENCY_LIMITS).toHaveProperty("studio");
  });

  it("returns correct concurrency limits for each tier", () => {
    expect(TIER_CONCURRENCY_LIMITS.hobby).toBe(1);
    expect(TIER_CONCURRENCY_LIMITS.starter).toBe(2);
    expect(TIER_CONCURRENCY_LIMITS.pro).toBe(4);
    expect(TIER_CONCURRENCY_LIMITS.team).toBe(8);
    expect(TIER_CONCURRENCY_LIMITS.studio).toBe(16);
  });

  it("limits increase monotonically across tiers", () => {
    const tiers = ["hobby", "starter", "pro", "team", "studio"];
    for (let i = 1; i < tiers.length; i++) {
      const prev = TIER_CONCURRENCY_LIMITS[tiers[i - 1] as string] as number;
      const curr = TIER_CONCURRENCY_LIMITS[tiers[i] as string] as number;
      expect(curr).toBeGreaterThan(prev);
    }
  });
});
