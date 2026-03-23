import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:langfuse");

/**
 * Lightweight Langfuse-compatible LLM observability tracker.
 * Records every LLM call with latency, cost, tokens, and model info.
 *
 * When LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set,
 * traces are sent to Langfuse. Otherwise, traces are logged locally.
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

let langfuseEnabled = false;
let langfuseBaseUrl = "";
let langfuseHeaders: Record<string, string> = {};

/**
 * Initialize Langfuse connection (call once at startup).
 */
export function initLangfuse(): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";

  if (publicKey && secretKey) {
    langfuseEnabled = true;
    langfuseBaseUrl = baseUrl;
    langfuseHeaders = {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
    };
    logger.info({ baseUrl }, "Langfuse LLM observability enabled");
  } else {
    logger.info("Langfuse not configured — using local trace storage");
  }
}

/**
 * Record an LLM completion trace.
 */
export async function recordTrace(event: TraceEvent): Promise<void> {
  // Always store locally
  traces.push(event);
  if (traces.length > MAX_LOCAL_TRACES) {
    traces.shift();
  }

  // Send to Langfuse if configured
  if (langfuseEnabled) {
    try {
      await fetch(`${langfuseBaseUrl}/api/public/ingestion`, {
        method: "POST",
        headers: langfuseHeaders,
        body: JSON.stringify({
          batch: [
            {
              id: event.id,
              type: "generation-create",
              timestamp: event.timestamp,
              body: {
                name: `${event.slot}/${event.model}`,
                model: event.model,
                modelParameters: { provider: event.provider, slot: event.slot },
                usage: {
                  promptTokens: event.promptTokens,
                  completionTokens: event.completionTokens,
                  totalTokens: event.totalTokens,
                },
                metadata: {
                  ...event.metadata,
                  costUsd: event.costUsd,
                  latencyMs: event.latencyMs,
                  provider: event.provider,
                  slot: event.slot,
                },
                level: event.success ? "DEFAULT" : "ERROR",
                statusMessage: event.error,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
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
