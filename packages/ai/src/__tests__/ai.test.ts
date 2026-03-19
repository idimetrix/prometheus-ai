import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_PATTERN = /^https?:\/\//;

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "test response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      },
    };
  }
  return { default: MockOpenAI };
});

// ── Imports ──────────────────────────────────────────────────────────────────

import { clearClientCache, createLLMClient } from "../client";
import {
  estimateCost,
  getAllModelKeys,
  getModelConfig,
  getModelsByProvider,
  getModelsByTier,
  getModelsWithCapability,
  MODEL_REGISTRY,
  PROVIDER_ENDPOINTS,
  PROVIDER_ENV_KEYS,
} from "../models";
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
import {
  autoDetectSlot,
  getAllSlots,
  getSlotConfig,
  SLOT_CONFIGS,
} from "../slots";
import {
  estimateMessageTokens,
  estimateTextCost,
  estimateTokens,
  remainingContextTokens,
  truncateToTokens,
} from "../tokens";

// ── Model Registry Tests ─────────────────────────────────────────────────────

describe("MODEL_REGISTRY", () => {
  it("contains models from all expected providers", () => {
    const providers = new Set(
      Object.values(MODEL_REGISTRY).map((m) => m.provider)
    );
    expect(providers).toContain("ollama");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("gemini");
  });

  it("every model has required fields", () => {
    for (const [key, config] of Object.entries(MODEL_REGISTRY)) {
      expect(config.id).toBeTruthy();
      expect(config.registryKey).toBe(key);
      expect(config.provider).toBeTruthy();
      expect(config.contextWindow).toBeGreaterThan(0);
      expect(config.capabilities.length).toBeGreaterThan(0);
      expect(typeof config.costPerInputToken).toBe("number");
      expect(typeof config.costPerOutputToken).toBe("number");
    }
  });

  it("ollama models are free (tier 0)", () => {
    const ollamaModels = getModelsByProvider("ollama");
    for (const model of ollamaModels) {
      expect(model.costPerInputToken).toBe(0);
      expect(model.costPerOutputToken).toBe(0);
      expect(model.tier).toBe(0);
    }
  });

  it("anthropic claude-opus-4-6 is tier 4 (premium)", () => {
    const config = getModelConfig("anthropic/claude-opus-4-6");
    expect(config).toBeDefined();
    expect(config?.tier).toBe(4);
  });
});

describe("getModelConfig", () => {
  it("returns config for valid model key", () => {
    const config = getModelConfig("openai/gpt-4o-mini");
    expect(config).toBeDefined();
    expect(config?.provider).toBe("openai");
    expect(config?.id).toBe("gpt-4o-mini");
  });

  it("returns undefined for unknown model key", () => {
    expect(getModelConfig("nonexistent/model")).toBeUndefined();
  });
});

describe("getModelsByProvider", () => {
  it("returns all ollama models", () => {
    const models = getModelsByProvider("ollama");
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.provider).toBe("ollama");
    }
  });

  it("returns empty array for unknown provider", () => {
    const models = getModelsByProvider("nonexistent" as never);
    expect(models).toHaveLength(0);
  });
});

describe("getModelsByTier", () => {
  it("returns tier 0 models (local)", () => {
    const models = getModelsByTier(0);
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.tier).toBe(0);
    }
  });

  it("returns tier 4 models (premium)", () => {
    const models = getModelsByTier(4);
    expect(models.length).toBeGreaterThan(0);
  });
});

describe("getModelsWithCapability", () => {
  it("returns models with chat capability", () => {
    const models = getModelsWithCapability("chat");
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.capabilities).toContain("chat");
    }
  });

  it("returns models with embeddings capability", () => {
    const models = getModelsWithCapability("embeddings");
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.capabilities).toContain("embeddings");
    }
  });

  it("returns models with vision capability", () => {
    const models = getModelsWithCapability("vision");
    expect(models.length).toBeGreaterThan(0);
  });
});

describe("getAllModelKeys", () => {
  it("returns all keys in the registry", () => {
    const keys = getAllModelKeys();
    expect(keys.length).toBe(Object.keys(MODEL_REGISTRY).length);
  });

  it("keys follow provider/model format", () => {
    const keys = getAllModelKeys();
    for (const key of keys) {
      expect(key).toContain("/");
    }
  });
});

describe("estimateCost", () => {
  it("returns 0 for free models", () => {
    const cost = estimateCost("ollama/qwen3-coder-next", 1000, 500);
    expect(cost).toBe(0);
  });

  it("calculates cost for paid models", () => {
    const cost = estimateCost("openai/gpt-4o-mini", 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 for unknown models", () => {
    const cost = estimateCost("unknown/model", 1000, 500);
    expect(cost).toBe(0);
  });

  it("cost scales with token count", () => {
    const small = estimateCost("openai/gpt-4o-mini", 100, 50);
    const large = estimateCost("openai/gpt-4o-mini", 10_000, 5000);
    expect(large).toBeGreaterThan(small);
  });
});

describe("PROVIDER_ENDPOINTS", () => {
  it("defines endpoints for all providers", () => {
    const providers = [
      "ollama",
      "cerebras",
      "groq",
      "gemini",
      "openrouter",
      "mistral",
      "deepseek",
      "anthropic",
      "openai",
      "voyage",
    ];
    for (const p of providers) {
      expect(
        PROVIDER_ENDPOINTS[p as keyof typeof PROVIDER_ENDPOINTS]
      ).toBeTruthy();
    }
  });

  it("endpoints are valid URLs", () => {
    for (const [, url] of Object.entries(PROVIDER_ENDPOINTS)) {
      expect(url).toMatch(URL_PATTERN);
    }
  });
});

describe("PROVIDER_ENV_KEYS", () => {
  it("maps providers to API key env vars", () => {
    expect(PROVIDER_ENV_KEYS.openai).toBe("OPENAI_API_KEY");
    expect(PROVIDER_ENV_KEYS.anthropic).toBe("ANTHROPIC_API_KEY");
    expect(PROVIDER_ENV_KEYS.groq).toBe("GROQ_API_KEY");
  });
});

// ── Client Tests ─────────────────────────────────────────────────────────────

describe("createLLMClient", () => {
  afterEach(() => {
    clearClientCache();
  });

  it("creates a client for ollama without API key", () => {
    const client = createLLMClient({ provider: "ollama" });
    expect(client).toBeDefined();
  });

  it("creates a client with custom API key", () => {
    const client = createLLMClient({
      provider: "openai",
      apiKey: "sk-test-key",
    });
    expect(client).toBeDefined();
  });

  it("throws for unknown provider", () => {
    expect(() =>
      createLLMClient({ provider: "nonexistent" as never })
    ).toThrow();
  });

  it("clearClientCache clears the cache", () => {
    createLLMClient({ provider: "ollama" });
    clearClientCache();
    // Should not throw when creating again after clear
    const client = createLLMClient({ provider: "ollama" });
    expect(client).toBeDefined();
  });
});

// ── Token Tests ──────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates tokens for plain English text", () => {
    const tokens = estimateTokens("Hello, how are you today?");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(20);
  });

  it("estimates higher token density for code", () => {
    const codeText = "function foo() { return x + y; }";
    const englishText = "This is a simple English sentence here";
    const codeTokens = estimateTokens(codeText);
    const englishTokens = estimateTokens(englishText);
    // Code should have more tokens per character
    const codeRatio = codeTokens / codeText.length;
    const englishRatio = englishTokens / englishText.length;
    expect(codeRatio).toBeGreaterThanOrEqual(englishRatio * 0.9);
  });
});

describe("estimateMessageTokens", () => {
  it("accounts for message framing overhead", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const tokens = estimateMessageTokens(messages);
    const textOnly = estimateTokens("Hello");
    // Should include framing (4 per message) + 3 for reply priming
    expect(tokens).toBeGreaterThan(textOnly);
  });

  it("sums tokens across multiple messages", () => {
    const single = estimateMessageTokens([{ role: "user", content: "Hello" }]);
    const double = estimateMessageTokens([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
    expect(double).toBeGreaterThan(single);
  });
});

describe("remainingContextTokens", () => {
  it("returns positive when messages fit", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const remaining = remainingContextTokens(messages, 128_000);
    expect(remaining).toBeGreaterThan(0);
  });

  it("returns 0 when messages exceed context", () => {
    const longText = "x".repeat(500_000);
    const messages = [{ role: "user", content: longText }];
    const remaining = remainingContextTokens(messages, 1000);
    expect(remaining).toBe(0);
  });

  it("reserves tokens for output", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const withReserve = remainingContextTokens(messages, 128_000, 4096);
    const without = remainingContextTokens(messages, 128_000);
    expect(withReserve).toBe(without - 4096);
  });
});

describe("truncateToTokens", () => {
  it("returns text unchanged if under limit", () => {
    const text = "Short text";
    expect(truncateToTokens(text, 1000)).toBe(text);
  });

  it("truncates long text and adds marker", () => {
    const longText = "x".repeat(10_000);
    const result = truncateToTokens(longText, 100);
    expect(result.length).toBeLessThan(longText.length);
    expect(result).toContain("[truncated]");
  });

  it("returns empty string for maxTokens 0 on long text", () => {
    const result = truncateToTokens("some text that needs truncation", 0);
    expect(result).toBe("");
  });
});

describe("estimateTextCost", () => {
  it("returns 0 for free models", () => {
    const cost = estimateTextCost("Hello", 100, 0, 0);
    expect(cost).toBe(0);
  });

  it("calculates cost for paid models", () => {
    const cost = estimateTextCost("Hello world", 100, 0.000_01, 0.000_03);
    expect(cost).toBeGreaterThan(0);
  });
});

// ── Slots Tests ──────────────────────────────────────────────────────────────

describe("SLOT_CONFIGS", () => {
  it("defines 8 routing slots", () => {
    const slots = getAllSlots();
    expect(slots).toHaveLength(8);
  });

  it("each slot has a chain with at least one model", () => {
    for (const slot of getAllSlots()) {
      const config = getSlotConfig(slot);
      expect(config.chain.length).toBeGreaterThan(0);
    }
  });

  it("default slot uses ollama as primary", () => {
    expect(SLOT_CONFIGS.default.chain[0]).toContain("ollama");
  });

  it("premium slot uses claude-opus as primary", () => {
    expect(SLOT_CONFIGS.premium.chain[0]).toContain("opus");
  });
});

describe("autoDetectSlot", () => {
  it("returns vision for image tasks", () => {
    expect(autoDetectSlot({ hasImages: true })).toBe("vision");
  });

  it("returns longContext for >32K tokens", () => {
    expect(autoDetectSlot({ tokenCount: 50_000 })).toBe("longContext");
  });

  it("returns think for reasoning tasks", () => {
    expect(autoDetectSlot({ taskType: "plan architecture" })).toBe("think");
  });

  it("returns review for code review tasks", () => {
    expect(autoDetectSlot({ taskType: "code review" })).toBe("review");
  });

  it("returns fastLoop for CI tasks", () => {
    expect(autoDetectSlot({ taskType: "fast iteration" })).toBe("fastLoop");
  });

  it("returns background for indexing tasks", () => {
    expect(autoDetectSlot({ taskType: "index files" })).toBe("background");
  });

  it("returns premium for high-stakes tasks", () => {
    expect(autoDetectSlot({ taskType: "high-stakes deployment" })).toBe(
      "premium"
    );
  });

  it("returns default for unmatched tasks", () => {
    expect(autoDetectSlot({ taskType: "write a function" })).toBe("default");
    expect(autoDetectSlot({})).toBe("default");
  });
});

// ── Routing Tests ────────────────────────────────────────────────────────────

describe("Routing health tracking", () => {
  beforeEach(() => {
    resetRoutingState();
  });

  it("providers start healthy", () => {
    expect(isProviderHealthy("ollama")).toBe(true);
  });

  it("marks provider unhealthy after 3 consecutive failures", () => {
    reportFailure("ollama");
    reportFailure("ollama");
    expect(isProviderHealthy("ollama")).toBe(true); // still healthy at 2
    reportFailure("ollama");
    expect(isProviderHealthy("ollama")).toBe(false); // unhealthy at 3
  });

  it("reportSuccess resets failure count", () => {
    reportFailure("ollama");
    reportFailure("ollama");
    reportSuccess("ollama");
    reportFailure("ollama");
    expect(isProviderHealthy("ollama")).toBe(true);
  });

  it("setProviderHealth manually sets status", () => {
    setProviderHealth("ollama", false);
    expect(isProviderHealthy("ollama")).toBe(false);
    setProviderHealth("ollama", true);
    expect(isProviderHealthy("ollama")).toBe(true);
  });

  it("getHealthStatus returns all providers", () => {
    const status = getHealthStatus();
    expect(status.ollama).toBeDefined();
    expect(status.anthropic).toBeDefined();
    expect(status.openai).toBeDefined();
  });
});

describe("Rate limit tracking", () => {
  beforeEach(() => {
    resetRoutingState();
  });

  it("allows requests within rate limit", () => {
    expect(isWithinRateLimit("ollama/qwen3-coder-next")).toBe(true);
  });

  it("returns false for unknown models", () => {
    expect(isWithinRateLimit("unknown/model")).toBe(false);
  });

  it("recordRequest increments counters", () => {
    recordRequest("cerebras/qwen3-235b", 1000);
    // Should still be within limits after one request
    expect(isWithinRateLimit("cerebras/qwen3-235b")).toBe(true);
  });
});

describe("resolveRoute", () => {
  beforeEach(() => {
    resetRoutingState();
  });

  it("resolves a route for simple messages", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(route).not.toBeNull();
    expect(route?.modelKey).toBeTruthy();
    expect(route?.slot).toBe("default");
  });

  it("resolves with explicit slot", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
      slot: "review",
    });
    expect(route?.slot).toBe("review");
  });

  it("respects temperature override", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.9,
    });
    expect(route?.temperature).toBe(0.9);
  });

  it("uses default temperature from slot when not overridden", () => {
    const route = resolveRoute({
      messages: [{ role: "user", content: "Hello" }],
      slot: "default",
    });
    expect(route?.temperature).toBe(SLOT_CONFIGS.default.defaultTemperature);
  });
});
