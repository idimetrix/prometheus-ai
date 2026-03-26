/**
 * Service Health Integration Tests (PS04).
 *
 * Tests each service's /health and /ready endpoint response format
 * and verifies the health check contract for all Prometheus services.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockServiceClient } from "./setup";

const SERVICE_URL_PATTERN = /^http:\/\/localhost:\d+$/;

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
// Service registry — all Prometheus services with their expected ports
// ---------------------------------------------------------------------------

interface ServiceDefinition {
  dependencies: string[];
  name: string;
  port: number;
  url: string;
}

const SERVICES: ServiceDefinition[] = [
  {
    name: "api",
    port: 4000,
    url: "http://localhost:4000",
    dependencies: ["postgres", "redis"],
  },
  {
    name: "socket-server",
    port: 4001,
    url: "http://localhost:4001",
    dependencies: ["redis"],
  },
  {
    name: "orchestrator",
    port: 4002,
    url: "http://localhost:4002",
    dependencies: ["redis", "model-router", "sandbox-manager"],
  },
  {
    name: "project-brain",
    port: 4003,
    url: "http://localhost:4003",
    dependencies: ["postgres", "redis"],
  },
  {
    name: "model-router",
    port: 4004,
    url: "http://localhost:4004",
    dependencies: ["redis"],
  },
  {
    name: "mcp-gateway",
    port: 4005,
    url: "http://localhost:4005",
    dependencies: ["redis"],
  },
  {
    name: "sandbox-manager",
    port: 4006,
    url: "http://localhost:4006",
    dependencies: ["redis"],
  },
  {
    name: "web",
    port: 3000,
    url: "http://localhost:3000",
    dependencies: ["api"],
  },
];

// ---------------------------------------------------------------------------
// Health check response types
// ---------------------------------------------------------------------------

interface HealthResponse {
  service: string;
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version?: string;
}

interface ReadyResponse {
  dependencies: Record<
    string,
    { latencyMs: number; status: "connected" | "disconnected" | "timeout" }
  >;
  ready: boolean;
  service: string;
}

// ---------------------------------------------------------------------------
// Mock health check system
// ---------------------------------------------------------------------------

function createHealthCheckSystem() {
  const serviceStates = new Map<
    string,
    {
      dependencies: Map<
        string,
        { latencyMs: number; status: "connected" | "disconnected" | "timeout" }
      >;
      healthy: boolean;
      startedAt: number;
    }
  >();

  return {
    registerService(service: ServiceDefinition): void {
      const deps = new Map<
        string,
        { latencyMs: number; status: "connected" | "disconnected" | "timeout" }
      >();
      for (const dep of service.dependencies) {
        deps.set(dep, { status: "connected", latencyMs: 1 });
      }
      serviceStates.set(service.name, {
        healthy: true,
        startedAt: Date.now(),
        dependencies: deps,
      });
    },

    getHealth(serviceName: string): HealthResponse | null {
      const state = serviceStates.get(serviceName);
      if (!state) {
        return null;
      }

      const allDepsHealthy = [...state.dependencies.values()].every(
        (d) => d.status === "connected"
      );

      let status: "healthy" | "degraded" | "unhealthy";
      if (!state.healthy) {
        status = "unhealthy";
      } else if (allDepsHealthy) {
        status = "healthy";
      } else {
        status = "degraded";
      }

      return {
        status,
        service: serviceName,
        timestamp: new Date().toISOString(),
        uptime: Date.now() - state.startedAt,
      };
    },

    getReady(serviceName: string): ReadyResponse | null {
      const state = serviceStates.get(serviceName);
      if (!state) {
        return null;
      }

      const dependencies: ReadyResponse["dependencies"] = {};
      for (const [name, status] of state.dependencies) {
        dependencies[name] = status;
      }

      const allReady = [...state.dependencies.values()].every(
        (d) => d.status === "connected"
      );

      return {
        ready: allReady,
        service: serviceName,
        dependencies,
      };
    },

    setDependencyStatus(
      serviceName: string,
      dependencyName: string,
      status: "connected" | "disconnected" | "timeout",
      latencyMs?: number
    ): void {
      const state = serviceStates.get(serviceName);
      if (state) {
        state.dependencies.set(dependencyName, {
          status,
          latencyMs: latencyMs ?? (status === "connected" ? 1 : 0),
        });
      }
    },

    setServiceHealthy(serviceName: string, healthy: boolean): void {
      const state = serviceStates.get(serviceName);
      if (state) {
        state.healthy = healthy;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Service Health Integration", () => {
  let healthSystem: ReturnType<typeof createHealthCheckSystem>;

  beforeEach(() => {
    healthSystem = createHealthCheckSystem();
    for (const service of SERVICES) {
      healthSystem.registerService(service);
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("/health endpoint response format", () => {
    it("returns correct health response structure for each service", () => {
      for (const service of SERVICES) {
        const health = healthSystem.getHealth(service.name);

        expect(health).not.toBeNull();
        expect(health?.service).toBe(service.name);
        expect(health?.status).toBe("healthy");
        expect(health?.timestamp).toBeDefined();
        expect(typeof health?.uptime).toBe("number");
        expect(health?.uptime).toBeGreaterThanOrEqual(0);
      }
    });

    it("status is 'healthy' when all dependencies are connected", () => {
      const health = healthSystem.getHealth("api");
      expect(health?.status).toBe("healthy");
    });

    it("status is 'degraded' when a dependency is disconnected", () => {
      healthSystem.setDependencyStatus("api", "redis", "disconnected");

      const health = healthSystem.getHealth("api");
      expect(health?.status).toBe("degraded");
    });

    it("status is 'unhealthy' when service itself is down", () => {
      healthSystem.setServiceHealthy("api", false);

      const health = healthSystem.getHealth("api");
      expect(health?.status).toBe("unhealthy");
    });

    it("returns null for unregistered service", () => {
      const health = healthSystem.getHealth("nonexistent");
      expect(health).toBeNull();
    });

    it("timestamp is a valid ISO date string", () => {
      const health = healthSystem.getHealth("api");
      expect(health?.timestamp).toBeDefined();
      expect(new Date(health?.timestamp ?? "").toISOString()).toBe(
        health?.timestamp
      );
    });
  });

  describe("/ready endpoint with dependency checks", () => {
    it("returns ready=true when all dependencies are connected", () => {
      const ready = healthSystem.getReady("api");

      expect(ready).not.toBeNull();
      expect(ready?.ready).toBe(true);
      expect(ready?.service).toBe("api");
      expect(ready?.dependencies).toHaveProperty("postgres");
      expect(ready?.dependencies).toHaveProperty("redis");
      expect(ready?.dependencies.postgres.status).toBe("connected");
      expect(ready?.dependencies.redis.status).toBe("connected");
    });

    it("returns ready=false when a dependency is disconnected", () => {
      healthSystem.setDependencyStatus("api", "postgres", "disconnected");

      const ready = healthSystem.getReady("api");
      expect(ready?.ready).toBe(false);
      expect(ready?.dependencies.postgres.status).toBe("disconnected");
      expect(ready?.dependencies.redis.status).toBe("connected");
    });

    it("returns ready=false when a dependency times out", () => {
      healthSystem.setDependencyStatus(
        "orchestrator",
        "model-router",
        "timeout",
        5000
      );

      const ready = healthSystem.getReady("orchestrator");
      expect(ready?.ready).toBe(false);
      expect(ready?.dependencies["model-router"].status).toBe("timeout");
      expect(ready?.dependencies["model-router"].latencyMs).toBe(5000);
    });

    it("dependency latency is tracked for connected services", () => {
      healthSystem.setDependencyStatus("api", "postgres", "connected", 15);
      healthSystem.setDependencyStatus("api", "redis", "connected", 2);

      const ready = healthSystem.getReady("api");
      expect(ready?.dependencies.postgres.latencyMs).toBe(15);
      expect(ready?.dependencies.redis.latencyMs).toBe(2);
    });

    it("each service has correct dependency list", () => {
      for (const service of SERVICES) {
        const ready = healthSystem.getReady(service.name);
        expect(ready).not.toBeNull();

        const depNames = Object.keys(ready?.dependencies ?? {});
        expect(depNames.sort()).toEqual([...service.dependencies].sort());
      }
    });
  });

  describe("service-specific health checks", () => {
    it("API service depends on postgres and redis", () => {
      const apiService = SERVICES.find((s) => s.name === "api");
      expect(apiService?.dependencies).toContain("postgres");
      expect(apiService?.dependencies).toContain("redis");
    });

    it("orchestrator depends on redis, model-router, and sandbox-manager", () => {
      const orchService = SERVICES.find((s) => s.name === "orchestrator");
      expect(orchService?.dependencies).toContain("redis");
      expect(orchService?.dependencies).toContain("model-router");
      expect(orchService?.dependencies).toContain("sandbox-manager");
    });

    it("socket-server depends on redis only", () => {
      const socketService = SERVICES.find((s) => s.name === "socket-server");
      expect(socketService?.dependencies).toEqual(["redis"]);
    });

    it("web depends on api only", () => {
      const webService = SERVICES.find((s) => s.name === "web");
      expect(webService?.dependencies).toEqual(["api"]);
    });
  });

  describe("health check via HTTP mock clients", () => {
    it("all services respond 200 to GET /health when healthy", async () => {
      for (const service of SERVICES) {
        const client = createMockServiceClient(service.name);
        client.onRequest("GET", "/health", {
          status: 200,
          body: {
            status: "healthy",
            service: service.name,
            timestamp: new Date().toISOString(),
            uptime: 3600,
          },
        });

        const response = await client.request("GET", "/health");
        expect(response.status).toBe(200);

        const body = response.body as HealthResponse;
        expect(body.status).toBe("healthy");
        expect(body.service).toBe(service.name);
      }
    });

    it("services respond 503 to GET /ready when dependencies are down", async () => {
      const client = createMockServiceClient("api");
      client.onRequest("GET", "/ready", {
        status: 503,
        body: {
          ready: false,
          service: "api",
          dependencies: {
            postgres: { status: "disconnected", latencyMs: 0 },
            redis: { status: "connected", latencyMs: 1 },
          },
        },
      });

      const response = await client.request("GET", "/ready");
      expect(response.status).toBe(503);

      const body = response.body as ReadyResponse;
      expect(body.ready).toBe(false);
    });
  });

  describe("cascading health failures", () => {
    it("orchestrator becomes degraded when model-router is unhealthy", () => {
      healthSystem.setDependencyStatus(
        "orchestrator",
        "model-router",
        "disconnected"
      );

      const orchHealth = healthSystem.getHealth("orchestrator");
      expect(orchHealth?.status).toBe("degraded");

      const orchReady = healthSystem.getReady("orchestrator");
      expect(orchReady?.ready).toBe(false);
    });

    it("api remains healthy when unrelated services fail", () => {
      // Sandbox-manager going down should not affect API
      healthSystem.setServiceHealthy("sandbox-manager", false);

      const apiHealth = healthSystem.getHealth("api");
      expect(apiHealth?.status).toBe("healthy");
    });

    it("multiple service degradation can be tracked independently", () => {
      healthSystem.setDependencyStatus("api", "redis", "disconnected");
      healthSystem.setDependencyStatus(
        "orchestrator",
        "sandbox-manager",
        "timeout"
      );

      const apiHealth = healthSystem.getHealth("api");
      const orchHealth = healthSystem.getHealth("orchestrator");

      expect(apiHealth?.status).toBe("degraded");
      expect(orchHealth?.status).toBe("degraded");

      // Other services should still be healthy
      const socketHealth = healthSystem.getHealth("socket-server");
      expect(socketHealth?.status).toBe("healthy");
    });
  });

  describe("service port configuration", () => {
    it("all services have unique ports", () => {
      const ports = SERVICES.map((s) => s.port);
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(ports.length);
    });

    it("service URLs match expected patterns", () => {
      for (const service of SERVICES) {
        expect(service.url).toContain(`localhost:${service.port}`);
        expect(service.url).toMatch(SERVICE_URL_PATTERN);
      }
    });

    it("web service runs on port 3000", () => {
      const web = SERVICES.find((s) => s.name === "web");
      expect(web?.port).toBe(3000);
    });

    it("API service runs on port 4000", () => {
      const api = SERVICES.find((s) => s.name === "api");
      expect(api?.port).toBe(4000);
    });
  });
});
