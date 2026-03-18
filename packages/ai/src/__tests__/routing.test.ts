import { beforeEach, describe, expect, it } from "vitest";
import { MODEL_REGISTRY } from "../models";
import {
  getHealthStatus,
  isProviderHealthy,
  isWithinRateLimit,
  recordRequest,
  reportFailure,
  reportSuccess,
  resetRoutingState,
  resolveRoute,
  setProviderHealth,
} from "../routing";

beforeEach(() => {
  resetRoutingState();
});

describe("Provider Health Tracking", () => {
  it("providers start healthy by default", () => {
    expect(isProviderHealthy("ollama")).toBe(true);
    expect(isProviderHealthy("anthropic")).toBe(true);
  });

  it("marks provider unhealthy after 3 consecutive failures", () => {
    reportFailure("ollama");
    expect(isProviderHealthy("ollama")).toBe(true);
    reportFailure("ollama");
    expect(isProviderHealthy("ollama")).toBe(true);
    reportFailure("ollama");
    expect(isProviderHealthy("ollama")).toBe(false);
  });

  it("resets failure count on success", () => {
    reportFailure("ollama");
    reportFailure("ollama");
    reportSuccess("ollama");
    reportFailure("ollama");
    reportFailure("ollama");
    // Should still be healthy because the success reset the counter
    expect(isProviderHealthy("ollama")).toBe(true);
  });

  it("setProviderHealth directly controls health status", () => {
    setProviderHealth("anthropic", false);
    expect(isProviderHealthy("anthropic")).toBe(false);
    setProviderHealth("anthropic", true);
    expect(isProviderHealthy("anthropic")).toBe(true);
  });

  it("getHealthStatus returns all providers", () => {
    const status = getHealthStatus();
    expect(status.ollama).toBeDefined();
    expect(status.anthropic).toBeDefined();
    expect(status.openai).toBeDefined();
    expect(status.ollama.healthy).toBe(true);
    expect(status.ollama.failures).toBe(0);
  });

  it("getHealthStatus reflects failures", () => {
    reportFailure("groq");
    reportFailure("groq");
    const status = getHealthStatus();
    expect(status.groq.failures).toBe(2);
    expect(status.groq.healthy).toBe(true); // not yet 3
  });
});

describe("Rate Limit Tracking", () => {
  it("returns false for unknown model", () => {
    expect(isWithinRateLimit("fake/model")).toBe(false);
  });

  it("returns true for models with unlimited rate", () => {
    // Ollama models have null rpmLimit and null tpmLimit
    expect(isWithinRateLimit("ollama/qwen3-coder-next")).toBe(true);
  });

  it("tracks requests against rpm limit", () => {
    const modelKey = "cerebras/qwen3-235b";
    const config = MODEL_REGISTRY[modelKey]!;
    expect(config.rpmLimit).toBe(30);

    // Fill up to the limit
    for (let i = 0; i < 30; i++) {
      expect(isWithinRateLimit(modelKey)).toBe(true);
      recordRequest(modelKey, 100);
    }

    // Should now be over limit
    expect(isWithinRateLimit(modelKey)).toBe(false);
  });

  it("tracks token usage against tpm limit", () => {
    const modelKey = "cerebras/qwen3-235b";
    const config = MODEL_REGISTRY[modelKey]!;
    expect(config.tpmLimit).toBe(1_000_000);

    // Record a huge token count
    recordRequest(modelKey, 999_990);
    // Requesting more than remaining should fail
    expect(isWithinRateLimit(modelKey, 20)).toBe(false);
  });
});

describe("resolveRoute", () => {
  it("resolves to the first healthy model in the default slot", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(route).not.toBeNull();
    expect(route?.slot).toBe("default");
    expect(route?.fallbackPosition).toBe(0);
  });

  it("falls back when primary provider is unhealthy", () => {
    // Mark ollama as unhealthy so it skips the first model in the default chain
    setProviderHealth("ollama", false);
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(route).not.toBeNull();
    expect(route?.fallbackPosition).toBeGreaterThan(0);
    // Should be cerebras or groq
    expect(MODEL_REGISTRY[route?.modelKey]?.provider).not.toBe("ollama");
  });

  it("auto-detects vision slot when hasImages is true", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Describe this image" }],
      hasImages: true,
    });
    expect(route).not.toBeNull();
    expect(route?.slot).toBe("vision");
  });

  it("auto-detects longContext slot for large token counts", () => {
    const longContent = "x".repeat(200_000);
    const route = resolveRoute({
      messages: [{ role: "user", content: longContent }],
    });
    expect(route).not.toBeNull();
    expect(route?.slot).toBe("longContext");
  });

  it("uses explicit slot override", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
      slot: "premium",
    });
    expect(route).not.toBeNull();
    expect(route?.slot).toBe("premium");
  });

  it("applies temperature from slot config when not overridden", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
      slot: "default",
    });
    expect(route).not.toBeNull();
    expect(route?.temperature).toBe(0.7);
  });

  it("applies temperature override", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.2,
    });
    expect(route).not.toBeNull();
    expect(route?.temperature).toBe(0.2);
  });

  it("returns null when all models are unhealthy", () => {
    // Mark all providers unhealthy for the default slot
    setProviderHealth("ollama", false);
    setProviderHealth("cerebras", false);
    setProviderHealth("groq", false);
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
      slot: "default",
    });
    expect(route).toBeNull();
  });

  it("includes estimated input token count", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello world" }],
    });
    expect(route).not.toBeNull();
    expect(route?.estimatedInputTokens).toBeGreaterThan(0);
  });
});
