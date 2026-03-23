/**
 * Operations Dashboard Metrics
 *
 * Collects health and performance metrics from all 9 Prometheus services
 * and exports them in Grafana-compatible format.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:operations-metrics");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceHealth {
  errorRate: number;
  healthy: boolean;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  name: string;
  uptime: number;
  url: string;
}

export interface QueueDepth {
  active: number;
  completed: number;
  delayed: number;
  failed: number;
  name: string;
  waiting: number;
}

export interface SandboxUtilization {
  available: number;
  creating: number;
  inUse: number;
  poolSize: number;
  utilization: number;
}

export interface ModelLatency {
  modelKey: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  requestCount: number;
}

export interface ErrorRate {
  count: number;
  rate: number;
  service: string;
  topErrors: Array<{ message: string; count: number }>;
}

interface GrafanaMetric {
  labels: Record<string, string>;
  name: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Service URLs
// ---------------------------------------------------------------------------

const SERVICE_URLS: Record<string, string> = {
  web: process.env.WEB_URL ?? "http://localhost:3000",
  api: process.env.API_URL ?? "http://localhost:4000",
  "socket-server": process.env.SOCKET_SERVER_URL ?? "http://localhost:4001",
  orchestrator: process.env.ORCHESTRATOR_URL ?? "http://localhost:4002",
  "project-brain": process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003",
  "model-router": process.env.MODEL_ROUTER_URL ?? "http://localhost:4004",
  "mcp-gateway": process.env.MCP_GATEWAY_URL ?? "http://localhost:4005",
  "sandbox-manager": process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006",
  "queue-worker": process.env.QUEUE_WORKER_URL ?? "http://localhost:4007",
};

// ---------------------------------------------------------------------------
// OperationsMetrics
// ---------------------------------------------------------------------------

export class OperationsMetrics {
  private readonly errorCounts = new Map<string, Map<string, number>>();
  private readonly requestCounts = new Map<string, number>();
  private readonly latencyHistograms = new Map<string, number[]>();

  /**
   * Collect health metrics from all 9 services.
   */
  async collectServiceMetrics(): Promise<ServiceHealth[]> {
    const services: ServiceHealth[] = [];

    for (const [name, url] of Object.entries(SERVICE_URLS)) {
      const health = await this.checkServiceHealth(name, url);
      services.push(health);
    }

    const healthyCount = services.filter((s) => s.healthy).length;
    logger.info(
      { total: services.length, healthy: healthyCount },
      "Service metrics collected"
    );

    return services;
  }

  /**
   * Get BullMQ queue states.
   */
  async getQueueDepths(): Promise<QueueDepth[]> {
    try {
      const response = await fetch(`${SERVICE_URLS.api}/health/queues`, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return this.getFallbackQueueDepths();
      }

      return (await response.json()) as QueueDepth[];
    } catch {
      return this.getFallbackQueueDepths();
    }
  }

  /**
   * Get sandbox pool utilization stats.
   */
  async getSandboxUtilization(): Promise<SandboxUtilization> {
    try {
      const response = await fetch(
        `${SERVICE_URLS["sandbox-manager"]}/health/pool`,
        {
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!response.ok) {
        return this.getFallbackSandboxUtilization();
      }

      return (await response.json()) as SandboxUtilization;
    } catch {
      return this.getFallbackSandboxUtilization();
    }
  }

  /**
   * Get per-model latency percentiles.
   */
  async getModelLatencies(): Promise<ModelLatency[]> {
    try {
      const response = await fetch(
        `${SERVICE_URLS["model-router"]}/health/latencies`,
        {
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!response.ok) {
        return [];
      }

      return (await response.json()) as ModelLatency[];
    } catch {
      return [];
    }
  }

  /**
   * Get per-service error rates.
   */
  getErrorRates(): ErrorRate[] {
    const rates: ErrorRate[] = [];

    for (const [service, errors] of this.errorCounts) {
      const totalRequests = this.requestCounts.get(service) ?? 1;
      let totalErrors = 0;
      const topErrors: Array<{ message: string; count: number }> = [];

      for (const [message, count] of errors) {
        totalErrors += count;
        topErrors.push({ message, count });
      }

      topErrors.sort((a, b) => b.count - a.count);

      rates.push({
        service,
        rate: totalRequests > 0 ? totalErrors / totalRequests : 0,
        count: totalErrors,
        topErrors: topErrors.slice(0, 5),
      });
    }

    return rates;
  }

  /**
   * Record an error for a service.
   */
  recordError(service: string, errorMessage: string): void {
    if (!this.errorCounts.has(service)) {
      this.errorCounts.set(service, new Map());
    }
    const errors = this.errorCounts.get(service) as Map<string, number>;
    errors.set(errorMessage, (errors.get(errorMessage) ?? 0) + 1);
  }

  /**
   * Record a request for a service.
   */
  recordRequest(service: string, latencyMs?: number): void {
    this.requestCounts.set(service, (this.requestCounts.get(service) ?? 0) + 1);

    if (latencyMs !== undefined) {
      if (!this.latencyHistograms.has(service)) {
        this.latencyHistograms.set(service, []);
      }
      const histogram = this.latencyHistograms.get(service) as number[];
      histogram.push(latencyMs);
      // Keep last 1000 entries
      if (histogram.length > 1000) {
        histogram.splice(0, histogram.length - 1000);
      }
    }
  }

  /**
   * Export all metrics in Grafana-compatible format.
   */
  async toGrafanaFormat(): Promise<GrafanaMetric[]> {
    const metrics: GrafanaMetric[] = [];

    // Service health
    const services = await this.collectServiceMetrics();
    for (const svc of services) {
      metrics.push({
        name: "service_healthy",
        value: svc.healthy ? 1 : 0,
        labels: { service: svc.name },
      });
      metrics.push({
        name: "service_latency_p50_ms",
        value: svc.latencyP50Ms,
        labels: { service: svc.name },
      });
      metrics.push({
        name: "service_latency_p95_ms",
        value: svc.latencyP95Ms,
        labels: { service: svc.name },
      });
      metrics.push({
        name: "service_error_rate",
        value: svc.errorRate,
        labels: { service: svc.name },
      });
    }

    // Queue depths
    const queues = await this.getQueueDepths();
    for (const q of queues) {
      metrics.push({
        name: "queue_waiting",
        value: q.waiting,
        labels: { queue: q.name },
      });
      metrics.push({
        name: "queue_active",
        value: q.active,
        labels: { queue: q.name },
      });
      metrics.push({
        name: "queue_failed",
        value: q.failed,
        labels: { queue: q.name },
      });
    }

    // Sandbox utilization
    const sandbox = await this.getSandboxUtilization();
    metrics.push({
      name: "sandbox_utilization",
      value: sandbox.utilization,
      labels: {},
    });
    metrics.push({
      name: "sandbox_pool_size",
      value: sandbox.poolSize,
      labels: {},
    });

    return metrics;
  }

  // -----------------------------------------------------------------------
  // Internal Helpers
  // -----------------------------------------------------------------------

  private async checkServiceHealth(
    name: string,
    url: string
  ): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      const latency = Date.now() - startTime;
      const histogram = this.latencyHistograms.get(name) ?? [latency];

      return {
        name,
        url,
        healthy: response.ok,
        uptime: 1,
        latencyP50Ms: percentile(histogram, 0.5),
        latencyP95Ms: percentile(histogram, 0.95),
        latencyP99Ms: percentile(histogram, 0.99),
        errorRate: 0,
      };
    } catch {
      return {
        name,
        url,
        healthy: false,
        uptime: 0,
        latencyP50Ms: 0,
        latencyP95Ms: 0,
        latencyP99Ms: 0,
        errorRate: 1,
      };
    }
  }

  private getFallbackQueueDepths(): QueueDepth[] {
    return [
      {
        name: "task-queue",
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      },
    ];
  }

  private getFallbackSandboxUtilization(): SandboxUtilization {
    return {
      poolSize: 0,
      available: 0,
      inUse: 0,
      creating: 0,
      utilization: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}
