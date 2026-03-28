/**
 * Server-Sent Events (SSE) streaming utility — GAP-008
 *
 * Provides helpers for creating SSE streams from tRPC procedures
 * or Hono routes. Used for real-time streaming of:
 * - LLM token generation
 * - Agent session events
 * - Task progress updates
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:sse-stream");

export interface SSEMessage {
  /** The data payload (will be JSON.stringified if object) */
  data: unknown;
  /** Optional event name */
  event?: string;
  /** Optional message ID for client reconnection */
  id?: string;
}

/**
 * Create an SSE response from an async iterable of messages.
 *
 * Usage in Hono:
 * ```ts
 * app.get('/stream', (c) => {
 *   const stream = createSSEStream(async function* () {
 *     yield { data: { token: 'Hello' } };
 *     yield { data: { token: ' world' } };
 *     yield { event: 'done', data: {} };
 *   });
 *   return stream;
 * });
 * ```
 */
export function createSSEResponse(
  generator: () => AsyncIterable<SSEMessage>
): Response {
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const message of generator()) {
          const formatted = formatSSEMessage(message);
          controller.enqueue(encoder.encode(formatted));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, "SSE stream error");
        const errorEvent = formatSSEMessage({
          event: "error",
          data: { error: msg },
        });
        controller.enqueue(encoder.encode(errorEvent));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Format a single SSE message according to the SSE spec.
 */
function formatSSEMessage(message: SSEMessage): string {
  const lines: string[] = [];

  if (message.id) {
    lines.push(`id: ${message.id}`);
  }

  if (message.event) {
    lines.push(`event: ${message.event}`);
  }

  const data =
    typeof message.data === "string"
      ? message.data
      : JSON.stringify(message.data);

  // SSE spec: each line of data gets its own "data:" prefix
  for (const line of data.split("\n")) {
    lines.push(`data: ${line}`);
  }

  // SSE messages are terminated by double newline
  return `${lines.join("\n")}\n\n`;
}

/**
 * Create a keep-alive SSE comment to prevent connection timeout.
 * Send every 15-30 seconds to keep proxies/load balancers happy.
 */
export function createKeepAliveComment(): string {
  return `: keepalive ${Date.now()}\n\n`;
}

/**
 * Helper to create an SSE stream that forwards events from a Redis pub/sub channel.
 * Used for streaming session events to the frontend.
 */
export function createRedisSSEStream(
  channelName: string,
  redisSubscribe: (
    channel: string,
    callback: (message: string) => void
  ) => () => void
): Response {
  return createSSEResponse(async function* () {
    const messages: string[] = [];
    let resolve: (() => void) | null = null;

    const unsubscribe = redisSubscribe(channelName, (message: string) => {
      messages.push(message);
      resolve?.();
    });

    try {
      // Send initial connection event
      yield { event: "connected", data: { channel: channelName } };

      while (true) {
        if (messages.length === 0) {
          // Wait for next message or timeout (keepalive)
          await Promise.race([
            new Promise<void>((r) => {
              resolve = r;
            }),
            new Promise<void>((r) => setTimeout(r, 15_000)),
          ]);
        }

        // Flush all queued messages
        while (messages.length > 0) {
          const msg = messages.shift();
          if (msg) {
            try {
              yield { data: JSON.parse(msg) };
            } catch {
              yield { data: msg };
            }
          }
        }
      }
    } finally {
      unsubscribe();
    }
  });
}
