import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitManager } from "../rate-limiter";

const mockCreate = vi.fn();

vi.mock("@prometheus/ai", () => ({
  PROVIDER_ENDPOINTS: {
    ollama: "http://localhost:11434/v1",
    anthropic: "https://api.anthropic.com/v1",
  },
  MODEL_REGISTRY: {
    "ollama/qwen2.5-coder:32b": {
      id: "qwen2.5-coder:32b",
      provider: "ollama",
      tier: 0,
      capabilities: ["coding"],
      contextWindow: 32_768,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    },
    "ollama/qwen2.5-coder:14b": {
      id: "qwen2.5-coder:14b",
      provider: "ollama",
      tier: 0,
      capabilities: ["coding"],
      contextWindow: 32_768,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    },
    "ollama/qwen2.5-coder:7b": {
      id: "qwen2.5-coder:7b",
      provider: "ollama",
      tier: 0,
      capabilities: ["coding"],
      contextWindow: 32_768,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 4096,
    },
    "ollama/qwen2.5:14b": {
      id: "qwen2.5:14b",
      provider: "ollama",
      tier: 0,
      capabilities: ["reasoning"],
      contextWindow: 32_768,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    },
    "cerebras/qwen3-235b": {
      id: "qwen3-235b",
      provider: "cerebras",
      tier: 1,
      capabilities: ["coding"],
      contextWindow: 8192,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    },
    "groq/llama-3.3-70b-versatile": {
      id: "llama-3.3-70b-versatile",
      provider: "groq",
      tier: 1,
      capabilities: ["coding"],
      contextWindow: 128_000,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 32_768,
    },
    "gemini/gemini-2.5-flash": {
      id: "gemini-2.5-flash",
      provider: "gemini",
      tier: 2,
      capabilities: ["coding", "longContext"],
      contextWindow: 1_000_000,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 65_536,
    },
    "anthropic/claude-sonnet-4-6": {
      id: "claude-sonnet-4-6",
      provider: "anthropic",
      tier: 3,
      capabilities: ["coding", "reasoning"],
      contextWindow: 200_000,
      costPerInputToken: 0.003,
      costPerOutputToken: 0.015,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    },
    "anthropic/claude-opus-4-6": {
      id: "claude-opus-4-6",
      provider: "anthropic",
      tier: 4,
      capabilities: ["coding", "reasoning"],
      contextWindow: 200_000,
      costPerInputToken: 0.015,
      costPerOutputToken: 0.075,
      supportsStreaming: true,
      maxOutputTokens: 4096,
    },
  },
  createLLMClient: vi.fn().mockReturnValue({
    chat: {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    },
  }),
  createVercelProvider: vi.fn().mockReturnValue({
    specificationVersion: "v1",
    modelId: "mock-model",
    provider: "mock",
  }),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock123`),
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@prometheus/telemetry", () => ({
  withSpan: (_name: string, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: vi.fn() }),
  metricsRegistry: { render: vi.fn().mockResolvedValue("") },
}));

import { ModelRouterService } from "../router";

describe("ModelRouterService - circuit breaker", () => {
  let service: ModelRouterService;
  let mockRateLimiter: {
    canMakeRequest: ReturnType<typeof vi.fn>;
    recordRequest: ReturnType<typeof vi.fn>;
    recordTokenUsage: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimiter = {
      canMakeRequest: vi.fn().mockResolvedValue(true),
      recordRequest: vi.fn().mockResolvedValue(undefined),
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({}),
    };
    service = new ModelRouterService(
      mockRateLimiter as unknown as RateLimitManager
    );
  });

  describe("isProviderAvailable", () => {
    it("returns true when no failures have been recorded", () => {
      expect(service.isProviderAvailable("ollama")).toBe(true);
    });

    it("returns true for unknown providers", () => {
      expect(service.isProviderAvailable("new_provider")).toBe(true);
    });
  });

  describe("provider health checks", () => {
    it("checkProviderHealth returns health info for active providers", async () => {
      const health = await service.checkProviderHealth();
      expect(health).toBeDefined();
      expect(typeof health).toBe("object");
    });

    it("health check includes circuit breaker state", async () => {
      const health = await service.checkProviderHealth();
      for (const [, info] of Object.entries(health)) {
        expect(info.circuitBreaker).toHaveProperty("state");
        expect(info.circuitBreaker).toHaveProperty("errorRate");
        expect(info.circuitBreaker).toHaveProperty("totalRequests");
        expect(info.circuitBreaker).toHaveProperty("latencyP50Ms");
        expect(info.circuitBreaker).toHaveProperty("latencyP95Ms");
        expect(info.circuitBreaker).toHaveProperty("latencyP99Ms");
      }
    });

    it("newly initialized circuit breaker has zero error rate", async () => {
      const health = await service.checkProviderHealth();
      for (const [, info] of Object.entries(health)) {
        expect(info.circuitBreaker.errorRate).toBe(0);
        expect(info.circuitBreaker.state).toBe("closed");
      }
    });
  });

  describe("estimateTokenCount edge cases", () => {
    it("handles single character messages", () => {
      const estimate = service.estimateTokenCount([
        { role: "user", content: "a" },
      ]);
      expect(estimate).toBeGreaterThan(0);
    });

    it("returns 0 for empty array", () => {
      expect(service.estimateTokenCount([])).toBe(0);
    });

    it("accounts for role length in estimation", () => {
      const shortRole = service.estimateTokenCount([
        { role: "user", content: "test" },
      ]);
      const longRole = service.estimateTokenCount([
        { role: "assistant", content: "test" },
      ]);
      expect(longRole).toBeGreaterThan(shortRole);
    });
  });

  describe("getAvailableModels", () => {
    it("returns models with expected shape", () => {
      const models = service.getAvailableModels();
      expect(models.length).toBeGreaterThan(0);

      for (const model of models) {
        expect(typeof model.id).toBe("string");
        expect(typeof model.provider).toBe("string");
        expect(typeof model.tier).toBe("number");
        expect(Array.isArray(model.capabilities)).toBe(true);
        expect(typeof model.contextWindow).toBe("number");
        expect(typeof model.costPerInputToken).toBe("number");
        expect(typeof model.costPerOutputToken).toBe("number");
        expect(typeof model.supportsStreaming).toBe("boolean");
      }
    });
  });

  describe("selectSlot with messages", () => {
    it("prefers task type mapping over token count", () => {
      // Even with high token count, task type takes precedence
      expect(service.selectSlot(50_000, "coding")).toBe("default");
    });

    it("maps testing to fastLoop", () => {
      expect(service.selectSlot(1000, "testing")).toBe("fastLoop");
    });

    it("maps planning to think", () => {
      expect(service.selectSlot(1000, "planning")).toBe("think");
    });

    it("maps embedding to background", () => {
      expect(service.selectSlot(1000, "embedding")).toBe("background");
    });

    it("maps codebase-analysis to longContext", () => {
      expect(service.selectSlot(1000, "codebase-analysis")).toBe("longContext");
    });
  });

  describe("getSlotConfigs", () => {
    it("returns a copy that does not mutate internal state", () => {
      const configs1 = service.getSlotConfigs();
      const configs2 = service.getSlotConfigs();
      expect(configs1).toEqual(configs2);
      expect(configs1).not.toBe(configs2);
    });

    it("all slots have descriptions", () => {
      const configs = service.getSlotConfigs();
      for (const [, config] of Object.entries(configs)) {
        expect(config.description.length).toBeGreaterThan(0);
      }
    });

    it("includes speculate and embeddings slots", () => {
      const configs = service.getSlotConfigs();
      expect(configs).toHaveProperty("speculate");
      expect(configs).toHaveProperty("embeddings");
    });
  });
});
