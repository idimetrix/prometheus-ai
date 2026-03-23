import { Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Per-service Prometheus metrics factory.
 *
 * Creates service-specific metric instances registered to a shared registry.
 * Each service gets relevant metrics based on its role.
 */

export interface ApiMetrics {
  requestLatencySeconds: Histogram;
  sseConnectionsActive: Gauge;
}

export interface OrchestratorMetrics {
  iterationsPerTask: Histogram;
  toolDistribution: Counter;
}

export interface ModelRouterMetrics {
  fallbackRate: Counter;
  requestsByProvider: Counter;
}

export interface QueueMetrics {
  dlqDepth: Gauge;
  processingTimeSeconds: Histogram;
}

export interface GenericServiceMetrics {
  activeConnections: Gauge;
  errorRate: Counter;
}

export interface ServiceMetrics {
  api: ApiMetrics;
  generic: GenericServiceMetrics;
  modelRouter: ModelRouterMetrics;
  orchestrator: OrchestratorMetrics;
  queue: QueueMetrics;
}

/**
 * Create a full set of per-service Prometheus metrics.
 *
 * @param serviceName - Name prefix for all metrics (e.g., "api", "orchestrator")
 * @param registry - Optional prom-client Registry. Creates a new one if omitted.
 */
export function createServiceMetrics(
  serviceName: string,
  registry?: Registry
): ServiceMetrics {
  const reg = registry ?? new Registry();
  const prefix = `prometheus_${serviceName}`;

  // API metrics
  const requestLatencySeconds = new Histogram({
    name: `${prefix}_request_latency_seconds`,
    help: "Request latency in seconds by router",
    labelNames: ["router", "method", "status"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [reg],
  });

  const sseConnectionsActive = new Gauge({
    name: `${prefix}_sse_connections_active`,
    help: "Number of active SSE connections",
    registers: [reg],
  });

  // Orchestrator metrics
  const iterationsPerTask = new Histogram({
    name: `${prefix}_iterations_per_task`,
    help: "Number of agent loop iterations per task",
    buckets: [1, 2, 5, 10, 20, 50, 100],
    registers: [reg],
  });

  const toolDistribution = new Counter({
    name: `${prefix}_tool_distribution_total`,
    help: "Tool usage distribution by tool name",
    labelNames: ["tool_name"] as const,
    registers: [reg],
  });

  // Model Router metrics
  const requestsByProvider = new Counter({
    name: `${prefix}_requests_by_provider_total`,
    help: "Requests by model provider",
    labelNames: ["provider", "model", "slot"] as const,
    registers: [reg],
  });

  const fallbackRate = new Counter({
    name: `${prefix}_fallback_total`,
    help: "Number of model fallback events",
    labelNames: ["from_provider", "to_provider", "reason"] as const,
    registers: [reg],
  });

  // Queue metrics
  const processingTimeSeconds = new Histogram({
    name: `${prefix}_queue_processing_time_seconds`,
    help: "Job processing time in seconds",
    labelNames: ["queue_name", "job_type"] as const,
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
    registers: [reg],
  });

  const dlqDepth = new Gauge({
    name: `${prefix}_dlq_depth`,
    help: "Dead letter queue depth",
    labelNames: ["queue_name"] as const,
    registers: [reg],
  });

  // Generic service metrics
  const activeConnections = new Gauge({
    name: `${prefix}_active_connections`,
    help: "Number of active connections",
    labelNames: ["type"] as const,
    registers: [reg],
  });

  const errorRate = new Counter({
    name: `${prefix}_error_total`,
    help: "Error count by type",
    labelNames: ["error_type", "severity"] as const,
    registers: [reg],
  });

  return {
    api: { requestLatencySeconds, sseConnectionsActive },
    orchestrator: { iterationsPerTask, toolDistribution },
    modelRouter: { requestsByProvider, fallbackRate },
    queue: { processingTimeSeconds, dlqDepth },
    generic: { activeConnections, errorRate },
  };
}
