import { createLogger } from "@prometheus/logger";

const logger = createLogger("service-health");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptionalService =
  | "mcp-gateway"
  | "model-router"
  | "project-brain"
  | "sandbox-manager";

interface HealthCacheEntry {
  healthy: boolean;
  lastCheck: Date;
}

interface ServiceEndpoint {
  name: OptionalService;
  url: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEALTH_CACHE_TTL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;

const SERVICE_ENDPOINTS: ServiceEndpoint[] = [
  {
    name: "mcp-gateway",
    url: process.env.MCP_GATEWAY_URL ?? "http://localhost:4005",
  },
  {
    name: "project-brain",
    url: process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003",
  },
  {
    name: "model-router",
    url: process.env.MODEL_ROUTER_URL ?? "http://localhost:4004",
  },
  {
    name: "sandbox-manager",
    url: process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006",
  },
];

// ---------------------------------------------------------------------------
// ServiceHealthMonitor
// ---------------------------------------------------------------------------

export class ServiceHealthMonitor {
  private readonly healthCache: Map<string, HealthCacheEntry> = new Map();

  /**
   * Check whether a specific optional service is healthy.
   * Returns a cached result if the last check was within the TTL window.
   */
  async isHealthy(service: OptionalService): Promise<boolean> {
    const cached = this.getCached(service);
    if (cached !== null) {
      return cached;
    }

    const endpoint = SERVICE_ENDPOINTS.find((e) => e.name === service);
    if (!endpoint) {
      return false;
    }

    const healthy = await this.ping(endpoint);
    this.healthCache.set(service, { healthy, lastCheck: new Date() });

    if (!healthy) {
      logger.warn(
        { service },
        "Optional service is unhealthy — will degrade gracefully"
      );
    }

    return healthy;
  }

  /**
   * Check all optional services and return a map of service -> healthy.
   */
  async checkAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    const checks = SERVICE_ENDPOINTS.map(async (endpoint) => {
      const healthy = await this.isHealthy(endpoint.name);
      results[endpoint.name] = healthy;
    });

    await Promise.all(checks);
    return results;
  }

  /**
   * Invalidate the cache entry for a specific service, forcing the next
   * isHealthy() call to perform a live check.
   */
  invalidate(service: OptionalService): void {
    this.healthCache.delete(service);
  }

  /**
   * Invalidate all cached health entries.
   */
  invalidateAll(): void {
    this.healthCache.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Return cached health status if valid, or null if stale / missing.
   */
  private getCached(service: string): boolean | null {
    const entry = this.healthCache.get(service);
    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.lastCheck.getTime();
    if (age > HEALTH_CACHE_TTL_MS) {
      return null;
    }

    return entry.healthy;
  }

  /**
   * Ping the /health endpoint of a service with a short timeout.
   */
  private async ping(endpoint: ServiceEndpoint): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS
      );

      const response = await fetch(`${endpoint.url}/health`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Resilient call wrapper
// ---------------------------------------------------------------------------

/**
 * Execute an async function that depends on an optional service.
 * If the service is unhealthy (based on cached health) or the call throws,
 * return the provided fallback value instead of propagating the error.
 *
 * This is the primary building block for graceful degradation in the agent
 * loop: wrap MCP gateway calls, Project Brain calls, etc. so the core
 * pipeline (API -> Queue -> Orchestrator -> LLM -> Sandbox) keeps working
 * even when optional services are down.
 */
export async function withGracefulDegradation<T>(
  monitor: ServiceHealthMonitor,
  service: OptionalService,
  fn: () => Promise<T>,
  fallback: T,
  context?: string
): Promise<T> {
  const healthy = await monitor.isHealthy(service);

  if (!healthy) {
    logger.warn(
      { service, context },
      "Skipping call to unhealthy service — using fallback"
    );
    return fallback;
  }

  try {
    return await fn();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(
      { service, context, error: msg },
      "Optional service call failed — degrading gracefully"
    );

    // Mark as unhealthy so subsequent calls within the TTL skip immediately
    monitor.invalidate(service);

    return fallback;
  }
}
