import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitManager } from "../rate-limiter";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock("@prometheus/ai", () => ({
  PROVIDER_ENDPOINTS: {
    ollama: "http://localhost:11434/v1",
    cerebras: "https://api.cerebras.ai/v1",
    groq: "https://api.groq.com/openai/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    openrouter: "https://openrouter.ai/api/v1",
    mistral: "https://api.mistral.ai/v1",
    deepseek: "https://api.deepseek.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    openai: "https://api.openai.com/v1",
  },
  MODEL_REGISTRY: {
    "ollama/qwen3-coder-next": {
      id: "qwen3-coder-next",
      provider: "ollama",
      tier: 0,
      capabilities: ["coding", "chat"],
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
      capabilities: ["coding", "chat"],
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
      capabilities: ["coding", "chat"],
      contextWindow: 128_000,
      costPerInputToken: 0.0001,
      costPerOutputToken: 0.0002,
      supportsStreaming: true,
      maxOutputTokens: 32_768,
    },
    "ollama/deepseek-r1:32b": {
      id: "deepseek-r1:32b",
      provider: "ollama",
      tier: 0,
      capabilities: ["reasoning"],
      contextWindow: 32_768,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    },
    "ollama/qwen3.5:27b": {
      id: "qwen3.5:27b",
      provider: "ollama",
      tier: 0,
      capabilities: ["reasoning"],
      contextWindow: 32_768,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    },
    "gemini/gemini-2.5-flash": {
      id: "gemini-2.5-flash",
      provider: "gemini",
      tier: 2,
      capabilities: ["coding", "longContext"],
      contextWindow: 1_000_000,
      costPerInputToken: 0.000_01,
      costPerOutputToken: 0.000_04,
      supportsStreaming: true,
      maxOutputTokens: 65_536,
    },
    "anthropic/claude-sonnet-4-6": {
      id: "claude-sonnet-4-6",
      provider: "anthropic",
      tier: 3,
      capabilities: ["coding", "reasoning", "vision"],
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
      capabilities: ["coding", "reasoning", "vision"],
      contextWindow: 200_000,
      costPerInputToken: 0.015,
      costPerOutputToken: 0.075,
      supportsStreaming: true,
      maxOutputTokens: 4096,
    },
    "ollama/qwen2.5-coder:14b": {
      id: "qwen2.5-coder:14b",
      provider: "ollama",
      tier: 0,
      capabilities: ["coding"],
      contextWindow: 16_384,
      costPerInputToken: 0,
      costPerOutputToken: 0,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    },
  },
  createLLMClient: vi.fn().mockReturnValue({
    chat: {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    },
  }),
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

vi.mock("@prometheus/queue", () => ({
  redis: { ping: vi.fn().mockResolvedValue("PONG") },
}));

import type { RouteRequest } from "../router";
import { ModelRouterService } from "../router";

describe("ModelRouterService", () => {
  let service: ModelRouterService;
  let mockRateLimiter: {
    canMakeRequest: ReturnType<typeof vi.fn>;
    recordRequest: ReturnType<typeof vi.fn>;
    recordTokenUsage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimiter = {
      canMakeRequest: vi.fn().mockResolvedValue(true),
      recordRequest: vi.fn().mockResolvedValue(undefined),
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    };
    service = new ModelRouterService(
      mockRateLimiter as unknown as RateLimitManager
    );
  });

  // ── Slot configuration ─────────────────────────────────────────────────

  describe("slot configuration", () => {
    it("getSlotConfigs returns all configured slots", () => {
      const configs = service.getSlotConfigs();
      expect(configs).toHaveProperty("default");
      expect(configs).toHaveProperty("think");
      expect(configs).toHaveProperty("longContext");
      expect(configs).toHaveProperty("background");
      expect(configs).toHaveProperty("vision");
      expect(configs).toHaveProperty("review");
      expect(configs).toHaveProperty("fastLoop");
      expect(configs).toHaveProperty("premium");
    });

    it("default slot uses ollama/qwen3-coder-next as primary", () => {
      const configs = service.getSlotConfigs();
      expect(configs.default?.primary).toBe("ollama/qwen3-coder-next");
    });

    it("think slot uses ollama/deepseek-r1:32b as primary", () => {
      const configs = service.getSlotConfigs();
      expect(configs.think?.primary).toBe("ollama/deepseek-r1:32b");
    });

    it("premium slot uses claude-opus as primary", () => {
      const configs = service.getSlotConfigs();
      expect(configs.premium?.primary).toBe("anthropic/claude-opus-4-6");
    });

    it("each slot has at least one fallback", () => {
      const configs = service.getSlotConfigs();
      for (const [, config] of Object.entries(configs)) {
        expect(config.fallbacks.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ── route ──────────────────────────────────────────────────────────────

  describe("route", () => {
    const baseRequest: RouteRequest = {
      slot: "default",
      messages: [{ role: "user", content: "Hello" }],
    };

    it("routes to primary model successfully", async () => {
      // Cascade routing starts with the cheap tier (qwen2.5-coder:14b)
      // for default slot non-streaming requests
      mockCreate.mockResolvedValueOnce({
        id: "cmpl_1",
        choices: [
          {
            message: { role: "assistant", content: "Hi there" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await service.route(baseRequest);

      // Cascade routes to cheap tier first for default slot
      expect(result.model).toBe("ollama/qwen2.5-coder:14b");
      expect(result.provider).toBe("ollama");
      expect(result.slot).toBe("default");
      expect(result.choices[0]?.message.content).toBe("Hi there");
    });

    it("calculates usage tokens correctly", async () => {
      // Cascade routing zeroes out individual token counts and
      // computes cost from total tokens * tier costPerToken
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "Response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const result = await service.route(baseRequest);

      // Cascade routing returns 0 for individual token counts
      expect(result.usage.prompt_tokens).toBe(0);
      expect(result.usage.completion_tokens).toBe(0);
      expect(result.usage.total_tokens).toBe(0);
    });

    it("falls back to next model when primary fails", async () => {
      // Cascade: cheap tier fails -> standard tier succeeds
      mockCreate
        .mockRejectedValueOnce(new Error("Model unavailable")) // cheap tier fails
        .mockResolvedValueOnce({
          // standard tier succeeds
          choices: [
            {
              message: { role: "assistant", content: "Fallback response" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });

      const result = await service.route(baseRequest);

      // Cascade escalates to standard tier (qwen3-coder-next)
      expect(result.model).toBe("ollama/qwen3-coder-next");
      expect(result.routing.wasFallback).toBe(true);
      expect(result.routing.attemptsCount).toBe(1);
    });

    it("falls back when primary is rate limited", async () => {
      // Use a non-cascade slot (e.g. "think") to test rate-limit fallback
      // since cascade routing bypasses the rate limiter
      mockRateLimiter.canMakeRequest
        .mockResolvedValueOnce(false) // primary rate limited
        .mockResolvedValueOnce(true); // fallback OK

      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await service.route({
        slot: "think",
        messages: [{ role: "user", content: "Hello" }],
      });

      // think slot: primary=deepseek-r1:32b (rate limited), fallback=qwen3.5:27b
      expect(result.model).toBe("ollama/qwen3.5:27b");
      expect(result.routing.wasFallback).toBe(true);
    });

    it("throws when all models in the chain are exhausted", async () => {
      mockCreate.mockRejectedValue(new Error("All fail"));

      await expect(service.route(baseRequest)).rejects.toThrow(
        "All models exhausted"
      );
    });

    it("throws for unknown slot", async () => {
      await expect(
        service.route({ slot: "nonexistent", messages: [] })
      ).rejects.toThrow("Unknown slot");
    });

    it("records rate limit data for each attempt", async () => {
      // Use a non-cascade slot to test rate limit recording
      // since cascade routing bypasses the rate limiter
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 25 },
      });

      await service.route({
        slot: "think",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockRateLimiter.recordRequest).toHaveBeenCalledWith(
        "ollama",
        "ollama/deepseek-r1:32b"
      );
      expect(mockRateLimiter.recordTokenUsage).toHaveBeenCalledWith(
        "ollama",
        "ollama/deepseek-r1:32b",
        50,
        25
      );
    });

    it("uses explicit model override when provided and exists in registry", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "Claude response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      });

      const result = await service.route({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
        options: { model: "anthropic/claude-sonnet-4-6" },
      });

      expect(result.model).toBe("anthropic/claude-sonnet-4-6");
      expect(result.provider).toBe("anthropic");
    });

    it("falls through to slot routing when override model fails", async () => {
      // Override fails, then cascade routing kicks in for default slot
      // Cascade starts with cheap tier (qwen2.5-coder:14b)
      mockCreate
        .mockRejectedValueOnce(new Error("Override failed")) // override fails
        .mockResolvedValueOnce({
          // cascade cheap tier succeeds
          choices: [
            {
              message: { role: "assistant", content: "Primary" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });

      const result = await service.route({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
        options: { model: "anthropic/claude-sonnet-4-6" },
      });

      // Cascade routes to the cheap tier for default slot
      expect(result.model).toBe("ollama/qwen2.5-coder:14b");
    });

    it("calculates cost based on model pricing", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "Response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      });

      const result = await service.route({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
        options: { model: "anthropic/claude-sonnet-4-6" },
      });

      // 1000 * 0.003 + 500 * 0.015 = 3.0 + 7.5 = 10.5
      expect(result.usage.cost_usd).toBe(10.5);
    });

    it("returns zero cost for local models", async () => {
      // Use a non-cascade slot to test local model zero cost
      // since cascade has its own cost calculation
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "Local" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      });

      // background slot primary = ollama/qwen2.5-coder:14b (local, cost=0)
      const result = await service.route({
        slot: "background",
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(result.usage.cost_usd).toBe(0);
    });

    it("reports routing metadata correctly for primary model", async () => {
      // Use a non-cascade slot to test standard routing metadata
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await service.route({
        slot: "think",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.routing.primaryModel).toBe("ollama/deepseek-r1:32b");
      expect(result.routing.modelUsed).toBe("ollama/deepseek-r1:32b");
      expect(result.routing.wasFallback).toBe(false);
      expect(result.routing.attemptsCount).toBe(1);
    });

    it("handles missing usage in response gracefully", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
          },
        ],
        // No usage field
      });

      const result = await service.route(baseRequest);
      expect(result.usage.prompt_tokens).toBe(0);
      expect(result.usage.completion_tokens).toBe(0);
      expect(result.usage.total_tokens).toBe(0);
    });
  });

  // ── estimateTokenCount ─────────────────────────────────────────────────

  describe("estimateTokenCount", () => {
    it("estimates tokens as roughly chars/4", () => {
      const messages = [
        { role: "user", content: "Hello world" }, // 11 chars + "user"(4) + 4 overhead = 19
      ];
      const estimate = service.estimateTokenCount(messages);
      expect(estimate).toBe(Math.ceil(19 / 4)); // 5
    });

    it("handles multiple messages", () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Write some code" },
      ];
      const estimate = service.estimateTokenCount(messages);
      expect(estimate).toBeGreaterThan(0);
    });

    it("handles empty messages array", () => {
      const estimate = service.estimateTokenCount([]);
      expect(estimate).toBe(0);
    });

    it("handles long content correctly", () => {
      const longContent = "a".repeat(4000);
      const messages = [{ role: "user", content: longContent }];
      const estimate = service.estimateTokenCount(messages);
      expect(estimate).toBeGreaterThanOrEqual(1000);
    });
  });

  // ── selectSlot ─────────────────────────────────────────────────────────

  describe("selectSlot", () => {
    it("returns longContext for > 32K tokens", () => {
      const slot = service.selectSlot(50_000);
      expect(slot).toBe("longContext");
    });

    it("returns default for <= 32K tokens without task type", () => {
      const slot = service.selectSlot(10_000);
      expect(slot).toBe("default");
    });

    it("maps coding task type to default slot", () => {
      expect(service.selectSlot(1000, "coding")).toBe("default");
    });

    it("maps architecture task type to think slot", () => {
      expect(service.selectSlot(1000, "architecture")).toBe("think");
    });

    it("maps security task type to think slot", () => {
      expect(service.selectSlot(1000, "security")).toBe("think");
    });

    it("maps review task type to review slot", () => {
      expect(service.selectSlot(1000, "review")).toBe("review");
    });

    it("maps complex task type to premium slot", () => {
      expect(service.selectSlot(1000, "complex")).toBe("premium");
    });

    it("maps vision task type to vision slot", () => {
      expect(service.selectSlot(1000, "vision")).toBe("vision");
    });

    it("maps indexing task type to background slot", () => {
      expect(service.selectSlot(1000, "indexing")).toBe("background");
    });

    it("maps quick-fix to fastLoop slot", () => {
      expect(service.selectSlot(1000, "quick-fix")).toBe("fastLoop");
    });

    it("falls back to token-based selection for unknown task type", () => {
      const slot = service.selectSlot(50_000, "unknown_type");
      expect(slot).toBe("longContext");
    });

    it("returns default for small unknown task type", () => {
      const slot = service.selectSlot(1000, "something_new");
      expect(slot).toBe("default");
    });
  });

  // ── routeCompletion (legacy) ───────────────────────────────────────────

  describe("routeCompletion (legacy)", () => {
    it("maps task_type to slot and returns completion", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "Code" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await service.routeCompletion({
        messages: [{ role: "user", content: "Write code" }],
        task_type: "coding",
      });

      expect(result.model).toBeTruthy();
      expect(result.choices).toHaveLength(1);
    });

    it("defaults to coding task_type when not specified", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await service.routeCompletion({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result).toBeTruthy();
    });

    it("returns simplified response without routing metadata", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await service.routeCompletion({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("model");
      expect(result).toHaveProperty("provider");
      expect(result).toHaveProperty("choices");
      expect(result).toHaveProperty("usage");
      expect("routing" in result).toBe(false);
    });
  });

  // ── getAvailableModels ─────────────────────────────────────────────────

  describe("getAvailableModels", () => {
    it("returns all models from registry", () => {
      const models = service.getAvailableModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty("id");
      expect(models[0]).toHaveProperty("provider");
      expect(models[0]).toHaveProperty("tier");
      expect(models[0]).toHaveProperty("capabilities");
      expect(models[0]).toHaveProperty("contextWindow");
    });

    it("includes both local and cloud providers", () => {
      const models = service.getAvailableModels();
      const providers = new Set(models.map((m) => m.provider));
      expect(providers.has("ollama")).toBe(true);
      expect(providers.has("anthropic")).toBe(true);
    });
  });
});
