import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:deep-health");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceStatus = "healthy" | "degraded" | "unhealthy";

export interface ServiceHealth {
  details?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
  name: string;
  status: ServiceStatus;
}

export interface DeepHealthResult {
  services: ServiceHealth[];
  status: ServiceStatus;
  timestamp: string;
  uptime: number;
}

// ─── Health Check Functions ───────────────────────────────────────────────────

const CHECK_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Health check timed out")), timeoutMs)
    ),
  ]);
}

async function checkDatabase(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await withTimeout(db.execute(sql`SELECT 1`), CHECK_TIMEOUT_MS);
    return {
      name: "database",
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      name: "database",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: msg,
    };
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const { redis } = await import("@prometheus/queue");
    await withTimeout(redis.ping(), CHECK_TIMEOUT_MS);
    return {
      name: "redis",
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      name: "redis",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: msg,
    };
  }
}

async function checkInternalService(
  name: string,
  url: string
): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch(`${url}/health`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) }),
      CHECK_TIMEOUT_MS
    );
    const status: ServiceStatus = response.ok ? "healthy" : "degraded";
    return {
      name,
      status,
      latencyMs: Date.now() - start,
      details: { httpStatus: response.status },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      name,
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: msg,
    };
  }
}

// ─── Service URL Resolution ───────────────────────────────────────────────────

function getServiceUrl(name: string): string {
  const envMap: Record<string, string> = {
    "model-router": process.env.MODEL_ROUTER_URL ?? "http://localhost:4004",
    "mcp-gateway": process.env.MCP_GATEWAY_URL ?? "http://localhost:4005",
    "project-brain": process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003",
    "sandbox-manager":
      process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006",
  };
  return envMap[name] ?? "http://localhost:4000";
}

// ─── Aggregate Status ─────────────────────────────────────────────────────────

function aggregateStatus(services: ServiceHealth[]): ServiceStatus {
  const hasUnhealthy = services.some((s) => s.status === "unhealthy");
  const hasDegraded = services.some((s) => s.status === "degraded");

  // Core services that must be healthy
  const coreServices = new Set(["database", "redis"]);
  const coreUnhealthy = services.some(
    (s) => coreServices.has(s.name) && s.status === "unhealthy"
  );

  if (coreUnhealthy) {
    return "unhealthy";
  }
  if (hasUnhealthy || hasDegraded) {
    return "degraded";
  }
  return "healthy";
}

// ─── Deep Health Handler ──────────────────────────────────────────────────────

const processStartTime = Date.now();

/**
 * Perform a deep health check of all services and dependencies.
 *
 * Checks: Database, Redis, Model Router, MCP Gateway, Project Brain, Sandbox Manager.
 * Each check has a 5-second timeout.
 */
export async function deepHealthCheck(): Promise<DeepHealthResult> {
  logger.debug("Starting deep health check");

  const internalServices = [
    "model-router",
    "mcp-gateway",
    "project-brain",
    "sandbox-manager",
  ];

  const checks = [
    checkDatabase(),
    checkRedis(),
    ...internalServices.map((name) =>
      checkInternalService(name, getServiceUrl(name))
    ),
  ];

  const services = await Promise.all(checks);
  const status = aggregateStatus(services);

  const result: DeepHealthResult = {
    status,
    timestamp: new Date().toISOString(),
    services,
    uptime: Math.floor((Date.now() - processStartTime) / 1000),
  };

  if (status !== "healthy") {
    const unhealthy = services
      .filter((s) => s.status !== "healthy")
      .map((s) => s.name);
    logger.warn(
      { status, unhealthyServices: unhealthy },
      "Deep health check detected issues"
    );
  }

  return result;
}
