/**
 * SSE (Server-Sent Events) stream consumer for the Prometheus SDK.
 *
 * Uses the fetch API to consume SSE streams, making it compatible
 * with both Node.js and browser environments.
 */

import { PrometheusError, throwForStatus } from "./errors";

/** A parsed SSE event from the stream. */
export interface SSEEvent {
  /** Parsed JSON data payload. */
  data: unknown;
  /** Event type (e.g. "message", "session_ended", "task_complete"). */
  event: string;
  /** Event ID, if provided by the server. */
  id?: string;
}

interface SSEStreamOptions {
  headers: Record<string, string>;
  signal?: AbortSignal;
  url: string;
}

interface SSEParserState {
  data: string;
  event: string;
  id: string | undefined;
}

function createEmptyState(): SSEParserState {
  return { id: undefined, event: "message", data: "" };
}

function parseSSEFieldFromLine(line: string): { field: string; value: string } {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) {
    return { field: line, value: "" };
  }
  const field = line.slice(0, colonIdx);
  const raw = line.slice(colonIdx + 1);
  const value = raw.startsWith(" ") ? raw.slice(1) : raw;
  return { field, value };
}

function applyFieldToState(
  state: SSEParserState,
  field: string,
  value: string
): void {
  switch (field) {
    case "id":
      state.id = value;
      break;
    case "event":
      state.event = value;
      break;
    case "data":
      state.data = state.data ? `${state.data}\n${value}` : value;
      break;
    default:
      break;
  }
}

function flushState(state: SSEParserState): SSEEvent | undefined {
  if (!state.data) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(state.data);
  } catch {
    parsed = state.data;
  }
  return { id: state.id, event: state.event, data: parsed };
}

function processChunk(
  buffer: string,
  chunk: string,
  state: SSEParserState,
  events: SSEEvent[]
): string {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    if (line === "") {
      const event = flushState(state);
      if (event) {
        events.push(event);
      }
      state.id = undefined;
      state.event = "message";
      state.data = "";
      continue;
    }

    if (line.startsWith(":")) {
      continue;
    }

    const { field, value } = parseSSEFieldFromLine(line);
    applyFieldToState(state, field, value);
  }

  return remainder;
}

/**
 * Consumes an SSE endpoint and yields typed events as an async iterable.
 *
 * Uses the fetch API with streaming response body parsing,
 * compatible with Node.js 18+ and modern browsers.
 */
export async function* streamSSEEvents(
  options: SSEStreamOptions
): AsyncGenerator<SSEEvent, void, undefined> {
  const response = await fetch(options.url, {
    method: "GET",
    headers: {
      ...options.headers,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    signal: options.signal,
  });

  if (!response.ok) {
    await throwForStatus(response);
  }

  const body = response.body;
  if (!body) {
    throw new PrometheusError(
      "Response body is null; streaming is not supported in this environment.",
      0,
      "stream_unsupported"
    );
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = createEmptyState();
  let buffer = "";

  try {
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (done) {
        break;
      }

      const chunk = decoder.decode(result.value, { stream: true });
      const events: SSEEvent[] = [];
      buffer = processChunk(buffer, chunk, state, events);

      for (const event of events) {
        yield event;
      }
    }

    // Flush any remaining data
    const finalEvent = flushState(state);
    if (finalEvent) {
      yield finalEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
