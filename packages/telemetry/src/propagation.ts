import { context, trace } from "@opentelemetry/api";

const TRACEPARENT_HEADER = "traceparent";
const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Inject W3C Trace Context `traceparent` header from the current active span
 * into the provided headers object.
 *
 * If there is no active span, headers are returned unmodified.
 */
export function injectTraceHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const span = trace.getSpan(context.active());
  if (!span) {
    return headers;
  }

  const spanContext = span.spanContext();
  if (!(spanContext.traceId && spanContext.spanId)) {
    return headers;
  }

  const sampled = Number(spanContext.traceFlags) > 0 ? "01" : "00";
  const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${sampled}`;

  return {
    ...headers,
    [TRACEPARENT_HEADER]: traceparent,
  };
}

/**
 * Extract W3C Trace Context from incoming HTTP headers.
 *
 * Returns the parsed traceId, spanId, and sampled flag, or null if
 * the `traceparent` header is missing or malformed.
 */
export function extractTraceContext(
  headers: Record<string, string>
): { traceId: string; spanId: string; sampled: boolean } | null {
  // Normalize header keys to lowercase for case-insensitive lookup
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    normalized[key.toLowerCase()] = headers[key] ?? "";
  }

  const traceparent = normalized[TRACEPARENT_HEADER];
  if (!traceparent) {
    return null;
  }

  const match = TRACEPARENT_REGEX.exec(traceparent);
  if (!match) {
    return null;
  }

  return {
    traceId: match[1] ?? "",
    spanId: match[2] ?? "",
    sampled: match[3] === "01",
  };
}

/**
 * Create a wrapped version of `fetch` that automatically injects
 * W3C Trace Context headers into outgoing requests.
 *
 * @param baseFetch - The underlying fetch implementation (defaults to global `fetch`)
 */
export function createTracedFetch(baseFetch?: typeof fetch): typeof fetch {
  const fetchFn = baseFetch ?? globalThis.fetch;

  return ((
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const existingHeaders: Record<string, string> = {};

    // Extract existing headers
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          existingHeaders[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          existingHeaders[key] = value;
        }
      } else {
        Object.assign(existingHeaders, init.headers);
      }
    }

    // Inject trace headers
    const tracedHeaders = injectTraceHeaders(existingHeaders);

    return Promise.resolve(
      fetchFn(input, {
        ...init,
        headers: tracedHeaders,
      })
    );
  }) as typeof fetch;
}
