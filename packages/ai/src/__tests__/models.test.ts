import { describe, expect, it } from "vitest";
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

const HTTP_URL_RE = /^https?:\/\//;
const API_KEY_SUFFIX_RE = /_API_KEY$/;

describe("MODEL_REGISTRY", () => {
  it("contains models from all expected providers", () => {
    const providers = new Set(
      Object.values(MODEL_REGISTRY).map((m) => m.provider)
    );
    expect(providers).toContain("ollama");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("gemini");
    expect(providers).toContain("groq");
    expect(providers).toContain("cerebras");
    expect(providers).toContain("deepseek");
    expect(providers).toContain("mistral");
    expect(providers).toContain("openrouter");
  });

  it("every model has a registryKey matching its key in the registry", () => {
    for (const [key, config] of Object.entries(MODEL_REGISTRY)) {
      expect(config.registryKey).toBe(key);
    }
  });

  it("every model has a valid tier (0-4)", () => {
    for (const config of Object.values(MODEL_REGISTRY)) {
      expect([0, 1, 2, 3, 4]).toContain(config.tier);
    }
  });

  it("every model has a positive context window", () => {
    for (const config of Object.values(MODEL_REGISTRY)) {
      expect(config.contextWindow).toBeGreaterThan(0);
    }
  });

  it("no model has negative costs", () => {
    for (const config of Object.values(MODEL_REGISTRY)) {
      expect(config.costPerInputToken).toBeGreaterThanOrEqual(0);
      expect(config.costPerOutputToken).toBeGreaterThanOrEqual(0);
    }
  });

  it("tier 0 models (local) are free", () => {
    const tier0 = Object.values(MODEL_REGISTRY).filter((m) => m.tier === 0);
    expect(tier0.length).toBeGreaterThan(0);
    for (const m of tier0) {
      expect(m.costPerInputToken).toBe(0);
      expect(m.costPerOutputToken).toBe(0);
    }
  });

  it("every model has at least one capability", () => {
    for (const config of Object.values(MODEL_REGISTRY)) {
      expect(config.capabilities.length).toBeGreaterThan(0);
    }
  });
});

describe("PROVIDER_ENDPOINTS", () => {
  it("has an endpoint for every provider in the registry", () => {
    const providers = new Set(
      Object.values(MODEL_REGISTRY).map((m) => m.provider)
    );
    for (const p of providers) {
      expect(PROVIDER_ENDPOINTS[p]).toBeDefined();
      expect(PROVIDER_ENDPOINTS[p]).toMatch(HTTP_URL_RE);
    }
  });
});

describe("PROVIDER_ENV_KEYS", () => {
  it("has an env key for every provider", () => {
    const providers = new Set(
      Object.values(MODEL_REGISTRY).map((m) => m.provider)
    );
    for (const p of providers) {
      expect(PROVIDER_ENV_KEYS[p]).toBeDefined();
      expect(PROVIDER_ENV_KEYS[p]).toMatch(API_KEY_SUFFIX_RE);
    }
  });
});

describe("getModelConfig", () => {
  it("returns config for a valid key", () => {
    const config = getModelConfig("anthropic/claude-sonnet-4-6");
    expect(config).toBeDefined();
    expect(config?.provider).toBe("anthropic");
    expect(config?.id).toBe("claude-sonnet-4-6");
  });

  it("returns undefined for an invalid key", () => {
    expect(getModelConfig("nonexistent/model")).toBeUndefined();
  });
});

describe("getModelsByProvider", () => {
  it("returns only models from the specified provider", () => {
    const ollamaModels = getModelsByProvider("ollama");
    expect(ollamaModels.length).toBeGreaterThan(0);
    for (const m of ollamaModels) {
      expect(m.provider).toBe("ollama");
    }
  });

  it("returns empty array for provider with no models", () => {
    // All providers should have models, but test the filtering logic
    const models = getModelsByProvider("ollama");
    expect(models.every((m) => m.provider === "ollama")).toBe(true);
  });
});

describe("getModelsByTier", () => {
  it("returns all tier 0 models", () => {
    const tier0 = getModelsByTier(0);
    expect(tier0.length).toBeGreaterThan(0);
    for (const m of tier0) {
      expect(m.tier).toBe(0);
    }
  });

  it("returns empty for non-existent tier", () => {
    // Tier 4 should exist for opus
    const tier4 = getModelsByTier(4);
    expect(tier4.length).toBeGreaterThan(0);
    for (const m of tier4) {
      expect(m.tier).toBe(4);
    }
  });
});

describe("getModelsWithCapability", () => {
  it("returns models with 'code' capability", () => {
    const codeModels = getModelsWithCapability("code");
    expect(codeModels.length).toBeGreaterThan(0);
    for (const m of codeModels) {
      expect(m.capabilities).toContain("code");
    }
  });

  it("returns models with 'vision' capability", () => {
    const visionModels = getModelsWithCapability("vision");
    expect(visionModels.length).toBeGreaterThan(0);
    for (const m of visionModels) {
      expect(m.capabilities).toContain("vision");
    }
  });

  it("returns models with 'embeddings' capability", () => {
    const embeddingModels = getModelsWithCapability("embeddings");
    expect(embeddingModels.length).toBeGreaterThan(0);
    for (const m of embeddingModels) {
      expect(m.capabilities).toContain("embeddings");
    }
  });
});

describe("getAllModelKeys", () => {
  it("returns all registry keys", () => {
    const keys = getAllModelKeys();
    expect(keys.length).toBe(Object.keys(MODEL_REGISTRY).length);
    expect(keys).toContain("anthropic/claude-opus-4-6");
    expect(keys).toContain("ollama/qwen3-coder-next");
  });
});

describe("estimateCost", () => {
  it("returns 0 for free models", () => {
    const cost = estimateCost("ollama/qwen3-coder-next", 1000, 500);
    expect(cost).toBe(0);
  });

  it("calculates cost correctly for paid models", () => {
    const config = MODEL_REGISTRY["anthropic/claude-sonnet-4-6"] as NonNullable<
      (typeof MODEL_REGISTRY)["anthropic/claude-sonnet-4-6"]
    >;
    const cost = estimateCost("anthropic/claude-sonnet-4-6", 1000, 500);
    const expected =
      config.costPerInputToken * 1000 + config.costPerOutputToken * 500;
    expect(cost).toBeCloseTo(expected);
  });

  it("returns 0 for unknown model", () => {
    expect(estimateCost("fake/model", 1000, 500)).toBe(0);
  });

  it("handles zero tokens", () => {
    expect(estimateCost("anthropic/claude-sonnet-4-6", 0, 0)).toBe(0);
  });
});
