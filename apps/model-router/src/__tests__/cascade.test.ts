import { describe, expect, it, vi } from "vitest";
import { CascadeRouter } from "../cascade";
import type {
  ModelRouterService,
  RouteRequest,
  RouteResponse,
} from "../router";

function createMockResponse(
  overrides: Partial<{
    content: string;
    finishReason: string;
    toolCalls: unknown[];
    costUsd: number;
  }>
): RouteResponse {
  return {
    id: "resp_test_1",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    slot: "default",
    choices: [
      {
        message: {
          role: "assistant",
          content:
            overrides.content ??
            "This is a well-structured response with detailed technical analysis.",
          tool_calls: overrides.toolCalls,
        },
        finish_reason: overrides.finishReason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
      cost_usd: overrides.costUsd ?? 0.001,
    },
    routing: {
      primaryModel: "claude-sonnet-4-20250514",
      modelUsed: "claude-sonnet-4-20250514",
      wasFallback: false,
      attemptsCount: 1,
    },
  };
}

function createMockRequest(slot = "default"): RouteRequest {
  return {
    slot,
    messages: [{ role: "user", content: "Write a function to sort an array" }],
    maxTokens: 4096,
  } as RouteRequest;
}

describe("CascadeRouter", () => {
  it("returns response from first slot when quality is high", async () => {
    const mockRouter: ModelRouterService = {
      route: vi.fn().mockResolvedValue(
        createMockResponse({
          content:
            "Here is a complete, well-documented function:\n\n```typescript\nfunction sort(arr: number[]): number[] {\n  return [...arr].sort((a, b) => a - b);\n}\n```\n\n## Usage\n\n1. Pass an array\n2. Get sorted result",
          finishReason: "stop",
        })
      ),
    } as unknown as ModelRouterService;

    const cascade = new CascadeRouter(mockRouter, {
      confidenceThreshold: 0.3,
      maxEscalations: 2,
    });

    const result = await cascade.route(createMockRequest());
    expect(result.routing.modelUsed).toBe("claude-sonnet-4-20250514");
    expect(mockRouter.route).toHaveBeenCalledTimes(1);
  });

  it("escalates when quality is below threshold", async () => {
    let callCount = 0;
    const mockRouter: ModelRouterService = {
      route: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            createMockResponse({
              content: "I can't help",
              finishReason: "length",
              costUsd: 0.0001,
            })
          );
        }
        return Promise.resolve(
          createMockResponse({
            content:
              "Here is a complete solution with detailed explanation:\n\n```typescript\nfunction sort(arr: number[]): number[] {\n  return [...arr].sort((a, b) => a - b);\n}\n```\n\n## Explanation\n\n- Uses spread to avoid mutation\n- Comparator for numeric sort",
            finishReason: "stop",
            costUsd: 0.01,
          })
        );
      }),
    } as unknown as ModelRouterService;

    const cascade = new CascadeRouter(mockRouter, {
      confidenceThreshold: 0.5,
      maxEscalations: 2,
    });

    const result = await cascade.route(createMockRequest());
    expect(mockRouter.route).toHaveBeenCalledTimes(2);
    expect(result.routing.wasFallback).toBe(true);
  });

  it("uses last slot in chain if all previous fail quality check", async () => {
    const mockRouter: ModelRouterService = {
      route: vi.fn().mockResolvedValue(
        createMockResponse({
          content: "short",
          finishReason: "length",
          costUsd: 0.0001,
        })
      ),
    } as unknown as ModelRouterService;

    const cascade = new CascadeRouter(mockRouter, {
      confidenceThreshold: 0.99,
      maxEscalations: 2,
    });

    const result = await cascade.route(createMockRequest());
    // Should still return even if quality is low on last slot
    expect(result).toBeDefined();
  });

  it("tracks metrics correctly", async () => {
    const mockRouter: ModelRouterService = {
      route: vi.fn().mockResolvedValue(
        createMockResponse({
          content:
            "Here is a complete, well-documented function:\n\n```typescript\nfunction sort(arr: number[]): number[] {\n  return [...arr].sort((a, b) => a - b);\n}\n```\n\n## Usage\n\n1. Pass an array\n2. Get sorted result",
          finishReason: "stop",
          costUsd: 0.001,
        })
      ),
    } as unknown as ModelRouterService;

    const cascade = new CascadeRouter(mockRouter, {
      confidenceThreshold: 0.3,
    });

    await cascade.route(createMockRequest());
    await cascade.route(createMockRequest());

    const metrics = cascade.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.requestsHandledCheap).toBe(2);
    expect(metrics.savingsPercentage).toBe(100);
  });

  it("handles slot error and escalates", async () => {
    let callCount = 0;
    const mockRouter: ModelRouterService = {
      route: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("Provider unavailable"));
        }
        return Promise.resolve(
          createMockResponse({
            content:
              "Here is the solution with full explanation and code examples that covers all edge cases properly.",
            finishReason: "stop",
          })
        );
      }),
    } as unknown as ModelRouterService;

    const cascade = new CascadeRouter(mockRouter, {
      confidenceThreshold: 0.3,
    });

    const result = await cascade.route(createMockRequest());
    expect(result).toBeDefined();
    expect(mockRouter.route).toHaveBeenCalledTimes(2);
  });
});
