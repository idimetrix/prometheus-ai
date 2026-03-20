import { createLogger } from "@prometheus/logger";

const logger = createLogger("telemetry:init");

export interface InitTelemetryConfig {
  /** Enable auto-instrumentation for HTTP, Express, pg, ioredis (default: true) */
  autoInstrument?: boolean;
  /** OTLP endpoint (defaults to OTEL_EXPORTER_OTLP_ENDPOINT or http://localhost:4318) */
  endpoint?: string;
  /** Trace sampling ratio 0-1 (default: 1.0 in dev, 0.1 in production) */
  sampleRate?: number;
  /** Service name for resource attribution */
  serviceName: string;
}

let initialized = false;

/**
 * Initialize OpenTelemetry SDK with W3C TraceContext propagation and
 * auto-instrumentation for HTTP, Express, pg, and ioredis.
 *
 * Uses 100% sampling in development, 10% in production (configurable).
 *
 * Must be called before any other imports in the service entrypoint.
 *
 * @example
 * ```ts
 * import { initTelemetry } from "@prometheus/telemetry/init";
 * await initTelemetry({ serviceName: "api" });
 * ```
 */
export async function initTelemetry(
  config: InitTelemetryConfig
): Promise<void> {
  if (initialized) {
    logger.debug("Telemetry already initialized, skipping");
    return;
  }

  if (process.env.OTEL_SDK_DISABLED === "true") {
    logger.info("OpenTelemetry SDK disabled via OTEL_SDK_DISABLED");
    return;
  }

  initialized = true;

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
  // W3C TraceContext propagation is the default in NodeSDK

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
    exportIntervalMillis: isDev ? 10_000 : 30_000,
  });

  // Use the existing createSampler from the main index.ts pattern (require)
  const { TraceIdRatioBasedSampler } =
    require("@opentelemetry/sdk-trace-base") as {
      TraceIdRatioBasedSampler: new (ratio: number) => unknown;
    };

  const sdkOptions: Record<string, unknown> = {
    resource,
    traceExporter,
    metricReader,
    sampler: new TraceIdRatioBasedSampler(sampleRate),
  };

  // Auto-instrument HTTP, Express, pg, ioredis
  if (config.autoInstrument !== false) {
    const { getNodeAutoInstrumentations } = await import(
      "@opentelemetry/auto-instrumentations-node"
    );
    sdkOptions.instrumentations = [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-express": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        "@opentelemetry/instrumentation-ioredis": { enabled: true },
      }),
    ];
  }

  const sdk = new NodeSDK(
    sdkOptions as ConstructorParameters<typeof NodeSDK>[0]
  );
  sdk.start();

  logger.info(
    {
      serviceName: config.serviceName,
      sampleRate,
      endpoint,
      autoInstrument: config.autoInstrument !== false,
    },
    "OpenTelemetry SDK initialized"
  );

  // Graceful shutdown
  const shutdown = async () => {
    try {
      await sdk.shutdown();
      logger.info("OpenTelemetry SDK shut down");
    } catch {
      // best-effort
    }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
