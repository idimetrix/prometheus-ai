import { describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  ProviderCircuitBreakerRegistry,
} from "../circuit-breaker";

const CIRCUIT_OPEN_PATTERN = /Circuit breaker.*is open/;

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker({ name: "test" });
    expect(cb.getState()).toBe("closed");
  });

  it("remains closed after successful executions", async () => {
    const cb = new CircuitBreaker({ name: "test" });
    await cb.execute(() => Promise.resolve("ok"));
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("closed");
    expect(cb.getMetrics().totalSuccesses).toBe(2);
  });

  it("opens after reaching failure threshold", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      failureWindowMs: 60_000,
      recoveryWindowMs: 30_000,
    });

    const fail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {
        // expected failure
      });
    }

    expect(cb.getState()).toBe("open");
    expect(cb.getMetrics().totalFailures).toBe(3);
  });

  it("rejects calls when circuit is open", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      failureWindowMs: 60_000,
      recoveryWindowMs: 60_000,
    });

    const fail = () => Promise.reject(new Error("fail"));
    await cb.execute(fail).catch(() => {
      // expected failure
    });
    await cb.execute(fail).catch(() => {
      // expected failure
    });

    expect(cb.getState()).toBe("open");

    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow(
      CIRCUIT_OPEN_PATTERN
    );
  });

  it("transitions to half-open after recovery window", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      failureWindowMs: 60_000,
      recoveryWindowMs: 100,
    });

    const fail = () => Promise.reject(new Error("fail"));
    await cb.execute(fail).catch(() => {
      // expected failure
    });
    await cb.execute(fail).catch(() => {
      // expected failure
    });

    expect(cb.getState()).toBe("open");

    // Wait for recovery window
    await new Promise((r) => setTimeout(r, 150));

    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("half-open");
  });

  it("closes again after enough successes in half-open", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      failureWindowMs: 60_000,
      recoveryWindowMs: 100,
      successThreshold: 2,
    });

    const fail = () => Promise.reject(new Error("fail"));
    await cb.execute(fail).catch(() => {
      // expected failure
    });
    await cb.execute(fail).catch(() => {
      // expected failure
    });

    await new Promise((r) => setTimeout(r, 150));

    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("half-open");

    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("closed");
  });

  it("reset brings circuit back to closed", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      failureWindowMs: 60_000,
    });

    const fail = () => Promise.reject(new Error("fail"));
    await cb.execute(fail).catch(() => {
      // expected failure
    });
    await cb.execute(fail).catch(() => {
      // expected failure
    });

    expect(cb.getState()).toBe("open");
    cb.reset();
    expect(cb.getState()).toBe("closed");
  });

  it("records transition history", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      failureWindowMs: 60_000,
    });

    const fail = () => Promise.reject(new Error("fail"));
    await cb.execute(fail).catch(() => {
      // expected failure
    });
    await cb.execute(fail).catch(() => {
      // expected failure
    });

    const history = cb.getTransitionHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]?.to).toBe("open");
  });

  it("calls onStateChange callback on transition", async () => {
    const onChange = vi.fn();
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      failureWindowMs: 60_000,
      onStateChange: onChange,
    });

    const fail = () => Promise.reject(new Error("fail"));
    await cb.execute(fail).catch(() => {
      // expected failure
    });
    await cb.execute(fail).catch(() => {
      // expected failure
    });

    expect(onChange).toHaveBeenCalledWith("closed", "open");
  });
});

describe("ProviderCircuitBreakerRegistry", () => {
  it("creates separate breakers per provider", () => {
    const registry = new ProviderCircuitBreakerRegistry();
    const a = registry.get("openai");
    const b = registry.get("anthropic");
    expect(a).not.toBe(b);
  });

  it("returns the same breaker for the same provider", () => {
    const registry = new ProviderCircuitBreakerRegistry();
    const a = registry.get("openai");
    const b = registry.get("openai");
    expect(a).toBe(b);
  });

  it("getAllMetrics returns metrics for all providers", async () => {
    const registry = new ProviderCircuitBreakerRegistry();
    await registry.execute("openai", () => Promise.resolve("ok"));
    await registry.execute("anthropic", () => Promise.resolve("ok"));

    const metrics = registry.getAllMetrics();
    expect(metrics.size).toBe(2);
    expect(metrics.get("openai")?.totalSuccesses).toBe(1);
    expect(metrics.get("anthropic")?.totalSuccesses).toBe(1);
  });

  it("resetAll resets all breakers", async () => {
    const registry = new ProviderCircuitBreakerRegistry({
      failureThreshold: 1,
      failureWindowMs: 60_000,
    });

    await registry
      .execute("openai", () => Promise.reject(new Error("fail")))
      .catch(() => {
        // expected failure
      });

    expect(registry.get("openai").getState()).toBe("open");

    registry.resetAll();
    expect(registry.get("openai").getState()).toBe("closed");
  });
});
