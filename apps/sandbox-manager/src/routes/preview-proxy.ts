import { createLogger } from "@prometheus/logger";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContainerManager } from "../container";

const logger = createLogger("sandbox:preview-proxy");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DEV_SERVER_PORT = 3000;
const PROXY_TIMEOUT_MS = 15_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const FORWARD_HEADER_NAMES = [
  "accept",
  "accept-encoding",
  "accept-language",
  "content-type",
  "cookie",
  "user-agent",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildForwardHeaders(c: Context): Headers {
  const headers = new Headers();
  for (const name of FORWARD_HEADER_NAMES) {
    const value = c.req.header(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return headers;
}

function addCorsHeaders(headers: Headers): Headers {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.delete("x-frame-options");
  headers.delete("content-security-policy");
  return headers;
}

function handleProxyError(
  error: unknown,
  sandboxId: string,
  proxyPath: string,
  c: Context
): Response {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("abort") || msg.includes("AbortError")) {
    logger.warn({ sandboxId, proxyPath }, "Preview proxy request timed out");
    return c.json(
      { error: "Dev server request timed out", sandboxId },
      { status: 504 }
    );
  }

  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    return c.json(
      {
        error: "Dev server is not running",
        sandboxId,
        hint: "Start the dev server in the sandbox terminal",
      },
      { status: 503 }
    );
  }

  logger.error({ sandboxId, error: msg }, "Preview proxy error");
  return c.json({ error: msg, sandboxId }, { status: 502 });
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * Creates the preview proxy route.
 *
 * Proxies HTTP requests from `/preview/:sandboxId/*` to the
 * sandbox container's dev server. This enables the web app to
 * show a live preview of the running application inside an iframe.
 */
export function createPreviewProxyRoute(containerManager: ContainerManager) {
  const route = new Hono();

  route.all("/preview/:sandboxId/*", async (c) => {
    const sandboxId = c.req.param("sandboxId");

    const info = containerManager.getContainerInfo(sandboxId);
    if (!info) {
      return c.json({ error: "Sandbox not found", sandboxId }, { status: 503 });
    }

    const fullPath = c.req.path;
    const prefixEnd = fullPath.indexOf(sandboxId) + sandboxId.length;
    const proxyPath = fullPath.slice(prefixEnd) || "/";

    const targetBase = `http://localhost:${DEFAULT_DEV_SERVER_PORT}`;
    const targetUrl = new URL(proxyPath, targetBase);

    const sourceUrl = new URL(c.req.url);
    for (const [key, value] of sourceUrl.searchParams) {
      targetUrl.searchParams.set(key, value);
    }

    logger.debug(
      { sandboxId, proxyPath, target: targetUrl.toString() },
      "Proxying preview request"
    );

    try {
      const headers = buildForwardHeaders(c);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

      const body =
        c.req.method !== "GET" && c.req.method !== "HEAD"
          ? await c.req.blob()
          : undefined;

      const response = await fetch(targetUrl.toString(), {
        method: c.req.method,
        headers,
        body,
        signal: controller.signal,
        redirect: "manual",
      });

      clearTimeout(timeout);

      const responseHeaders = addCorsHeaders(new Headers(response.headers));

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return handleProxyError(error, sandboxId, proxyPath, c);
    }
  });

  route.options("/preview/:sandboxId/*", () => {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Max-Age": "86400",
      },
    });
  });

  return route;
}
