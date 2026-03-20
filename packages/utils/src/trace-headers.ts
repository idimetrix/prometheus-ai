/**
 * Lightweight W3C TraceContext header injection for inter-service calls.
 *
 * Uses the OpenTelemetry API dynamically to read the active span context
 * and produce a `traceparent` header. If OTEL is not initialized or no
 * span is active, returns an empty object so callers don't need to guard.
 */
export function getTraceHeaders(): Record<string, string> {
  try {
    // Dynamic require avoids hard dependency on @opentelemetry/api
    const otel = require("@opentelemetry/api") as {
      context: { active: () => unknown };
      trace: {
        getSpan: (ctx: unknown) =>
          | {
              spanContext: () => {
                traceId: string;
                spanId: string;
                traceFlags: number;
              };
            }
          | undefined;
      };
    };

    const span = otel.trace.getSpan(otel.context.active());
    if (!span) {
      return {};
    }

    const spanCtx = span.spanContext();
    if (!(spanCtx.traceId && spanCtx.spanId)) {
      return {};
    }

    const sampled = Number(spanCtx.traceFlags) > 0 ? "01" : "00";
    return {
      traceparent: `00-${spanCtx.traceId}-${spanCtx.spanId}-${sampled}`,
    };
  } catch {
    // OpenTelemetry not available — no-op
    return {};
  }
}
