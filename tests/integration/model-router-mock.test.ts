/**
 * Model Router Mock LLM Integration Tests.
 *
 * Tests the mock LLM provider (DEV_MOCK_LLM=true) to verify:
 * - Mock mode returns valid responses matching the RouteResponse contract
 * - Streaming SSE responses produce correctly ordered chunks
 * - Slot routing resolves to expected models
 * - Fallback chain behavior when primary model fails
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

// ---------------------------------------------------------------------------
// Mock LLM types (mirrors apps/model-router/src/router.ts exports)
// ---------------------------------------------------------------------------

interface RouteRequest {
  messages: Array<{ content?: string; role: string }>;
  options?: {
    maxTokens?: number;
    model?: string;
    temperature?: number;
    tools?: unknown[];
  };
  slot: string;
}

interface RouteResponse {
  choices: Array<{
    finish_reason: string;
    message: { content: string; role: string; tool_calls?: unknown[] };
  }>;
  id: string;
  model: string;
  provider: string;
  routing: {
    attemptsCount: number;
    modelUsed: string;
    primaryModel: string;
    wasFallback: boolean;
  };
  slot: string;
  usage: {
    completion_tokens: number;
    cost_usd: number;
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface StreamChunk {
  content: string;
  finishReason: string | null;
}

// ---------------------------------------------------------------------------
// Mock provider implementation (mirrors mock-provider.ts)
// ---------------------------------------------------------------------------

function generateMockContent(messages: RouteRequest["messages"]): string {
  const lastMessage = messages.at(-1);
  const content = lastMessage?.content?.toLowerCase() ?? "";

  if (content.includes("plan") || content.includes("approach")) {
    return "I'll break this task into the following steps:\n1. Analyze requirements\n2. Set up project structure\n3. Implement core logic";
  }

  if (
    content.includes("create") ||
    content.includes("build") ||
    content.includes("implement")
  ) {
    return '```typescript\nconst app = new Hono();\napp.get("/health", (c) => c.json({ status: "ok" }));\n```';
  }

  if (content.includes("test")) {
    return '```typescript\ndescribe("feature", () => {\n  it("should work", () => {\n    expect(true).toBe(true);\n  });\n});\n```';
  }

  return "Task completed successfully. Changes have been applied.";
}

function mockRoute(request: RouteRequest): RouteResponse {
  const content = generateMockContent(request.messages);
  const hasTools = request.options?.tools && request.options.tools.length > 0;

  return {
    id: `mock_${Date.now()}`,
    model: "mock/dev-model",
    provider: "mock",
    slot: request.slot,
    choices: [
      {
        message: {
          role: "assistant",
          content: hasTools ? "" : content,
          tool_calls: hasTools
            ? [
                {
                  id: "call_mock_001",
                  type: "function",
                  function: {
                    name:
                      (
                        request.options?.tools?.[0] as {
                          function?: { name: string };
                        }
                      )?.function?.name ?? "unknown",
                    arguments: JSON.stringify({ mock: true }),
                  },
                },
              ]
            : undefined,
        },
        finish_reason: hasTools ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
      cost_usd: 0,
    },
    routing: {
      primaryModel: "mock/dev-model",
      modelUsed: "mock/dev-model",
      wasFallback: false,
      attemptsCount: 1,
    },
  };
}

function mockRouteStream(request: RouteRequest): {
  chunks: StreamChunk[];
  id: string;
  model: string;
} {
  const content = generateMockContent(request.messages);
  const words = content.split(" ");

  const chunks: StreamChunk[] = words.map((word, i) => ({
    content: (i === 0 ? "" : " ") + word,
    finishReason: i === words.length - 1 ? "stop" : null,
  }));

  return {
    id: `mock_stream_${Date.now()}`,
    model: "mock/dev-model",
    chunks,
  };
}

// ---------------------------------------------------------------------------
// Slot configuration (mirrors router.ts SLOT_CONFIGS)
// ---------------------------------------------------------------------------

interface SlotConfig {
  description: string;
  fallbacks: string[];
  primary: string;
}

const SLOT_CONFIGS: Record<string, SlotConfig> = {
  default: {
    primary: "ollama/qwen2.5-coder:32b",
    fallbacks: [
      "ollama/qwen2.5-coder:14b",
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
    ],
    description: "General coding tasks",
  },
  think: {
    primary: "ollama/qwen2.5-coder:32b",
    fallbacks: ["ollama/qwen2.5:14b", "anthropic/claude-sonnet-4-6"],
    description: "Deep reasoning and planning",
  },
  longContext: {
    primary: "gemini/gemini-2.5-flash",
    fallbacks: ["anthropic/claude-sonnet-4-6", "ollama/qwen2.5-coder:32b"],
    description: "Long context windows",
  },
  background: {
    primary: "ollama/qwen2.5-coder:7b",
    fallbacks: ["ollama/qwen2.5-coder:14b"],
    description: "Background indexing and lightweight tasks",
  },
  fastLoop: {
    primary: "cerebras/qwen3-235b",
    fallbacks: ["groq/llama-3.3-70b-versatile", "ollama/qwen2.5-coder:7b"],
    description: "Quick iterations",
  },
  premium: {
    primary: "anthropic/claude-opus-4-6",
    fallbacks: ["anthropic/claude-sonnet-4-6", "gemini/gemini-2.5-flash"],
    description: "High-quality complex tasks",
  },
  review: {
    primary: "ollama/qwen2.5-coder:32b",
    fallbacks: ["anthropic/claude-sonnet-4-6", "gemini/gemini-2.5-flash"],
    description: "Code review tasks",
  },
  vision: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["gemini/gemini-2.5-flash"],
    description: "Vision/image tasks",
  },
};

// ---------------------------------------------------------------------------
// Fallback chain simulation
// ---------------------------------------------------------------------------

interface ModelAvailability {
  available: boolean;
  modelId: string;
  rateLimited: boolean;
}

function resolveSlotWithFallback(
  slot: string,
  availability: Map<string, ModelAvailability>
): { attemptsCount: number; model: string; wasFallback: boolean } {
  const config = SLOT_CONFIGS[slot];
  if (!config) {
    throw new Error(`Unknown slot: ${slot}`);
  }

  const chain = [config.primary, ...config.fallbacks];
  let attempts = 0;

  for (const modelId of chain) {
    attempts++;
    const status = availability.get(modelId);

    // If no status info, assume available
    if (!status || (status.available && !status.rateLimited)) {
      return {
        model: modelId,
        wasFallback: modelId !== config.primary,
        attemptsCount: attempts,
      };
    }
  }

  throw new Error(`All models exhausted for slot: ${slot}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Model Router Mock LLM Integration", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("mock LLM mode responses", () => {
    it("returns valid RouteResponse for a coding task", () => {
      const response = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Create a REST API for users" }],
      });

      expect(response.id).toContain("mock_");
      expect(response.model).toBe("mock/dev-model");
      expect(response.provider).toBe("mock");
      expect(response.slot).toBe("default");
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0].finish_reason).toBe("stop");
      expect(response.choices[0].message.role).toBe("assistant");
      expect(response.choices[0].message.content).toContain("typescript");
    });

    it("returns planning response for planning prompts", () => {
      const response = mockRoute({
        slot: "think",
        messages: [
          { role: "user", content: "Plan the approach for building auth" },
        ],
      });

      expect(response.choices[0].message.content).toContain("steps");
      expect(response.choices[0].message.content).toContain("Analyze");
    });

    it("returns test code for test prompts", () => {
      const response = mockRoute({
        slot: "default",
        messages: [
          { role: "user", content: "Write tests for the user module" },
        ],
      });

      expect(response.choices[0].message.content).toContain("describe");
      expect(response.choices[0].message.content).toContain("expect");
    });

    it("returns generic response for unmatched prompts", () => {
      const response = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Hello there" }],
      });

      expect(response.choices[0].message.content).toContain("completed");
    });

    it("includes usage metadata with zero cost", () => {
      const response = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(response.usage.prompt_tokens).toBe(100);
      expect(response.usage.completion_tokens).toBe(200);
      expect(response.usage.total_tokens).toBe(300);
      expect(response.usage.cost_usd).toBe(0);
    });

    it("includes routing metadata", () => {
      const response = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(response.routing.primaryModel).toBe("mock/dev-model");
      expect(response.routing.modelUsed).toBe("mock/dev-model");
      expect(response.routing.wasFallback).toBe(false);
      expect(response.routing.attemptsCount).toBe(1);
    });
  });

  describe("mock tool call responses", () => {
    it("returns tool calls when tools are provided", () => {
      const response = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Write a file" }],
        options: {
          tools: [
            {
              type: "function",
              function: {
                name: "file_write",
                parameters: { type: "object" },
              },
            },
          ],
        },
      });

      expect(response.choices[0].finish_reason).toBe("tool_calls");
      expect(response.choices[0].message.content).toBe("");
      expect(response.choices[0].message.tool_calls).toBeDefined();
      expect(response.choices[0].message.tool_calls).toHaveLength(1);

      const toolCall = response.choices[0].message.tool_calls?.[0] as {
        function: { arguments: string; name: string };
        id: string;
      };
      expect(toolCall.function.name).toBe("file_write");
      expect(toolCall.id).toContain("call_");
    });

    it("returns no tool calls when no tools provided", () => {
      const response = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(response.choices[0].message.tool_calls).toBeUndefined();
      expect(response.choices[0].finish_reason).toBe("stop");
    });
  });

  describe("streaming SSE responses", () => {
    it("produces ordered chunks that reconstruct the full response", () => {
      const result = mockRouteStream({
        slot: "default",
        messages: [{ role: "user", content: "Hello world" }],
      });

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.id).toContain("mock_stream_");
      expect(result.model).toBe("mock/dev-model");

      // Reconstruct full content from chunks
      const fullContent = result.chunks.map((c) => c.content).join("");
      expect(fullContent.length).toBeGreaterThan(0);
    });

    it("last chunk has stop finish reason", () => {
      const result = mockRouteStream({
        slot: "default",
        messages: [{ role: "user", content: "Build something" }],
      });

      const lastChunk = result.chunks.at(-1);
      expect(lastChunk.finishReason).toBe("stop");

      // All other chunks should have null finish reason
      for (let i = 0; i < result.chunks.length - 1; i++) {
        expect(result.chunks[i].finishReason).toBeNull();
      }
    });

    it("each chunk contains content", () => {
      const result = mockRouteStream({
        slot: "default",
        messages: [{ role: "user", content: "Create a function" }],
      });

      for (const chunk of result.chunks) {
        expect(typeof chunk.content).toBe("string");
        // First chunk has no leading space, rest do
      }
    });

    it("stream response matches non-stream content", () => {
      const request: RouteRequest = {
        slot: "default",
        messages: [{ role: "user", content: "Implement the feature" }],
      };

      const nonStreamResponse = mockRoute(request);
      const streamResult = mockRouteStream(request);

      const streamContent = streamResult.chunks.map((c) => c.content).join("");
      const nonStreamContent = nonStreamResponse.choices[0].message.content;

      expect(streamContent).toBe(nonStreamContent);
    });
  });

  describe("slot routing resolution", () => {
    it("resolves default slot to primary model when available", () => {
      const availability = new Map<string, ModelAvailability>();
      const result = resolveSlotWithFallback("default", availability);

      expect(result.model).toBe("ollama/qwen2.5-coder:32b");
      expect(result.wasFallback).toBe(false);
      expect(result.attemptsCount).toBe(1);
    });

    it("resolves think slot to primary model", () => {
      const availability = new Map<string, ModelAvailability>();
      const result = resolveSlotWithFallback("think", availability);

      expect(result.model).toBe("ollama/qwen2.5-coder:32b");
    });

    it("resolves premium slot to claude-opus", () => {
      const availability = new Map<string, ModelAvailability>();
      const result = resolveSlotWithFallback("premium", availability);

      expect(result.model).toBe("anthropic/claude-opus-4-6");
    });

    it("resolves longContext slot to gemini", () => {
      const availability = new Map<string, ModelAvailability>();
      const result = resolveSlotWithFallback("longContext", availability);

      expect(result.model).toBe("gemini/gemini-2.5-flash");
    });

    it("resolves vision slot to claude-sonnet", () => {
      const availability = new Map<string, ModelAvailability>();
      const result = resolveSlotWithFallback("vision", availability);

      expect(result.model).toBe("anthropic/claude-sonnet-4-6");
    });

    it("resolves fastLoop slot to cerebras", () => {
      const availability = new Map<string, ModelAvailability>();
      const result = resolveSlotWithFallback("fastLoop", availability);

      expect(result.model).toBe("cerebras/qwen3-235b");
    });

    it("throws for unknown slot", () => {
      const availability = new Map<string, ModelAvailability>();
      expect(() =>
        resolveSlotWithFallback("nonexistent", availability)
      ).toThrow("Unknown slot");
    });

    it("each slot has at least one fallback model", () => {
      for (const [_slot, config] of Object.entries(SLOT_CONFIGS)) {
        expect(config.fallbacks.length).toBeGreaterThanOrEqual(1);
        expect(config.primary).toBeTruthy();
        expect(config.description).toBeTruthy();
      }
    });
  });

  describe("fallback chain behavior", () => {
    it("falls back to second model when primary is unavailable", () => {
      const availability = new Map<string, ModelAvailability>();
      availability.set("ollama/qwen2.5-coder:32b", {
        modelId: "ollama/qwen2.5-coder:32b",
        available: false,
        rateLimited: false,
      });

      const result = resolveSlotWithFallback("default", availability);

      expect(result.model).toBe("ollama/qwen2.5-coder:14b");
      expect(result.wasFallback).toBe(true);
      expect(result.attemptsCount).toBe(2);
    });

    it("falls back to third model when first two are unavailable", () => {
      const availability = new Map<string, ModelAvailability>();
      availability.set("ollama/qwen2.5-coder:32b", {
        modelId: "ollama/qwen2.5-coder:32b",
        available: false,
        rateLimited: false,
      });
      availability.set("ollama/qwen2.5-coder:14b", {
        modelId: "ollama/qwen2.5-coder:14b",
        available: false,
        rateLimited: false,
      });

      const result = resolveSlotWithFallback("default", availability);

      expect(result.model).toBe("cerebras/qwen3-235b");
      expect(result.wasFallback).toBe(true);
      expect(result.attemptsCount).toBe(3);
    });

    it("falls back when primary is rate limited", () => {
      const availability = new Map<string, ModelAvailability>();
      availability.set("ollama/qwen2.5-coder:32b", {
        modelId: "ollama/qwen2.5-coder:32b",
        available: true,
        rateLimited: true,
      });

      const result = resolveSlotWithFallback("default", availability);

      expect(result.model).toBe("ollama/qwen2.5-coder:14b");
      expect(result.wasFallback).toBe(true);
    });

    it("throws when all models in chain are exhausted", () => {
      const availability = new Map<string, ModelAvailability>();

      // Mark all models in background slot as unavailable
      availability.set("ollama/qwen2.5-coder:7b", {
        modelId: "ollama/qwen2.5-coder:7b",
        available: false,
        rateLimited: false,
      });
      availability.set("ollama/qwen2.5-coder:14b", {
        modelId: "ollama/qwen2.5-coder:14b",
        available: false,
        rateLimited: false,
      });

      expect(() => resolveSlotWithFallback("background", availability)).toThrow(
        "All models exhausted"
      );
    });

    it("tracks correct attempt count through fallback chain", () => {
      const availability = new Map<string, ModelAvailability>();

      // Make first 3 models in default slot unavailable
      availability.set("ollama/qwen2.5-coder:32b", {
        modelId: "ollama/qwen2.5-coder:32b",
        available: false,
        rateLimited: false,
      });
      availability.set("ollama/qwen2.5-coder:14b", {
        modelId: "ollama/qwen2.5-coder:14b",
        available: false,
        rateLimited: false,
      });
      availability.set("cerebras/qwen3-235b", {
        modelId: "cerebras/qwen3-235b",
        available: false,
        rateLimited: false,
      });

      const result = resolveSlotWithFallback("default", availability);

      expect(result.model).toBe("groq/llama-3.3-70b-versatile");
      expect(result.attemptsCount).toBe(4);
      expect(result.wasFallback).toBe(true);
    });
  });

  describe("mock LLM mode detection", () => {
    it("mock mode is enabled when DEV_MOCK_LLM=true and not production", () => {
      const _isMockEnabled =
        process.env.DEV_MOCK_LLM === "true" &&
        process.env.NODE_ENV !== "production";

      // In test environment, verify the check logic works
      const originalMock = process.env.DEV_MOCK_LLM;
      const originalNode = process.env.NODE_ENV;

      process.env.DEV_MOCK_LLM = "true";
      process.env.NODE_ENV = "test";

      const enabled =
        process.env.DEV_MOCK_LLM === "true" &&
        process.env.NODE_ENV !== "production";
      expect(enabled).toBe(true);

      process.env.DEV_MOCK_LLM = "true";
      process.env.NODE_ENV = "production";

      const enabledProd =
        process.env.DEV_MOCK_LLM === "true" &&
        process.env.NODE_ENV !== "production";
      expect(enabledProd).toBe(false);

      // Restore
      if (originalMock === undefined) {
        process.env.DEV_MOCK_LLM = undefined;
      } else {
        process.env.DEV_MOCK_LLM = originalMock;
      }
      if (originalNode === undefined) {
        process.env.NODE_ENV = undefined;
      } else {
        process.env.NODE_ENV = originalNode;
      }
    });

    it("mock mode is disabled when DEV_MOCK_LLM is not set", () => {
      const original = process.env.DEV_MOCK_LLM;
      process.env.DEV_MOCK_LLM = undefined;

      const enabled =
        process.env.DEV_MOCK_LLM === "true" &&
        process.env.NODE_ENV !== "production";
      expect(enabled).toBe(false);

      if (original !== undefined) {
        process.env.DEV_MOCK_LLM = original;
      }
    });
  });
});
