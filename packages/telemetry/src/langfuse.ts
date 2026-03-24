/**
 * Phase 5.10: Langfuse Observability Integration.
 *
 * Wraps LLM calls with Langfuse trace/span/generation events for
 * full observability of model interactions, token usage, and latency.
 *
 * Configuration via environment variables:
 *  - LANGFUSE_BASE_URL (default: https://cloud.langfuse.com)
 *  - LANGFUSE_PUBLIC_KEY
 *  - LANGFUSE_SECRET_KEY
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("telemetry:langfuse");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LangfuseConfig {
  baseUrl?: string;
  /** Whether to flush events synchronously (for testing). Default: false */
  flushOnEvent?: boolean;
  publicKey?: string;
  /** Release/version tag */
  release?: string;
  secretKey?: string;
}

export interface TraceParams {
  metadata?: Record<string, unknown>;
  name: string;
  sessionId?: string;
  tags?: string[];
  userId?: string;
}

export interface SpanParams {
  input?: unknown;
  metadata?: Record<string, unknown>;
  name: string;
  traceId: string;
}

export interface GenerationParams {
  /** Cost in USD */
  costUsd?: number;
  input: unknown;
  /** Duration in milliseconds */
  latencyMs?: number;
  level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
  metadata?: Record<string, unknown>;
  model: string;
  modelParameters?: Record<string, unknown>;
  name: string;
  output?: unknown;
  spanId?: string;
  statusMessage?: string;
  traceId: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

interface QueuedEvent {
  body: Record<string, unknown>;
  timestamp: string;
  type: "trace" | "span" | "generation" | "score";
}

// ---------------------------------------------------------------------------
// LangfuseTracer
// ---------------------------------------------------------------------------

export class LangfuseTracer {
  private readonly baseUrl: string;
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly release: string;
  private readonly flushOnEvent: boolean;
  private readonly eventQueue: QueuedEvent[] = [];
  private readonly enabled: boolean;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs = 5000;
  private readonly maxQueueSize = 100;

  constructor(config?: LangfuseConfig) {
    this.baseUrl =
      config?.baseUrl ??
      process.env.LANGFUSE_BASE_URL ??
      "https://cloud.langfuse.com";
    this.publicKey = config?.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY ?? "";
    this.secretKey = config?.secretKey ?? process.env.LANGFUSE_SECRET_KEY ?? "";
    this.release = config?.release ?? process.env.APP_VERSION ?? "0.1.0";
    this.flushOnEvent = config?.flushOnEvent ?? false;

    this.enabled = this.publicKey.length > 0 && this.secretKey.length > 0;

    if (this.enabled) {
      logger.info({ baseUrl: this.baseUrl }, "Langfuse tracer initialized");
      this.startFlushTimer();
    } else {
      logger.debug(
        "Langfuse tracer disabled (missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY)"
      );
    }
  }

  /**
   * Whether the tracer is enabled (has valid credentials).
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Create a new trace for an LLM interaction workflow.
   */
  trace(params: TraceParams): string {
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.enqueue({
      type: "trace",
      timestamp: new Date().toISOString(),
      body: {
        id: traceId,
        name: params.name,
        userId: params.userId,
        sessionId: params.sessionId,
        metadata: params.metadata,
        tags: params.tags,
        release: this.release,
      },
    });

    return traceId;
  }

  /**
   * Create a span within a trace for a sub-operation.
   */
  span(params: SpanParams): string {
    const spanId = `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.enqueue({
      type: "span",
      timestamp: new Date().toISOString(),
      body: {
        id: spanId,
        traceId: params.traceId,
        name: params.name,
        metadata: params.metadata,
        input: params.input,
        startTime: new Date().toISOString(),
      },
    });

    return spanId;
  }

  /**
   * End a span with output data.
   */
  endSpan(spanId: string, output?: unknown): void {
    this.enqueue({
      type: "span",
      timestamp: new Date().toISOString(),
      body: {
        id: spanId,
        output,
        endTime: new Date().toISOString(),
      },
    });
  }

  /**
   * Record an LLM generation event with model, tokens, and cost.
   */
  generation(params: GenerationParams): string {
    const generationId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.enqueue({
      type: "generation",
      timestamp: new Date().toISOString(),
      body: {
        id: generationId,
        traceId: params.traceId,
        parentObservationId: params.spanId,
        name: params.name,
        model: params.model,
        modelParameters: params.modelParameters,
        input: params.input,
        output: params.output,
        usage: params.usage
          ? {
              promptTokens: params.usage.promptTokens,
              completionTokens: params.usage.completionTokens,
              totalTokens: params.usage.totalTokens,
            }
          : undefined,
        metadata: {
          ...params.metadata,
          latencyMs: params.latencyMs,
          costUsd: params.costUsd,
        },
        level: params.level ?? "DEFAULT",
        statusMessage: params.statusMessage,
        startTime: new Date().toISOString(),
        completionStartTime: params.latencyMs
          ? new Date(Date.now() - params.latencyMs).toISOString()
          : undefined,
        endTime: new Date().toISOString(),
      },
    });

    return generationId;
  }

  /**
   * Record a quality/evaluation score for a trace.
   */
  score(params: {
    traceId: string;
    name: string;
    value: number;
    comment?: string;
  }): void {
    this.enqueue({
      type: "score",
      timestamp: new Date().toISOString(),
      body: {
        traceId: params.traceId,
        name: params.name,
        value: params.value,
        comment: params.comment,
      },
    });
  }

  /**
   * Flush all queued events to Langfuse.
   */
  async flush(): Promise<void> {
    if (!this.enabled || this.eventQueue.length === 0) {
      return;
    }

    const events = this.eventQueue.splice(0);

    try {
      const response = await fetch(`${this.baseUrl}/api/public/ingestion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${this.publicKey}:${this.secretKey}`)}`,
        },
        body: JSON.stringify({ batch: events }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        logger.debug({ eventCount: events.length }, "Langfuse events flushed");
      } else {
        const text = await response.text().catch(() => "");
        logger.warn(
          { status: response.status, body: text.slice(0, 200) },
          "Langfuse ingestion failed"
        );
        // Re-queue events on failure (up to max)
        if (this.eventQueue.length + events.length <= this.maxQueueSize * 2) {
          this.eventQueue.unshift(...events);
        }
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Langfuse flush failed"
      );
      // Re-queue on network error
      if (this.eventQueue.length + events.length <= this.maxQueueSize * 2) {
        this.eventQueue.unshift(...events);
      }
    }
  }

  /**
   * Shutdown the tracer, flushing remaining events.
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    logger.info("Langfuse tracer shut down");
  }

  /**
   * Get the number of queued events.
   */
  getQueueSize(): number {
    return this.eventQueue.length;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private enqueue(event: QueuedEvent): void {
    if (!this.enabled) {
      return;
    }

    this.eventQueue.push(event);

    // Flush if queue is full or flushOnEvent is enabled
    if (this.eventQueue.length >= this.maxQueueSize || this.flushOnEvent) {
      this.flush().catch(() => {
        /* best-effort */
      });
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        /* best-effort */
      });
    }, this.flushIntervalMs);

    // Allow the process to exit even if the timer is running
    if (
      this.flushTimer &&
      typeof this.flushTimer === "object" &&
      "unref" in this.flushTimer
    ) {
      this.flushTimer.unref();
    }
  }
}
