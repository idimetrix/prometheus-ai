import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitManager } from "../rate-limiter";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockGenerateText = vi.fn();

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
    "ollama/qwen2.5-coder:32b": {
      id: "qwen2.5-coder:32b",
      provider: "ollama",
      tier: 0,
      capabilities: ["coding", "chat", "reasoning"],
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
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  streamText: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => schema),
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

    it("default slot uses anthropic/claude-sonnet-4-6 as primary", () => {
      const configs = service.getSlotConfigs();
      expect(configs.default?.primary).toBe("anthropic/claude-sonnet-4-6");
    });

    it("think slot uses anthropic/claude-sonnet-4-6 as primary", () => {
      const configs = service.getSlotConfigs();
      expect(configs.think?.primary).toBe("anthropic/claude-sonnet-4-6");
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

    it("routes to primary model successfully via cascade", async () => {
      // Cascade routing starts with the cheap tier (claude-sonnet-4-6)
      // for default slot non-streaming requests. The cascade uses
      // generateText via the Vercel AI SDK.
      mockGenerateText.mockResolvedValueOnce({
        text: "Hi there",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [],
        response: { id: "cmpl_1" },
      });

      const result = await service.route(baseRequest);

      // Cascade routes to cheap tier first for default slot
      expect(result.model).toBe("anthropic/claude-sonnet-4-6");
      expect(result.provider).toBe("anthropic");
      expect(result.slot).toBe("default");
      expect(result.choices[0]?.message.content).toBe("Hi there");
    });

    it("calculates usage tokens correctly", async () => {
      // Cascade routing zeroes out individual token counts
      mockGenerateText.mockResolvedValueOnce({
        text: "Response",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 50 },
        toolCalls: [],
        response: { id: "cmpl_1" },
      });

      const result = await service.route(baseRequest);

      // Cascade routing returns 0 for individual token counts
      expect(result.usage.prompt_tokens).toBe(0);
      expect(result.usage.completion_tokens).toBe(0);
      expect(result.usage.total_tokens).toBe(0);
    });

    it("falls back to next model when primary fails", async () => {
      // Cascade: cheap tier fails -> standard tier succeeds
      mockGenerateText
        .mockRejectedValueOnce(new Error("Model unavailable")) // cheap tier fails
        .mockResolvedValueOnce({
          // standard tier succeeds
          text: "Fallback response",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: [],
          response: { id: "cmpl_1" },
        });

      const result = await service.route(baseRequest);

      // Cascade escalates to standard tier (claude-sonnet-4-6)
      expect(result.model).toBe("anthropic/claude-sonnet-4-6");
      expect(result.routing.wasFallback).toBe(true);
      expect(result.routing.attemptsCount).toBe(1);
    });

    it("falls back when primary is rate limited", async () => {
      // Use think slot (non-cascade path) to test rate-limit fallback
      mockRateLimiter.canMakeRequest
        .mockResolvedValueOnce(false) // primary rate limited
        .mockResolvedValueOnce(true); // fallback OK

      mockGenerateText.mockResolvedValueOnce({
        text: "OK",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [],
        response: { id: "resp_1" },
      });

      const result = await service.route({
        slot: "think",
        messages: [{ role: "user", content: "Hello" }],
      });

      // think slot: primary=claude-sonnet-4-6 (rate limited), fallback=qwen2.5-coder:32b
      expect(result.model).toBe("ollama/qwen2.5-coder:32b");
      expect(result.routing.wasFallback).toBe(true);
    });

    it("throws when all models in the chain are exhausted", async () => {
      mockGenerateText.mockRejectedValue(new Error("All fail"));

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
      // Use think slot (non-cascade) to test rate limit recording via AI SDK
      mockGenerateText.mockResolvedValueOnce({
        text: "OK",
        finishReason: "stop",
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [],
        response: { id: "resp_1" },
      });

      await service.route({
        slot: "think",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockRateLimiter.recordRequest).toHaveBeenCalledWith(
        "anthropic",
        "anthropic/claude-sonnet-4-6"
      );
      expect(mockRateLimiter.recordTokenUsage).toHaveBeenCalledWith(
        "anthropic",
        "anthropic/claude-sonnet-4-6",
        50,
        25
      );
    });

    it("uses explicit model override when provided and exists in registry", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: "Claude response",
        finishReason: "stop",
        usage: { inputTokens: 20, outputTokens: 10 },
        toolCalls: [],
        response: { id: "resp_1" },
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
      // Override fails via generateText, then cascade routing kicks in for
      // default slot — also via generateText
      mockGenerateText
        .mockRejectedValueOnce(new Error("Override failed"))
        .mockResolvedValueOnce({
          text: "Primary",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: [],
          response: { id: "cmpl_1" },
        });

      const result = await service.route({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
        options: { model: "anthropic/claude-sonnet-4-6" },
      });

      // Cascade routes to the cheap tier for default slot
      expect(result.model).toBe("anthropic/claude-sonnet-4-6");
    });

    it("calculates cost based on model pricing", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: "Response",
        finishReason: "stop",
        usage: { inputTokens: 1000, outputTokens: 500 },
        toolCalls: [],
        response: { id: "resp_1" },
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
      // Use background slot (non-cascade) to test local model zero cost
      mockGenerateText.mockResolvedValueOnce({
        text: "Local",
        finishReason: "stop",
        usage: { inputTokens: 1000, outputTokens: 500 },
        toolCalls: [],
        response: { id: "resp_1" },
      });

      const result = await service.route({
        slot: "background",
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(result.usage.cost_usd).toBe(0);
    });

    it("reports routing metadata correctly for primary model", async () => {
      // Use think slot (non-cascade) to test standard routing metadata
      mockGenerateText.mockResolvedValueOnce({
        text: "OK",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [],
        response: { id: "resp_1" },
      });

      const result = await service.route({
        slot: "think",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.routing.primaryModel).toBe("anthropic/claude-sonnet-4-6");
      expect(result.routing.modelUsed).toBe("anthropic/claude-sonnet-4-6");
      expect(result.routing.wasFallback).toBe(false);
      expect(result.routing.attemptsCount).toBe(1);
    });

    it("handles missing usage in response gracefully", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: "OK",
        finishReason: "stop",
        usage: undefined,
        toolCalls: [],
        response: { id: "cmpl_1" },
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
      // coding -> default slot -> cascade -> generateText
      mockGenerateText.mockResolvedValueOnce({
        text: "Code",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [],
        response: { id: "cmpl_1" },
      });

      const result = await service.routeCompletion({
        messages: [{ role: "user", content: "Write code" }],
        task_type: "coding",
      });

      expect(result.model).toBeTruthy();
      expect(result.choices).toHaveLength(1);
    });

    it("defaults to coding task_type when not specified", async () => {
      // default -> cascade -> generateText
      mockGenerateText.mockResolvedValueOnce({
        text: "OK",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [],
        response: { id: "cmpl_1" },
      });

      const result = await service.routeCompletion({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result).toBeTruthy();
    });

    it("returns simplified response without routing metadata", async () => {
      // default -> cascade -> generateText
      mockGenerateText.mockResolvedValueOnce({
        text: "OK",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [],
        response: { id: "cmpl_1" },
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
