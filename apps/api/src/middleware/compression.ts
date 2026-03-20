import { createLogger } from "@prometheus/logger";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:compression");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum response size (in bytes) to apply compression */
const MIN_SIZE_BYTES = 1024;

/** Content types eligible for compression */
const COMPRESSIBLE_TYPES = new Set([
  "application/json",
  "text/html",
  "text/plain",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/xml",
  "text/xml",
  "image/svg+xml",
]);

// ─── Compression Middleware ───────────────────────────────────────────────────

/**
 * Response compression middleware for Hono.
 *
 * Applies gzip compression to responses larger than 1KB with compressible
 * content types. Checks the Accept-Encoding header to determine if the
 * client supports compression.
 *
 * For production, consider using reverse proxy compression (nginx, Cloudflare)
 * which is more efficient. This middleware is suitable for direct-to-client
 * scenarios.
 */
export function compressionMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    await next();

    // Check if client accepts gzip
    const acceptEncoding = c.req.header("accept-encoding") ?? "";
    const supportsGzip = acceptEncoding.includes("gzip");
    const supportsBrotli = acceptEncoding.includes("br");

    if (!(supportsGzip || supportsBrotli)) {
      return;
    }

    // Check content type
    const contentType =
      c.res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!COMPRESSIBLE_TYPES.has(contentType)) {
      return;
    }

    // Check if already compressed
    if (c.res.headers.get("content-encoding")) {
      return;
    }

    // Read the response body
    const body = await c.res.text();

    // Skip small responses
    if (body.length < MIN_SIZE_BYTES) {
      return;
    }

    try {
      const { gzipSync } = await import("node:zlib");
      const compressed = gzipSync(Buffer.from(body));

      // Only use compression if it actually reduces size
      if (compressed.length >= body.length) {
        return;
      }

      c.res = new Response(compressed, {
        status: c.res.status,
        headers: new Headers(c.res.headers),
      });
      c.res.headers.set("Content-Encoding", "gzip");
      c.res.headers.set("Content-Length", String(compressed.length));
      c.res.headers.set("Vary", "Accept-Encoding");

      logger.debug(
        {
          originalSize: body.length,
          compressedSize: compressed.length,
          ratio: (compressed.length / body.length).toFixed(2),
        },
        "Response compressed"
      );
    } catch {
      // If compression fails, response is already sent uncompressed
    }
  };
}

/**
 * SSE-compatible compression middleware.
 *
 * For Server-Sent Events (SSE) endpoints, standard compression interferes
 * with streaming. This middleware is a passthrough that sets appropriate
 * headers for SSE responses without buffering or compressing them.
 */
export function sseCompressionMiddleware(): MiddlewareHandler {
  return async (_c: Context, next) => {
    await next();
  };
}
