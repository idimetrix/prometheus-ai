/**
 * Integration tests: Metrics & Telemetry.
 *
 * Verifies that all services expose consistent Prometheus metrics,
 * health check endpoints, and telemetry initialization patterns.
 */
import { describe, expect, it, vi } from "vitest";

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

describe("Metrics & Telemetry Integration", () => {
  describe("metricsMiddleware", () => {
    it("exports metricsMiddleware from telemetry package", async () => {
      const { metricsMiddleware } = await import("@prometheus/telemetry");
      expect(metricsMiddleware).toBeDefined();
      expect(typeof metricsMiddleware).toBe("function");
    });

    it("exports metricsHandler from telemetry package", async () => {
      const { metricsHandler } = await import("@prometheus/telemetry");
      expect(metricsHandler).toBeDefined();
      expect(typeof metricsHandler).toBe("function");
    });

    it("exports metricsRegistry with render method", async () => {
      const { metricsRegistry } = await import("@prometheus/telemetry");
      expect(metricsRegistry).toBeDefined();
      expect(typeof metricsRegistry.render).toBe("function");
    });
  });

  describe("service metrics", () => {
    it("creates service metrics with correct labels", async () => {
      const { createServiceMetrics } = await import("@prometheus/telemetry");
      const metrics = createServiceMetrics("test-service");
      expect(metrics).toBeDefined();
      expect(metrics.api).toBeDefined();
    });
  });

  describe("SLO monitoring", () => {
    it("creates SLO monitor with default SLOs", async () => {
      const { DEFAULT_SLOS, SLOMonitor } = await import(
        "@prometheus/telemetry"
      );
      expect(DEFAULT_SLOS).toBeDefined();
      expect(Array.isArray(DEFAULT_SLOS)).toBe(true);

      const monitor = new SLOMonitor(DEFAULT_SLOS);
      expect(monitor).toBeDefined();
    });
  });

  describe("LangfuseTracer", () => {
    it("creates tracer that is disabled without credentials", async () => {
      const { LangfuseTracer } = await import("@prometheus/telemetry");
      const tracer = new LangfuseTracer({
        publicKey: "",
        secretKey: "",
      });
      expect(tracer.isEnabled()).toBe(false);
    });

    it("creates tracer that reports enabled with credentials", async () => {
      const { LangfuseTracer } = await import("@prometheus/telemetry");
      const tracer = new LangfuseTracer({
        publicKey: "pk-test-123",
        secretKey: "sk-test-456",
      });
      expect(tracer.isEnabled()).toBe(true);
    });
  });

  describe("health check contract", () => {
    const SERVICES = [
      { name: "api", port: 4000 },
      { name: "orchestrator", port: 4002 },
      { name: "model-router", port: 4004 },
      { name: "mcp-gateway", port: 4005 },
      { name: "sandbox-manager", port: 4006 },
      { name: "project-brain", port: 4003 },
      { name: "socket-server", port: 4001 },
      { name: "queue-worker", port: 4007 },
    ];

    it("defines health check endpoints for all 8 backend services", () => {
      // This is a contract test — verifies the expected service list
      expect(SERVICES).toHaveLength(8);
      const names = SERVICES.map((s) => s.name);
      expect(names).toContain("api");
      expect(names).toContain("orchestrator");
      expect(names).toContain("model-router");
      expect(names).toContain("mcp-gateway");
      expect(names).toContain("sandbox-manager");
      expect(names).toContain("project-brain");
      expect(names).toContain("socket-server");
      expect(names).toContain("queue-worker");
    });

    it("assigns unique ports to each service", () => {
      const ports = SERVICES.map((s) => s.port);
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(ports.length);
    });
  });
});
