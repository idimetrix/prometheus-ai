import { createLogger } from "@prometheus/logger";
import { LangfuseTracer } from "@prometheus/telemetry";

const logger = createLogger("model-router:langfuse");

/**
 * Model Router LLM observability — delegates to @prometheus/telemetry LangfuseTracer
 * for Langfuse API integration, while maintaining local metrics for the /metrics endpoint.
 */

interface TraceEvent {
  completionTokens: number;
  costUsd: number;
  error?: string;
  id: string;
  latencyMs: number;
  metadata?: Record<string, unknown>;
  model: string;
  promptTokens: number;
  provider: string;
  slot: string;
  success: boolean;
  timestamp: string;
  totalTokens: number;
}

const traces: TraceEvent[] = [];
const MAX_LOCAL_TRACES = 1000;

let tracer: LangfuseTracer | null = null;

/**
 * Initialize Langfuse connection via the shared telemetry package.
 */
export function initLangfuse(): void {
  tracer = new LangfuseTracer();
  if (tracer.isEnabled()) {
    logger.info("Langfuse LLM observability enabled via @prometheus/telemetry");
  } else {
    logger.info("Langfuse not configured — using local trace storage only");
  }
}

/**
 * Record an LLM completion trace.
 */
export function recordTrace(event: TraceEvent): void {
  // Always store locally for metrics
  traces.push(event);
  if (traces.length > MAX_LOCAL_TRACES) {
    traces.shift();
  }

  // Send to Langfuse via shared tracer if available
  if (tracer?.isEnabled()) {
    try {
      const traceId = tracer.trace({
        name: `${event.slot}/${event.model}`,
        metadata: {
          provider: event.provider,
          slot: event.slot,
          costUsd: event.costUsd,
          latencyMs: event.latencyMs,
        },
      });

      tracer.generation({
        traceId,
        name: `${event.provider}/${event.model}`,
        model: event.model,
        modelParameters: { provider: event.provider, slot: event.slot },
        input: event.metadata,
        usage: {
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
        },
        costUsd: event.costUsd,
        latencyMs: event.latencyMs,
        level: event.success ? "DEFAULT" : "ERROR",
        statusMessage: event.error,
      });
    } catch (err) {
      logger.warn({ error: String(err) }, "Failed to send trace to Langfuse");
    }
  }
}

/**
 * Get recent traces (for local dashboard / debugging).
 */
export function getRecentTraces(limit = 50): TraceEvent[] {
  return traces.slice(-limit);
}

/**
 * Get aggregated metrics from recent traces.
 */
export function getMetrics(): {
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  errorRate: number;
  modelBreakdown: Record<
    string,
    { calls: number; tokens: number; costUsd: number }
  >;
} {
  const modelBreakdown: Record<
    string,
    { calls: number; tokens: number; costUsd: number }
  > = {};
  let totalTokens = 0;
  let totalCost = 0;
  let totalLatency = 0;
  let errors = 0;

  for (const t of traces) {
    totalTokens += t.totalTokens;
    totalCost += t.costUsd;
    totalLatency += t.latencyMs;
    if (!t.success) {
      errors++;
    }

    if (!modelBreakdown[t.model]) {
      modelBreakdown[t.model] = { calls: 0, tokens: 0, costUsd: 0 };
    }
    const entry = modelBreakdown[t.model] as NonNullable<
      (typeof modelBreakdown)[string]
    >;
    entry.calls++;
    entry.tokens += t.totalTokens;
    entry.costUsd += t.costUsd;
  }

  return {
    totalCalls: traces.length,
    totalTokens,
    totalCostUsd: totalCost,
    avgLatencyMs: traces.length > 0 ? totalLatency / traces.length : 0,
    errorRate: traces.length > 0 ? errors / traces.length : 0,
    modelBreakdown,
  };
}
