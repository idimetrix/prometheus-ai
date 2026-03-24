import {
  type Span,
  type SpanOptions,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

export type { Span, SpanOptions } from "@opentelemetry/api";
export { context, SpanStatusCode, trace } from "@opentelemetry/api";
export { registerDebugEndpoints } from "./debug";
export { serviceAuthMiddleware, traceMiddleware } from "./hono-middleware";
export type { InitTelemetryConfig } from "./init";
export { initTelemetry as initTelemetryV2 } from "./init";
export type {
  GenerationParams,
  LangfuseConfig,
  SpanParams,
  TraceParams,
} from "./langfuse";
export { LangfuseTracer } from "./langfuse";
export { metrics, metricsRegistry } from "./metrics";
export { metricsHandler, metricsMiddleware } from "./metrics-middleware";
export {
  createTracedFetch,
  extractTraceContext,
  injectTraceHeaders,
} from "./propagation";
export type { SentryConfig } from "./sentry";
export {
  addBreadcrumb,
  captureException,
  captureMessage,
  flushSentry,
  initSentry,
  setUser,
} from "./sentry";
export type {
  ApiMetrics,
  GenericServiceMetrics,
  ModelRouterMetrics,
  OrchestratorMetrics,
  QueueMetrics,
  ServiceMetrics,
} from "./service-metrics";
export { createServiceMetrics } from "./service-metrics";
export type { SLODefinition } from "./slo";
export { DEFAULT_SLOS, SLOMonitor } from "./slo";

export interface TelemetryConfig {
  /** Whether to enable auto-instrumentation of HTTP, DB, Redis, etc. (default: true) */
  autoInstrument?: boolean;
  /** OTLP endpoint for traces (defaults to OTEL_EXPORTER_OTLP_ENDPOINT or http://localhost:4318) */
  endpoint?: string;
  /** Trace sampling ratio 0-1 (default: 1.0 in dev, 0.1 in production) */
  sampleRate?: number;
  /** Service name for resource attribution */
  serviceName: string;
}

let initialized = false;

/**
 * Initialize OpenTelemetry SDK with auto-instrumentation.
 *
 * MUST be called before any other imports in the service entrypoint
 * (or use `node --require` / `--import` to preload).
 *
 * @example
 * ```ts
 * import { initTelemetry } from "@prometheus/telemetry";
 * await initTelemetry({ serviceName: "api" });
 * // ... now import and start your app
 * ```
 */
export async function initTelemetry(config: TelemetryConfig): Promise<void> {
  if (initialized) {
    return;
  }

  // Skip if explicitly disabled
  if (process.env.OTEL_SDK_DISABLED === "true") {
    return;
  }

  initialized = true;

  try {
    await _initTelemetryInternal(config);
  } catch (error) {
    // Telemetry failure should never crash the service
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[telemetry] Failed to initialize: ${msg}`);
  }
}

async function _initTelemetryInternal(config: TelemetryConfig): Promise<void> {
  const isDev = process.env.NODE_ENV === "development";
  const endpoint =
    config.endpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://localhost:4318";
  const sampleRate = config.sampleRate ?? (isDev ? 1.0 : 0.1);

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
    "@opentelemetry/semantic-conventions"
  );
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-http"
  );
  const { OTLPMetricExporter } = await import(
    "@opentelemetry/exporter-metrics-otlp-http"
  );
  const { PeriodicExportingMetricReader } = await import(
    "@opentelemetry/sdk-metrics"
  );

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "0.1.0",
    "deployment.environment": process.env.NODE_ENV ?? "development",
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${endpoint}/v1/metrics`,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 30_000,
  });

  const sdkOptions: Record<string, unknown> = {
    resource,
    traceExporter,
    metricReader,
    sampler: await createSampler(sampleRate),
  };

  // Auto-instrument HTTP, database (pg), Redis, etc.
  if (config.autoInstrument !== false) {
    const { getNodeAutoInstrumentations } = await import(
      "@opentelemetry/auto-instrumentations-node"
    );
    sdkOptions.instrumentations = [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ];
  }

  const sdk = new NodeSDK(
    sdkOptions as ConstructorParameters<typeof NodeSDK>[0]
  );
  sdk.start();

  // Graceful shutdown
  const shutdown = async () => {
    try {
      await sdk.shutdown();
    } catch {
      // best-effort
    }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

/**
 * Create a simple ratio-based sampler.
 */
async function createSampler(ratio: number) {
  const { TraceIdRatioBasedSampler } = (await import(
    "@opentelemetry/sdk-trace-base"
  )) as {
    TraceIdRatioBasedSampler: new (ratio: number) => unknown;
  };
  return new TraceIdRatioBasedSampler(ratio);
}

// ─── Convenience helpers ────────────────────────────────────────

const DEFAULT_TRACER_NAME = "@prometheus/telemetry";

/**
 * Get the default tracer instance.
 */
export function getTracer(name?: string) {
  return trace.getTracer(name ?? DEFAULT_TRACER_NAME);
}

/**
 * Start a new span and return it. Caller is responsible for ending it.
 *
 * @example
 * ```ts
 * const span = startSpan("process-task", { attributes: { taskId: "123" } });
 * try {
 *   // ... do work
 *   span.setStatus({ code: SpanStatusCode.OK });
 * } catch (err) {
 *   span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
 *   throw err;
 * } finally {
 *   span.end();
 * }
 * ```
 */
export function startSpan(name: string, options?: SpanOptions): Span {
  return getTracer().startSpan(name, options);
}

/**
 * Execute an async function within a new span. The span is automatically
 * ended and status is set based on success/failure.
 *
 * @example
 * ```ts
 * const result = await withSpan("db-query", async (span) => {
 *   span.setAttribute("query", "SELECT ...");
 *   return db.execute(query);
 * });
 * ```
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions
): Promise<T> {
  const tracer = getTracer();
  return await tracer.startActiveSpan(
    name,
    options ?? {},
    async (span: Span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        span.recordException(
          err instanceof Error ? err : new Error(String(err))
        );
        throw err;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Execute a synchronous function within a new span.
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  options?: SpanOptions
): T {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, options ?? {}, (span: Span) => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}
