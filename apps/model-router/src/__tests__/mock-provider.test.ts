import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Must mock before importing
vi.mock("@prometheus/utils", () => {
  let counter = 0;
  return { generateId: () => `mock_id_${++counter}` };
});

describe("Mock LLM Provider", () => {
  beforeEach(() => {
    process.env.DEV_MOCK_LLM = "true";
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.DEV_MOCK_LLM = undefined;
    vi.restoreAllMocks();
  });

  describe("isMockLLMEnabled", () => {
    it("returns true when DEV_MOCK_LLM=true and not production", async () => {
      const { isMockLLMEnabled } = await import("../mock-provider");
      expect(isMockLLMEnabled()).toBe(true);
    });

    it("returns false when DEV_MOCK_LLM is not set", async () => {
      process.env.DEV_MOCK_LLM = undefined;
      const { isMockLLMEnabled } = await import("../mock-provider");
      expect(isMockLLMEnabled()).toBe(false);
    });

    it("returns false in production", async () => {
      process.env.NODE_ENV = "production";
      const { isMockLLMEnabled } = await import("../mock-provider");
      expect(isMockLLMEnabled()).toBe(false);
    });
  });

  describe("mockRoute", () => {
    it("returns a valid RouteResponse shape", async () => {
      const { mockRoute } = await import("../mock-provider");
      const result = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("model", "mock/dev-model");
      expect(result).toHaveProperty("provider", "mock");
      expect(result).toHaveProperty("slot", "default");
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0]?.message.role).toBe("assistant");
      expect(result.choices[0]?.finish_reason).toBe("stop");
      expect(result.usage.cost_usd).toBe(0);
      expect(result.routing.wasFallback).toBe(false);
    });

    it("detects plan-related prompts", async () => {
      const { mockRoute } = await import("../mock-provider");
      const result = mockRoute({
        slot: "think",
        messages: [{ role: "user", content: "Plan the approach for this" }],
      });
      expect(result.choices[0]?.message.content).toContain("steps");
    });

    it("detects create/build prompts", async () => {
      const { mockRoute } = await import("../mock-provider");
      const result = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Create a REST API server" }],
      });
      expect(result.choices[0]?.message.content).toContain("implement");
    });

    it("detects fix/debug prompts", async () => {
      const { mockRoute } = await import("../mock-provider");
      const result = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Fix the null reference error" }],
      });
      expect(result.choices[0]?.message.content).toContain("fix");
    });

    it("detects test prompts", async () => {
      const { mockRoute } = await import("../mock-provider");
      const result = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Write tests for this module" }],
      });
      expect(result.choices[0]?.message.content).toContain("test");
    });

    it("generates tool calls when tools are provided", async () => {
      const { mockRoute } = await import("../mock-provider");
      const result = mockRoute({
        slot: "default",
        messages: [{ role: "user", content: "Do something" }],
        options: {
          tools: [
            {
              type: "function",
              function: {
                name: "file_write",
                description: "Write a file",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        },
      });

      expect(result.choices[0]?.message.tool_calls).toBeDefined();
      expect(result.choices[0]?.message.tool_calls).toHaveLength(1);
      expect(result.choices[0]?.finish_reason).toBe("tool_calls");
      // Content should be empty when tool calls are present
      expect(result.choices[0]?.message.content).toBe("");
    });
  });

  describe("mockRouteStream", () => {
    it("returns a valid StreamRouteResult shape", async () => {
      const { mockRouteStream } = await import("../mock-provider");
      const result = mockRouteStream({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("model", "mock/dev-model");
      expect(result).toHaveProperty("provider", "mock");
      expect(result).toHaveProperty("stream");
      expect(result).toHaveProperty("done");
    });

    it("streams all content chunks", async () => {
      const { mockRouteStream } = await import("../mock-provider");
      const result = mockRouteStream({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
      });

      const chunks: string[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk.content);
      }

      expect(chunks.length).toBeGreaterThan(0);
      // Last chunk should have finish_reason
      const fullContent = chunks.join("");
      expect(fullContent.length).toBeGreaterThan(0);
    });

    it("resolves done with usage stats", async () => {
      const { mockRouteStream } = await import("../mock-provider");
      const result = mockRouteStream({
        slot: "default",
        messages: [{ role: "user", content: "Hello" }],
      });

      // Consume stream
      for await (const _chunk of result.stream) {
        // drain
      }

      const done = await result.done;
      expect(done.usage.cost_usd).toBe(0);
      expect(done.usage.total_tokens).toBe(300);
      expect(done.routing.modelUsed).toBe("mock/dev-model");
    });
  });
});
