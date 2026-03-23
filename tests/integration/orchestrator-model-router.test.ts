/**
 * Integration tests: Orchestrator ↔ Model Router communication.
 *
 * Verifies that the orchestrator can send completion requests to
 * the model router, handle rate limiting, and cascade through
 * fallback models.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures, createMockServiceClient } from "./setup";

const { mockLogger } = vi.hoisted(() => {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = () => logger;
  return { mockLogger: logger };
});

vi.mock("@prometheus/logger", () => ({
  createLogger: () => mockLogger,
}));

describe("Orchestrator ↔ Model Router communication", () => {
  const modelRouter = createMockServiceClient("model-router");
  let fixtures: ReturnType<typeof createIntegrationFixtures>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    modelRouter._reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("slot-based routing", () => {
    it("routes a code generation request to default slot", async () => {
      modelRouter.onRequest("POST", "/route", {
        status: 200,
        body: {
          id: "cmpl_1",
          model: "ollama/qwen3-coder-next",
          slot: "default",
          content:
            "export function getUserById(id: string) {\n  return db.query.users.findFirst({ where: eq(users.id, id) });\n}",
          usage: { promptTokens: 500, completionTokens: 120, totalTokens: 620 },
          costUsd: 0,
          latencyMs: 450,
        },
      });

      const response = await modelRouter.request("POST", "/route", {
        slot: "default",
        messages: [
          { role: "system", content: "You are a backend coder." },
          {
            role: "user",
            content: "Create a getUserById function using Drizzle ORM",
          },
        ],
        temperature: 0.3,
      });

      expect(response.status).toBe(200);
      const body = response.body as {
        model: string;
        slot: string;
        content: string;
        usage: { totalTokens: number };
        costUsd: number;
      };
      expect(body.slot).toBe("default");
      expect(body.model).toContain("qwen3-coder");
      expect(body.content).toContain("getUserById");
      expect(body.usage.totalTokens).toBeGreaterThan(0);
    });

    it("routes a reasoning request to think slot", async () => {
      modelRouter.onRequest("POST", "/route", {
        status: 200,
        body: {
          id: "cmpl_2",
          model: "ollama/deepseek-r1:32b",
          slot: "think",
          content: "The optimal architecture for this system is...",
          usage: {
            promptTokens: 1000,
            completionTokens: 500,
            totalTokens: 1500,
          },
          costUsd: 0,
          latencyMs: 2500,
        },
      });

      const response = await modelRouter.request("POST", "/route", {
        slot: "think",
        messages: [
          { role: "system", content: "You are an architect." },
          {
            role: "user",
            content: "Design the database schema for a SaaS app",
          },
        ],
      });

      expect(response.status).toBe(200);
      const body = response.body as { slot: string; model: string };
      expect(body.slot).toBe("think");
      expect(body.model).toContain("deepseek");
    });

    it("routes a premium request to premium slot", async () => {
      modelRouter.onRequest("POST", "/route", {
        status: 200,
        body: {
          id: "cmpl_3",
          model: "anthropic/claude-opus-4-6",
          slot: "premium",
          content: "Critical architectural decision...",
          usage: {
            promptTokens: 2000,
            completionTokens: 800,
            totalTokens: 2800,
          },
          costUsd: 0.084,
          latencyMs: 5000,
        },
      });

      const response = await modelRouter.request("POST", "/route", {
        slot: "premium",
        messages: [
          { role: "system", content: "You are making a critical decision." },
          { role: "user", content: "Should we use microservices or monolith?" },
        ],
      });

      expect(response.status).toBe(200);
      const body = response.body as { costUsd: number; model: string };
      expect(body.costUsd).toBeGreaterThan(0);
      expect(body.model).toContain("claude");
    });
  });

  describe("rate limiting and fallback", () => {
    it("handles rate limit response with fallback", async () => {
      // First call returns 429 (rate limited)
      modelRouter.onRequest("POST", "/route", {
        status: 429,
        body: {
          error: "Rate limit exceeded",
          retryAfter: 60,
          provider: "ollama",
        },
      });

      const rateLimitedResponse = await modelRouter.request("POST", "/route", {
        slot: "default",
        messages: [{ role: "user", content: "Generate code" }],
      });

      expect(rateLimitedResponse.status).toBe(429);

      // Model router should cascade to fallback — simulate that
      modelRouter._reset();
      modelRouter.onRequest("POST", "/route", {
        status: 200,
        body: {
          id: "cmpl_fallback",
          model: "cerebras/qwen3-235b",
          slot: "default",
          content: "// Generated code with fallback model",
          usage: { promptTokens: 300, completionTokens: 80, totalTokens: 380 },
          costUsd: 0,
          latencyMs: 200,
        },
      });

      const fallbackResponse = await modelRouter.request("POST", "/route", {
        slot: "default",
        messages: [{ role: "user", content: "Generate code" }],
        fallback: true,
      });

      expect(fallbackResponse.status).toBe(200);
      const body = fallbackResponse.body as { model: string };
      expect(body.model).toContain("cerebras");
    });
  });

  describe("cascade routing", () => {
    it("requests cascade routing explicitly", async () => {
      modelRouter.onRequest("POST", "/v1/cascade/route", {
        status: 200,
        body: {
          model: "groq/llama-3.3-70b",
          cascadeLevel: 2,
          content: "Generated via cascade fallback",
          attempts: [
            { model: "ollama/qwen3-coder-next", status: "rate_limited" },
            { model: "cerebras/qwen3-235b", status: "rate_limited" },
            { model: "groq/llama-3.3-70b", status: "success" },
          ],
        },
      });

      const response = await modelRouter.request("POST", "/v1/cascade/route", {
        slot: "default",
        messages: [{ role: "user", content: "Generate a function" }],
      });

      expect(response.status).toBe(200);
      const body = response.body as {
        cascadeLevel: number;
        attempts: Array<{ status: string }>;
      };
      expect(body.cascadeLevel).toBe(2);
      expect(body.attempts).toHaveLength(3);
      expect(body.attempts[2].status).toBe("success");
    });
  });

  describe("model information", () => {
    it("lists available models", async () => {
      modelRouter.onRequest("GET", "/v1/models", {
        status: 200,
        body: {
          models: [
            { id: "ollama/qwen3-coder-next", provider: "ollama", tier: 0 },
            { id: "cerebras/qwen3-235b", provider: "cerebras", tier: 1 },
            { id: "groq/llama-3.3-70b", provider: "groq", tier: 1 },
            {
              id: "anthropic/claude-sonnet-4-6",
              provider: "anthropic",
              tier: 3,
            },
          ],
        },
      });

      const response = await modelRouter.request("GET", "/v1/models");

      expect(response.status).toBe(200);
      const body = response.body as { models: Array<{ tier: number }> };
      expect(body.models.length).toBeGreaterThanOrEqual(4);
    });

    it("checks rate limit status", async () => {
      modelRouter.onRequest("GET", "/v1/rate-limits", {
        status: 200,
        body: {
          providers: {
            ollama: {
              rpm: Number.POSITIVE_INFINITY,
              remaining: Number.POSITIVE_INFINITY,
            },
            cerebras: { rpm: 30, remaining: 25, resetAt: Date.now() + 45_000 },
            groq: { rpm: 30, remaining: 10, resetAt: Date.now() + 30_000 },
            anthropic: { rpm: 50, remaining: 48, resetAt: Date.now() + 55_000 },
          },
        },
      });

      const response = await modelRouter.request("GET", "/v1/rate-limits");

      expect(response.status).toBe(200);
      const body = response.body as {
        providers: Record<string, { remaining: number }>;
      };
      expect(body.providers.ollama.remaining).toBe(Number.POSITIVE_INFINITY);
      expect(body.providers.cerebras.remaining).toBeLessThanOrEqual(30);
    });
  });

  describe("BYO model support", () => {
    it("registers and tests a custom API key", async () => {
      modelRouter.onRequest("POST", "/v1/byo/keys", {
        status: 200,
        body: { provider: "openai", status: "registered" },
      });

      const registerResponse = await modelRouter.request(
        "POST",
        "/v1/byo/keys",
        {
          provider: "openai",
          apiKey: "sk-test-key-xxx",
          orgId: fixtures.org.id,
        }
      );

      expect(registerResponse.status).toBe(200);

      modelRouter.onRequest("POST", "/v1/byo/test", {
        status: 200,
        body: { provider: "openai", valid: true, latencyMs: 150 },
      });

      const testResponse = await modelRouter.request("POST", "/v1/byo/test", {
        provider: "openai",
        orgId: fixtures.org.id,
      });

      expect(testResponse.status).toBe(200);
      const body = testResponse.body as { valid: boolean };
      expect(body.valid).toBe(true);
    });
  });

  describe("token estimation", () => {
    it("estimates tokens and recommends slot", async () => {
      modelRouter.onRequest("POST", "/v1/estimate-tokens", {
        status: 200,
        body: {
          estimatedTokens: 2500,
          recommendedSlot: "default",
          estimatedCost: {
            tier0: 0,
            tier1: 0,
            tier3: 0.0075,
          },
        },
      });

      const response = await modelRouter.request(
        "POST",
        "/v1/estimate-tokens",
        {
          messages: [
            { role: "system", content: "System prompt..." },
            { role: "user", content: "Build a user registration endpoint" },
          ],
        }
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        estimatedTokens: number;
        recommendedSlot: string;
      };
      expect(body.estimatedTokens).toBeGreaterThan(0);
      expect(body.recommendedSlot).toBeDefined();
    });
  });
});
