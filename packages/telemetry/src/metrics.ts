/**
 * Simple metrics registry for Prometheus exposition format.
 * Uses a lightweight in-memory approach compatible with prom-client.
 */

interface MetricValue {
  labels: Record<string, string>;
  timestamp?: number;
  value: number;
}

type MetricType = "counter" | "gauge" | "histogram";

interface MetricDefinition {
  buckets?: number[];
  help: string;
  name: string;
  type: MetricType;
  values: MetricValue[];
}

class MetricsRegistry {
  private readonly metrics = new Map<string, MetricDefinition>();

  counter(name: string, help: string): Counter {
    const def: MetricDefinition = { name, help, type: "counter", values: [] };
    this.metrics.set(name, def);
    return new Counter(def);
  }

  gauge(name: string, help: string): Gauge {
    const def: MetricDefinition = { name, help, type: "gauge", values: [] };
    this.metrics.set(name, def);
    return new Gauge(def);
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    const def: MetricDefinition = {
      name,
      help,
      type: "histogram",
      values: [],
      buckets: buckets ?? [
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ],
    };
    this.metrics.set(name, def);
    return new Histogram(def);
  }

  /**
   * Render all metrics in Prometheus exposition format.
   */
  render(): string {
    const lines: string[] = [];

    for (const [, metric] of this.metrics) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      for (const val of metric.values) {
        const labelStr = Object.entries(val.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        const labels = labelStr ? `{${labelStr}}` : "";
        lines.push(`${metric.name}${labels} ${val.value}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  /**
   * Reset all metrics (for testing).
   */
  reset(): void {
    for (const [, metric] of this.metrics) {
      metric.values = [];
    }
  }
}

class Counter {
  private readonly def: MetricDefinition;

  constructor(def: MetricDefinition) {
    this.def = def;
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const existing = this.def.values.find(
      (v) => JSON.stringify(v.labels) === JSON.stringify(labels)
    );
    if (existing) {
      existing.value += value;
    } else {
      this.def.values.push({ value, labels });
    }
  }
}

class Gauge {
  private readonly def: MetricDefinition;

  constructor(def: MetricDefinition) {
    this.def = def;
  }

  set(labels: Record<string, string>, value: number): void {
    const existing = this.def.values.find(
      (v) => JSON.stringify(v.labels) === JSON.stringify(labels)
    );
    if (existing) {
      existing.value = value;
    } else {
      this.def.values.push({ value, labels });
    }
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const existing = this.def.values.find(
      (v) => JSON.stringify(v.labels) === JSON.stringify(labels)
    );
    if (existing) {
      existing.value += value;
    } else {
      this.def.values.push({ value, labels });
    }
  }

  dec(labels: Record<string, string> = {}, value = 1): void {
    this.inc(labels, -value);
  }
}

class Histogram {
  private readonly def: MetricDefinition;

  constructor(def: MetricDefinition) {
    this.def = def;
  }

  observe(labels: Record<string, string>, value: number): void {
    // Record sum and count
    const sumKey = `${JSON.stringify(labels)}_sum`;
    const countKey = `${JSON.stringify(labels)}_count`;

    const sumVal = this.def.values.find(
      (v) => JSON.stringify(v.labels) === sumKey
    );
    if (sumVal) {
      sumVal.value += value;
    } else {
      this.def.values.push({ value, labels: { ...labels, le: "sum" } });
    }

    const countVal = this.def.values.find(
      (v) => JSON.stringify(v.labels) === countKey
    );
    if (countVal) {
      countVal.value += 1;
    } else {
      this.def.values.push({ value: 1, labels: { ...labels, le: "count" } });
    }

    // Record bucket counts
    for (const bucket of this.def.buckets ?? []) {
      if (value <= bucket) {
        const bucketLabel = { ...labels, le: String(bucket) };
        const existing = this.def.values.find(
          (v) => JSON.stringify(v.labels) === JSON.stringify(bucketLabel)
        );
        if (existing) {
          existing.value += 1;
        } else {
          this.def.values.push({ value: 1, labels: bucketLabel });
        }
      }
    }
  }
}

// Global registry instance
export const metricsRegistry = new MetricsRegistry();

// Pre-defined metrics for Prometheus platform
export const metrics = {
  // Orchestrator
  activeSessions: metricsRegistry.gauge(
    "prometheus_orchestrator_active_sessions",
    "Number of active orchestrator sessions"
  ),
  agentExecutions: metricsRegistry.counter(
    "prometheus_agent_total",
    "Total agent executions"
  ),
  agentSuccesses: metricsRegistry.counter(
    "prometheus_agent_success_total",
    "Successful agent executions"
  ),
  agentDuration: metricsRegistry.histogram(
    "prometheus_agent_duration_seconds",
    "Agent execution duration"
  ),
  agentConfidence: metricsRegistry.gauge(
    "prometheus_agent_confidence_score",
    "Agent confidence scores"
  ),

  // CI Loop
  ciLoopPassRate: metricsRegistry.gauge(
    "prometheus_ci_loop_pass_rate",
    "CI loop test pass rate"
  ),
  ciLoopIterations: metricsRegistry.counter(
    "prometheus_ci_loop_iterations_total",
    "CI loop iterations"
  ),

  // Model Router
  modelRequests: metricsRegistry.counter(
    "prometheus_model_requests_total",
    "Model router requests"
  ),
  modelLatency: metricsRegistry.histogram(
    "prometheus_model_latency_seconds",
    "Model response latency"
  ),
  modelCost: metricsRegistry.counter(
    "prometheus_model_cost_usd_total",
    "Model usage cost in USD"
  ),
  modelFallbacks: metricsRegistry.counter(
    "prometheus_model_fallback_total",
    "Model fallback count"
  ),
  modelTokens: metricsRegistry.counter(
    "prometheus_model_tokens_total",
    "Tokens consumed"
  ),

  // Queue
  queueDepth: metricsRegistry.gauge(
    "prometheus_queue_depth",
    "Queue depth by name"
  ),
  queueProcessed: metricsRegistry.counter(
    "prometheus_queue_processed_total",
    "Jobs processed"
  ),
  queueFailed: metricsRegistry.counter(
    "prometheus_queue_failed_total",
    "Jobs failed"
  ),

  // Sandbox
  activeSandboxes: metricsRegistry.gauge(
    "prometheus_sandbox_active_count",
    "Active sandboxes"
  ),

  // Billing
  creditsConsumed: metricsRegistry.counter(
    "prometheus_credits_consumed_total",
    "Credits consumed"
  ),
  creditBalance: metricsRegistry.gauge(
    "prometheus_credit_balance",
    "Credit balance per org"
  ),

  // HTTP
  httpRequests: metricsRegistry.counter(
    "prometheus_http_requests_total",
    "HTTP requests"
  ),
  httpDuration: metricsRegistry.histogram(
    "prometheus_http_duration_seconds",
    "HTTP request duration"
  ),
};

export { Counter, Gauge, Histogram, MetricsRegistry };
