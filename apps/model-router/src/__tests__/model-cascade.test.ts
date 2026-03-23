import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { type CascadeTierConfig, ModelCascade } from "../model-cascade";

const DEFAULT_TIERS: CascadeTierConfig[] = [
  { name: "cheap", model: "cheap-model", costPerToken: 0.000_000_1 },
  { name: "standard", model: "standard-model", costPerToken: 0.000_001 },
  { name: "premium", model: "premium-model", costPerToken: 0.000_01 },
];

function highQualityResponse() {
  return {
    content:
      "Here is a detailed, well-structured solution:\n\n```typescript\nfunction solve(): void {\n  // implementation\n}\n```\n\n## Explanation\n\n1. First step\n2. Second step\n- Additional notes",
    inputTokens: 100,
    outputTokens: 200,
  };
}

function lowQualityResponse() {
  return {
    content: "I'm not sure about this.",
    inputTokens: 50,
    outputTokens: 20,
  };
}

describe("ModelCascade", () => {
  // -----------------------------------------------------------------------
  // Cheap model used when quality is good
  // -----------------------------------------------------------------------

  it("uses cheap model when response quality exceeds threshold", async () => {
    const completionFn = vi.fn().mockResolvedValue(highQualityResponse());

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    const result = await cascade.execute([
      { role: "user", content: "Write a sort function" },
    ]);

    expect(result.tier).toBe("cheap");
    expect(result.model).toBe("cheap-model");
    expect(result.escalated).toBe(false);
    expect(completionFn).toHaveBeenCalledTimes(1);
    expect(completionFn).toHaveBeenCalledWith("cheap-model", expect.any(Array));
  });

  // -----------------------------------------------------------------------
  // Escalation when quality is low
  // -----------------------------------------------------------------------

  it("escalates to next tier when cheap model quality is below threshold", async () => {
    let callCount = 0;
    const completionFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(lowQualityResponse());
      }
      return Promise.resolve(highQualityResponse());
    });

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    const result = await cascade.execute([
      { role: "user", content: "Explain monads" },
    ]);

    expect(result.escalated).toBe(true);
    expect(result.tier).toBe("standard");
    expect(result.model).toBe("standard-model");
    expect(completionFn).toHaveBeenCalledTimes(2);
  });

  it("escalates through all tiers until quality is met", async () => {
    let callCount = 0;
    const completionFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve(lowQualityResponse());
      }
      return Promise.resolve(highQualityResponse());
    });

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    const result = await cascade.execute([
      { role: "user", content: "Complex question" },
    ]);

    expect(result.tier).toBe("premium");
    expect(result.escalated).toBe(true);
    expect(completionFn).toHaveBeenCalledTimes(3);
  });

  it("returns last tier result even if quality is still low", async () => {
    const completionFn = vi.fn().mockResolvedValue(lowQualityResponse());

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.99,
    });

    const result = await cascade.execute([
      { role: "user", content: "Unsatisfiable query" },
    ]);

    // Should return the premium (last) tier result regardless of quality
    expect(result.tier).toBe("premium");
    expect(completionFn).toHaveBeenCalledTimes(3);
  });

  // -----------------------------------------------------------------------
  // Metrics tracking
  // -----------------------------------------------------------------------

  it("tracks totalRequests correctly", async () => {
    const completionFn = vi.fn().mockResolvedValue(highQualityResponse());
    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    await cascade.execute([{ role: "user", content: "q1" }]);
    await cascade.execute([{ role: "user", content: "q2" }]);
    await cascade.execute([{ role: "user", content: "q3" }]);

    const metrics = cascade.getMetrics();
    expect(metrics.totalRequests).toBe(3);
  });

  it("tracks handledCheap when cheap model suffices", async () => {
    const completionFn = vi.fn().mockResolvedValue(highQualityResponse());
    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    await cascade.execute([{ role: "user", content: "easy" }]);
    await cascade.execute([{ role: "user", content: "also easy" }]);

    const metrics = cascade.getMetrics();
    expect(metrics.handledCheap).toBe(2);
    expect(metrics.escalations).toBe(0);
    expect(metrics.cheapRate).toBe(100);
  });

  it("tracks escalations when quality forces tier upgrade", async () => {
    let callCount = 0;
    const completionFn = vi.fn().mockImplementation(() => {
      callCount++;
      // Odd calls return low quality, even calls return high quality
      if (callCount % 2 === 1) {
        return Promise.resolve(lowQualityResponse());
      }
      return Promise.resolve(highQualityResponse());
    });

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    await cascade.execute([{ role: "user", content: "hard question" }]);

    const metrics = cascade.getMetrics();
    expect(metrics.escalations).toBe(1);
    expect(metrics.handledCheap).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Savings calculation
  // -----------------------------------------------------------------------

  it("calculates savings when cheap model handles the request", async () => {
    const completionFn = vi.fn().mockResolvedValue({
      content:
        "Complete answer with code:\n\n```ts\nconst x = 1;\n```\n\n## Details\n\n1. Step one\n- Note A",
      inputTokens: 100,
      outputTokens: 200,
    });

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    const result = await cascade.execute([
      { role: "user", content: "Simple task" },
    ]);

    // Total tokens = 300
    // Cheap cost = 300 * 0.0000001 = 0.00003
    // Premium cost = 300 * 0.00001 = 0.003
    // Savings = 0.003 - 0.00003 = 0.00297
    expect(result.savingsUsd).toBeGreaterThan(0);
    expect(result.tier).toBe("cheap");

    const metrics = cascade.getMetrics();
    expect(metrics.totalSavingsUsd).toBeGreaterThan(0);
  });

  it("reports zero savings when premium model is used", async () => {
    const completionFn = vi.fn().mockResolvedValue(lowQualityResponse());

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.99,
    });

    const result = await cascade.execute([
      { role: "user", content: "Very hard" },
    ]);

    // Premium tier is last, no savings
    expect(result.savingsUsd).toBe(0);
    expect(result.tier).toBe("premium");
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("skips a failing tier and tries the next one", async () => {
    let callCount = 0;
    const completionFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("Provider timeout"));
      }
      return Promise.resolve(highQualityResponse());
    });

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    const result = await cascade.execute([
      { role: "user", content: "retry me" },
    ]);

    expect(result.model).toBe("standard-model");
    expect(completionFn).toHaveBeenCalledTimes(2);
  });

  it("throws when all tiers fail", async () => {
    const completionFn = vi
      .fn()
      .mockRejectedValue(new Error("All providers down"));

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    await expect(
      cascade.execute([{ role: "user", content: "doomed" }])
    ).rejects.toThrow("All cascade tiers failed");
  });

  // -----------------------------------------------------------------------
  // Quality threshold override
  // -----------------------------------------------------------------------

  it("respects per-call quality threshold override", async () => {
    const completionFn = vi.fn().mockResolvedValue(lowQualityResponse());

    const cascade = new ModelCascade(completionFn, {
      tiers: DEFAULT_TIERS,
      qualityThreshold: 0.5,
    });

    // Override with very low threshold so cheap tier passes
    const result = await cascade.execute(
      [{ role: "user", content: "lenient" }],
      0.01
    );

    expect(result.tier).toBe("cheap");
    expect(completionFn).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Metrics cheapRate
  // -----------------------------------------------------------------------

  it("calculates cheapRate as percentage of requests handled by cheap tier", async () => {
    const cascade = new ModelCascade(
      vi.fn().mockResolvedValue(highQualityResponse()),
      { tiers: DEFAULT_TIERS, qualityThreshold: 0.5 }
    );

    const metrics = cascade.getMetrics();
    expect(metrics.cheapRate).toBe(0); // No requests yet

    await cascade.execute([{ role: "user", content: "q" }]);
    expect(cascade.getMetrics().cheapRate).toBe(100);
  });
});
