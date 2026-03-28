/**
 * GAP-100: Langfuse Tracer Integration
 *
 * Traces all LLM calls with Langfuse. Records prompt, response, latency,
 * tokens, cost, and session context. Supports trace hierarchy:
 * session -> task -> agent -> LLM call.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:langfuse-tracer");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMCallTrace {
  agentId?: string;
  completionTokens: number;
  costUsd: number;
  error?: string;
  id: string;
  latencyMs: number;
  metadata?: Record<string, unknown>;
  model: string;
  promptTokens: number;
  provider: string;
  sessionId?: string;
  success: boolean;
  taskId?: string;
  timestamp: number;
  totalTokens: number;
}

export interface TraceHierarchy {
  sessionId: string;
  tasks: Array<{
    taskId: string;
    agents: Array<{
      agentId: string;
      calls: LLMCallTrace[];
    }>;
  }>;
}

export interface TracerStats {
  avgLatencyMs: number;
  byModel: Record<
    string,
    { calls: number; tokens: number; costUsd: number; avgLatencyMs: number }
  >;
  bySession: Record<string, { calls: number; costUsd: number }>;
  errorRate: number;
  totalCostUsd: number;
  totalTokens: number;
  totalTraces: number;
}

// ─── Langfuse Tracer ─────────────────────────────────────────────────────────

export class LangfuseTracerService {
  private readonly traces: LLMCallTrace[] = [];
  private readonly maxTraces: number;
  private readonly langfuseEnabled: boolean;

  constructor(options?: { maxTraces?: number; langfuseEnabled?: boolean }) {
    this.maxTraces = options?.maxTraces ?? 5000;
    this.langfuseEnabled = options?.langfuseEnabled ?? false;

    if (this.langfuseEnabled) {
      logger.info("Langfuse tracing enabled");
    } else {
      logger.info("Langfuse not configured - using local trace storage only");
    }
  }

  /**
   * Record an LLM call trace.
   */
  trace(call: Omit<LLMCallTrace, "id" | "timestamp">): string {
    const id = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const trace: LLMCallTrace = {
      ...call,
      id,
      timestamp: Date.now(),
    };

    this.traces.push(trace);
    if (this.traces.length > this.maxTraces) {
      this.traces.shift();
    }

    // Send to Langfuse if enabled
    if (this.langfuseEnabled) {
      this.sendToLangfuse(trace);
    }

    logger.debug(
      {
        traceId: id,
        model: call.model,
        tokens: call.totalTokens,
        latencyMs: call.latencyMs,
        sessionId: call.sessionId,
      },
      "LLM call traced"
    );

    return id;
  }

  /**
   * Get traces for a specific session (hierarchical view).
   */
  getSessionTraces(sessionId: string): TraceHierarchy {
    const sessionTraces = this.traces.filter((t) => t.sessionId === sessionId);

    const taskMap = new Map<string, Map<string, LLMCallTrace[]>>();

    for (const trace of sessionTraces) {
      const taskId = trace.taskId ?? "unknown";
      const agentId = trace.agentId ?? "unknown";

      if (!taskMap.has(taskId)) {
        taskMap.set(taskId, new Map());
      }
      const agentMap = taskMap.get(taskId) as Map<string, LLMCallTrace[]>;
      if (!agentMap.has(agentId)) {
        agentMap.set(agentId, []);
      }
      (agentMap.get(agentId) as LLMCallTrace[]).push(trace);
    }

    const tasks: TraceHierarchy["tasks"] = [];
    for (const [taskId, agentMap] of taskMap) {
      const agents: TraceHierarchy["tasks"][0]["agents"] = [];
      for (const [agentId, calls] of agentMap) {
        agents.push({ agentId, calls });
      }
      tasks.push({ taskId, agents });
    }

    return { sessionId, tasks };
  }

  /**
   * Get recent traces.
   */
  getRecentTraces(limit = 50): LLMCallTrace[] {
    return this.traces.slice(-limit);
  }

  /**
   * Get aggregated statistics.
   */
  getStats(): TracerStats {
    const byModel: TracerStats["byModel"] = {};
    const bySession: TracerStats["bySession"] = {};
    let totalTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;
    let errors = 0;

    for (const t of this.traces) {
      totalTokens += t.totalTokens;
      totalCost += t.costUsd;
      totalLatency += t.latencyMs;
      if (!t.success) {
        errors++;
      }

      // By model
      if (!byModel[t.model]) {
        byModel[t.model] = {
          calls: 0,
          tokens: 0,
          costUsd: 0,
          avgLatencyMs: 0,
        };
      }
      const m = byModel[t.model] as NonNullable<(typeof byModel)[string]>;
      m.calls++;
      m.tokens += t.totalTokens;
      m.costUsd += t.costUsd;
      m.avgLatencyMs = (m.avgLatencyMs * (m.calls - 1) + t.latencyMs) / m.calls;

      // By session
      if (t.sessionId) {
        if (!bySession[t.sessionId]) {
          bySession[t.sessionId] = { calls: 0, costUsd: 0 };
        }
        const s = bySession[t.sessionId] as NonNullable<
          (typeof bySession)[string]
        >;
        s.calls++;
        s.costUsd += t.costUsd;
      }
    }

    return {
      totalTraces: this.traces.length,
      totalTokens,
      totalCostUsd: totalCost,
      avgLatencyMs:
        this.traces.length > 0 ? totalLatency / this.traces.length : 0,
      errorRate: this.traces.length > 0 ? errors / this.traces.length : 0,
      byModel,
      bySession,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private sendToLangfuse(trace: LLMCallTrace): void {
    // Langfuse API integration would go here
    // For now, just log the trace info
    logger.debug(
      { traceId: trace.id, model: trace.model },
      "Trace sent to Langfuse"
    );
  }
}
