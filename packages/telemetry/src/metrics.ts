import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

const globalRegistry = new Registry();

collectDefaultMetrics({ register: globalRegistry });

const activeSessions = new Gauge({
  name: "prometheus_orchestrator_active_sessions",
  help: "Number of active orchestrator sessions",
  registers: [globalRegistry],
});

const agentExecutions = new Counter({
  name: "prometheus_agent_total",
  help: "Total agent executions",
  registers: [globalRegistry],
});

const agentSuccesses = new Counter({
  name: "prometheus_agent_success_total",
  help: "Successful agent executions",
  registers: [globalRegistry],
});

const agentDuration = new Histogram({
  name: "prometheus_agent_duration_seconds",
  help: "Agent execution duration",
  registers: [globalRegistry],
});

const agentConfidence = new Gauge({
  name: "prometheus_agent_confidence_score",
  help: "Agent confidence scores",
  registers: [globalRegistry],
});

const ciLoopPassRate = new Gauge({
  name: "prometheus_ci_loop_pass_rate",
  help: "CI loop test pass rate",
  registers: [globalRegistry],
});

const ciLoopIterations = new Counter({
  name: "prometheus_ci_loop_iterations_total",
  help: "CI loop iterations",
  registers: [globalRegistry],
});

const modelRequests = new Counter({
  name: "prometheus_model_requests_total",
  help: "Model router requests",
  registers: [globalRegistry],
});

const modelLatency = new Histogram({
  name: "prometheus_model_latency_seconds",
  help: "Model response latency",
  registers: [globalRegistry],
});

const modelCost = new Counter({
  name: "prometheus_model_cost_usd_total",
  help: "Model usage cost in USD",
  registers: [globalRegistry],
});

const modelFallbacks = new Counter({
  name: "prometheus_model_fallback_total",
  help: "Model fallback count",
  registers: [globalRegistry],
});

const modelTokens = new Counter({
  name: "prometheus_model_tokens_total",
  help: "Tokens consumed",
  registers: [globalRegistry],
});

const queueDepth = new Gauge({
  name: "prometheus_queue_depth",
  help: "Queue depth by name",
  registers: [globalRegistry],
});

const queueProcessed = new Counter({
  name: "prometheus_queue_processed_total",
  help: "Jobs processed",
  registers: [globalRegistry],
});

const queueFailed = new Counter({
  name: "prometheus_queue_failed_total",
  help: "Jobs failed",
  registers: [globalRegistry],
});

const activeSandboxes = new Gauge({
  name: "prometheus_sandbox_active_count",
  help: "Active sandboxes",
  registers: [globalRegistry],
});

const creditsConsumed = new Counter({
  name: "prometheus_credits_consumed_total",
  help: "Credits consumed",
  registers: [globalRegistry],
});

const creditBalance = new Gauge({
  name: "prometheus_credit_balance",
  help: "Credit balance per org",
  registers: [globalRegistry],
});

const httpRequests = new Counter({
  name: "prometheus_http_requests_total",
  help: "HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [globalRegistry],
});

const httpDuration = new Histogram({
  name: "prometheus_http_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route"] as const,
  registers: [globalRegistry],
});

const metrics = {
  activeSessions,
  agentExecutions,
  agentSuccesses,
  agentDuration,
  agentConfidence,
  ciLoopPassRate,
  ciLoopIterations,
  modelRequests,
  modelLatency,
  modelCost,
  modelFallbacks,
  modelTokens,
  queueDepth,
  queueProcessed,
  queueFailed,
  activeSandboxes,
  creditsConsumed,
  creditBalance,
  httpRequests,
  httpDuration,
};

const metricsRegistry = {
  registry: globalRegistry,
  async render(): Promise<string> {
    return await globalRegistry.metrics();
  },
  reset(): void {
    globalRegistry.resetMetrics();
  },
};

export type { Counter, Gauge, Histogram, Registry } from "prom-client";
export { globalRegistry, metrics, metricsRegistry };
