import type { Context, MiddlewareHandler, Next } from "hono";
import { globalRegistry, metrics } from "./metrics";

export function metricsMiddleware(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const start = performance.now();

    await next();

    const duration = (performance.now() - start) / 1000;
    const method = c.req.method;
    const route = c.req.routePath ?? c.req.path;
    const statusCode = String(c.res.status);

    metrics.httpRequests.inc({ method, route, status_code: statusCode });
    metrics.httpDuration.observe({ method, route }, duration);
  };
}

export async function metricsHandler(c: Context): Promise<Response> {
  const body = await globalRegistry.metrics();
  return c.text(body, 200, {
    "Content-Type": globalRegistry.contentType,
  });
}
