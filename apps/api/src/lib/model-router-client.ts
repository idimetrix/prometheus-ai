import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const _logger = createLogger("api:model-router-client");

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

/** Default request timeout for model-router calls (30s) */
const DEFAULT_TIMEOUT_MS = Number(
  process.env.MODEL_ROUTER_TIMEOUT_MS ?? 30_000
);

/**
 * HTTP client for calling the model-router service directly from the API.
 * Used by fast-path endpoints that bypass the queue/orchestrator pipeline.
 *
 * Features:
 * - Connection keep-alive via default fetch behavior
 * - Configurable timeout
 * - Internal auth headers
 */

export interface ChatMessage {
  content: string;
  role: string;
}

export interface ModelRouterRequest {
  messages: ChatMessage[];
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    tools?: unknown[];
    orgId?: string;
    userId?: string;
  };
  slot: string;
}

export interface ModelRouterResponse {
  choices: Array<{
    message: { role: string; content: string; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  id: string;
  model: string;
  provider: string;
  routing: {
    primaryModel: string;
    modelUsed: string;
    wasFallback: boolean;
    attemptsCount: number;
  };
  slot: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
}

/**
 * Call the model-router /route endpoint for a non-streaming completion.
 */
export async function callModelRouter(
  request: ModelRouterRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ response: ModelRouterResponse; latencyMs: number }> {
  const startMs = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${MODEL_ROUTER_URL}/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({
        slot: request.slot,
        messages: request.messages,
        options: request.options,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Model router returned ${res.status}: ${body.slice(0, 200)}`
      );
    }

    const response = (await res.json()) as ModelRouterResponse;
    const latencyMs = Math.round(performance.now() - startMs);

    return { response, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call the model-router /route endpoint for a streaming completion.
 * Returns a ReadableStream of SSE chunks from the model-router.
 */
export async function callModelRouterStream(
  request: ModelRouterRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ stream: ReadableStream<Uint8Array>; latencyMs: number }> {
  const startMs = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${MODEL_ROUTER_URL}/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({
        slot: request.slot,
        messages: request.messages,
        options: { ...request.options, stream: true },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Model router returned ${res.status}: ${body.slice(0, 200)}`
      );
    }

    if (!res.body) {
      throw new Error("Model router returned no body for stream request");
    }

    const latencyMs = Math.round(performance.now() - startMs);

    // Do NOT clear timeout here -- let it abort the stream if it takes too long
    // We clear it when the caller finishes reading
    return { stream: res.body, latencyMs };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
