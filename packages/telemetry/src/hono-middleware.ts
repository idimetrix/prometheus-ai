import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Context, MiddlewareHandler, Next } from "hono";
import { extractTraceContext } from "./propagation";

/**
 * Hono middleware that extracts incoming W3C TraceContext headers,
 * creates a server span for the request, and sets it as the active
 * context so downstream code (including outbound HTTP calls that use
 * `injectTraceHeaders`) can propagate the trace.
 *
 * Usage:
 * ```ts
 * import { traceMiddleware } from "@prometheus/telemetry";
 * app.use("/*", traceMiddleware("api"));
 * ```
 */
export function traceMiddleware(serviceName: string): MiddlewareHandler {
  const tracer = trace.getTracer(`@prometheus/${serviceName}`);

  return async (c: Context, next: Next) => {
    const method = c.req.method;
    const path = c.req.routePath ?? c.req.path;

    // Skip tracing for health/liveness/readiness probes
    if (path === "/health" || path === "/live" || path === "/ready") {
      await next();
      return;
    }

    // Extract incoming trace context from headers
    const rawHeaders: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      rawHeaders[key] = value;
    });
    const parentCtx = extractTraceContext(rawHeaders);

    // Build span options with optional parent context link
    const spanOptions: Parameters<typeof tracer.startSpan>[1] = {
      kind: SpanKind.SERVER,
      attributes: {
        "http.method": method,
        "http.route": path,
        "http.url": c.req.url,
        "service.name": serviceName,
      },
    };

    // If we have a parent trace, create a remote SpanContext and propagate it
    if (parentCtx) {
      const remoteSpanContext = {
        traceId: parentCtx.traceId,
        spanId: parentCtx.spanId,
        traceFlags: parentCtx.sampled ? 1 : 0,
        isRemote: true,
      };

      const parentContext = trace.setSpanContext(
        context.active(),
        remoteSpanContext
      );

      const span = tracer.startSpan(
        `${method} ${path}`,
        spanOptions,
        parentContext
      );

      await context.with(trace.setSpan(parentContext, span), async () => {
        try {
          await next();
          span.setAttribute("http.status_code", c.res.status);
          span.setStatus(
            c.res.status >= 400
              ? {
                  code: SpanStatusCode.ERROR,
                  message: `HTTP ${c.res.status}`,
                }
              : { code: SpanStatusCode.OK }
          );
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
      });
    } else {
      // No parent context — start a new root span
      const span = tracer.startSpan(`${method} ${path}`, spanOptions);

      await context.with(trace.setSpan(context.active(), span), async () => {
        try {
          await next();
          span.setAttribute("http.status_code", c.res.status);
          span.setStatus(
            c.res.status >= 400
              ? {
                  code: SpanStatusCode.ERROR,
                  message: `HTTP ${c.res.status}`,
                }
              : { code: SpanStatusCode.OK }
          );
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
      });
    }
  };
}
