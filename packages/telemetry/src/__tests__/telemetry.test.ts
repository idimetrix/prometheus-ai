import { describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("prom-client", () => {
  class MockCounter {
    inc = vi.fn();
    labels = vi.fn().mockReturnThis();
  }
  class MockGauge {
    set = vi.fn();
    inc = vi.fn();
    dec = vi.fn();
    labels = vi.fn().mockReturnThis();
  }
  class MockHistogram {
    observe = vi.fn();
    labels = vi.fn().mockReturnThis();
  }
  class MockRegistry {
    metrics = vi.fn(async () => "# HELP prometheus_agent_total Total\n");
    resetMetrics = vi.fn();
    contentType = "text/plain; version=0.0.4";
    registerMetric = vi.fn();
  }
  return {
    Counter: MockCounter,
    Gauge: MockGauge,
    Histogram: MockHistogram,
    Registry: MockRegistry,
    collectDefaultMetrics: vi.fn(),
  };
});

vi.mock("@opentelemetry/api", () => {
  const mockSpan = {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };
  return {
    trace: {
      getTracer: vi.fn(() => ({
        startSpan: vi.fn(() => mockSpan),
        startActiveSpan: vi.fn(
          (
            _name: string,
            _opts: unknown,
            cb: (s: typeof mockSpan) => unknown
          ) => cb(mockSpan)
        ),
      })),
    },
    context: { active: vi.fn() },
    SpanStatusCode: { OK: 1, ERROR: 2, UNSET: 0 },
    _mockSpan: mockSpan,
  };
});

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  TraceIdRatioBasedSampler: class {},
}));

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(() => "event-id"),
  captureMessage: vi.fn(() => "event-id"),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
  flush: vi.fn(async () => true),
  httpIntegration: vi.fn(() => ({})),
  startSpan: vi.fn((_opts: unknown, cb: (s: unknown) => unknown) =>
    cb({ setAttribute: vi.fn(), setStatus: vi.fn() })
  ),
}));

// ── Tests (all imports are dynamic to avoid circular reference issues) ───────

describe("metrics object", () => {
  it("exports activeSessions gauge with set method", async () => {
    const { metrics } = await import("../metrics");
    expect(metrics.activeSessions).toBeDefined();
    expect(typeof metrics.activeSessions.set).toBe("function");
  });

  it("exports agentExecutions counter with inc method", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.agentExecutions.inc).toBe("function");
  });

  it("exports agentSuccesses counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.agentSuccesses.inc).toBe("function");
  });

  it("exports agentDuration histogram with observe method", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.agentDuration.observe).toBe("function");
  });

  it("exports agentConfidence gauge", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.agentConfidence.set).toBe("function");
  });

  it("exports ciLoopPassRate gauge", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.ciLoopPassRate.set).toBe("function");
  });

  it("exports ciLoopIterations counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.ciLoopIterations.inc).toBe("function");
  });

  it("exports modelRequests counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.modelRequests.inc).toBe("function");
  });

  it("exports modelLatency histogram", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.modelLatency.observe).toBe("function");
  });

  it("exports modelCost counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.modelCost.inc).toBe("function");
  });

  it("exports modelFallbacks counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.modelFallbacks.inc).toBe("function");
  });

  it("exports modelTokens counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.modelTokens.inc).toBe("function");
  });

  it("exports queueDepth gauge", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.queueDepth.set).toBe("function");
  });

  it("exports queueProcessed counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.queueProcessed.inc).toBe("function");
  });

  it("exports queueFailed counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.queueFailed.inc).toBe("function");
  });

  it("exports activeSandboxes gauge", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.activeSandboxes.set).toBe("function");
  });

  it("exports creditsConsumed counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.creditsConsumed.inc).toBe("function");
  });

  it("exports creditBalance gauge", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.creditBalance.set).toBe("function");
  });

  it("exports httpRequests counter", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.httpRequests.inc).toBe("function");
  });

  it("exports httpDuration histogram", async () => {
    const { metrics } = await import("../metrics");
    expect(typeof metrics.httpDuration.observe).toBe("function");
  });

  it("exports exactly 20 metric keys", async () => {
    const { metrics } = await import("../metrics");
    expect(Object.keys(metrics)).toHaveLength(20);
  });
});

describe("metricsRegistry", () => {
  it("has a render method that returns metrics string", async () => {
    const { metricsRegistry } = await import("../metrics");
    const rendered = await metricsRegistry.render();
    expect(typeof rendered).toBe("string");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("has a reset method", async () => {
    const { metricsRegistry } = await import("../metrics");
    expect(typeof metricsRegistry.reset).toBe("function");
    expect(() => metricsRegistry.reset()).not.toThrow();
  });

  it("has a registry property", async () => {
    const { metricsRegistry } = await import("../metrics");
    expect(metricsRegistry.registry).toBeDefined();
  });

  it("registry is the globalRegistry", async () => {
    const { metricsRegistry, globalRegistry } = await import("../metrics");
    expect(metricsRegistry.registry).toBe(globalRegistry);
  });
});

describe("withSpan", () => {
  it("executes function within a span and returns result", async () => {
    const { withSpan } = await import("../index");
    const result = await withSpan("test-op", async (span) => {
      await Promise.resolve();
      span.setAttribute("test", "value");
      return 42;
    });
    expect(result).toBe(42);
  });

  it("rethrows on failure", async () => {
    const { withSpan } = await import("../index");
    await expect(
      withSpan("fail-op", async () => {
        await Promise.resolve();
        throw new Error("operation failed");
      })
    ).rejects.toThrow("operation failed");
  });

  it("passes span to the callback", async () => {
    const { withSpan } = await import("../index");
    const callback = vi.fn().mockResolvedValue("result");
    await withSpan("cb-test", callback);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ setAttribute: expect.any(Function) })
    );
  });

  it("returns different types correctly", async () => {
    const { withSpan } = await import("../index");
    expect(await withSpan("num", async () => 42)).toBe(42);
    expect(await withSpan("str", async () => "hello")).toBe("hello");
    expect(await withSpan("obj", async () => ({ a: 1 }))).toEqual({ a: 1 });
  });
});

describe("withSpanSync", () => {
  it("executes synchronous function within a span", async () => {
    const { withSpanSync } = await import("../index");
    const result = withSpanSync("sync-op", (span) => {
      span.setAttribute("key", "val");
      return "sync-result";
    });
    expect(result).toBe("sync-result");
  });

  it("rethrows on failure", async () => {
    const { withSpanSync } = await import("../index");
    expect(() =>
      withSpanSync("sync-fail", () => {
        throw new Error("sync error");
      })
    ).toThrow("sync error");
  });
});

describe("getTracer", () => {
  it("returns a tracer instance", async () => {
    const { getTracer } = await import("../index");
    const tracer = getTracer();
    expect(tracer).toBeDefined();
  });

  it("accepts custom tracer name", async () => {
    const { getTracer } = await import("../index");
    const tracer = getTracer("custom");
    expect(tracer).toBeDefined();
  });
});

describe("startSpan", () => {
  it("creates and returns a span", async () => {
    const { startSpan } = await import("../index");
    const span = startSpan("test-span");
    expect(span).toBeDefined();
    expect(typeof span.setAttribute).toBe("function");
    expect(typeof span.end).toBe("function");
  });
});

describe("Sentry wrappers", () => {
  it("captureException returns undefined when not initialized", async () => {
    const { captureException } = await import("../sentry");
    expect(captureException(new Error("test"))).toBeUndefined();
  });

  it("captureMessage returns undefined when not initialized", async () => {
    const { captureMessage } = await import("../sentry");
    expect(captureMessage("test")).toBeUndefined();
  });

  it("flushSentry returns true when not initialized", async () => {
    const { flushSentry } = await import("../sentry");
    expect(await flushSentry()).toBe(true);
  });

  it("initSentry does not throw without DSN", async () => {
    const { initSentry } = await import("../sentry");
    expect(() => initSentry({ serviceName: "test" })).not.toThrow();
  });
});
