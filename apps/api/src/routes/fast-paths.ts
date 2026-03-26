import { getAuthContext } from "@prometheus/auth";
import { db, modelUsageLogs } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { Hono } from "hono";
import { createCacheKey, LRUCache } from "../lib/lru-cache";
import {
  callModelRouter,
  callModelRouterStream,
  type ModelRouterResponse,
} from "../lib/model-router-client";

const logger = createLogger("api:fast-paths");
const fastPathsApp = new Hono();

/** Shared response cache for non-streaming responses */
const responseCache = new LRUCache<ModelRouterResponse>({
  maxSize: 100,
  ttlMs: 5 * 60 * 1000,
});

setInterval(() => responseCache.prune(), 60_000);

/**
 * Authenticate request using Bearer token.
 * Returns auth context or null.
 */
function authenticate(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  return getAuthContext(token);
}

// ---------------------------------------------------------------------------
// POST /chat/stream - Direct LLM chat with SSE streaming
// Bypasses queue/orchestrator for interactive Q&A
// ---------------------------------------------------------------------------
fastPathsApp.post("/chat/stream", async (c) => {
  const requestStart = performance.now();

  const auth = await authenticate(c.req.header("authorization"));
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const orgId = auth.orgId ?? auth.userId;
  if (!orgId) {
    return c.json({ error: "Organization context required" }, 403);
  }

  let body: {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    projectId?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (
    !(body.messages && Array.isArray(body.messages)) ||
    body.messages.length === 0
  ) {
    return c.json(
      { error: "'messages' array is required and must not be empty" },
      400
    );
  }

  // Validate messages
  for (const msg of body.messages) {
    if (!(msg.role && msg.content)) {
      return c.json(
        { error: "Each message must have 'role' and 'content'" },
        400
      );
    }
  }

  logger.info(
    {
      userId: auth.userId,
      orgId,
      messageCount: body.messages.length,
      model: body.model,
    },
    "Chat stream request"
  );

  try {
    const { stream, latencyMs } = await callModelRouterStream({
      slot: "default",
      messages: body.messages,
      options: {
        model: body.model,
        orgId,
        userId: auth.userId,
      },
    });

    const totalMs = Math.round(performance.now() - requestStart);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Response-Time": `${totalMs}ms`,
        "X-Model-Latency": `${latencyMs}ms`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg, userId: auth.userId }, "Chat stream failed");
    return c.json({ error: "Failed to stream chat response" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /chat/complete - Direct LLM chat without streaming (cacheable)
// ---------------------------------------------------------------------------
fastPathsApp.post("/chat/complete", async (c) => {
  const requestStart = performance.now();

  const auth = await authenticate(c.req.header("authorization"));
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const orgId = auth.orgId ?? auth.userId;
  if (!orgId) {
    return c.json({ error: "Organization context required" }, 403);
  }

  let body: {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    projectId?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (
    !(body.messages && Array.isArray(body.messages)) ||
    body.messages.length === 0
  ) {
    return c.json(
      { error: "'messages' array is required and must not be empty" },
      400
    );
  }

  // Check cache
  const cacheKey = createCacheKey(body.messages, body.model);
  const cached = responseCache.get(cacheKey);
  if (cached) {
    const totalMs = Math.round(performance.now() - requestStart);
    logger.info({ cacheKey, userId: auth.userId }, "Chat cache hit (REST)");
    return c.json({ ...cached, cached: true, responseTimeMs: totalMs }, 200, {
      "X-Response-Time": `${totalMs}ms`,
      "X-Cache": "HIT",
    });
  }

  try {
    const { response, latencyMs } = await callModelRouter({
      slot: "default",
      messages: body.messages,
      options: {
        model: body.model,
        orgId,
        userId: auth.userId,
      },
    });

    responseCache.set(cacheKey, response);

    // Log usage async
    logUsage(orgId, response).catch((err) => {
      logger.error({ err }, "Failed to log chat usage");
    });

    const totalMs = Math.round(performance.now() - requestStart);

    return c.json(
      {
        ...response,
        cached: false,
        responseTimeMs: totalMs,
        modelLatencyMs: latencyMs,
      },
      200,
      {
        "X-Response-Time": `${totalMs}ms`,
        "X-Model-Latency": `${latencyMs}ms`,
        "X-Cache": "MISS",
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg, userId: auth.userId }, "Chat complete failed");
    return c.json({ error: "Failed to complete chat request" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /quick-action - Single tool call without full agent loop
// ---------------------------------------------------------------------------
fastPathsApp.post("/quick-action", async (c) => {
  const requestStart = performance.now();

  const auth = await authenticate(c.req.header("authorization"));
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const orgId = auth.orgId ?? auth.userId;
  if (!orgId) {
    return c.json({ error: "Organization context required" }, 403);
  }

  let body: {
    action?: string;
    code?: string;
    language?: string;
    context?: string;
    model?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validActions = [
    "explain",
    "fix-lint",
    "add-types",
    "refactor",
    "add-tests",
    "document",
    "review",
  ];

  if (!(body.action && validActions.includes(body.action))) {
    return c.json(
      {
        error: `'action' must be one of: ${validActions.join(", ")}`,
      },
      400
    );
  }

  if (!body.code || body.code.length === 0) {
    return c.json({ error: "'code' is required" }, 400);
  }

  const language = body.language ?? "typescript";
  const systemPrompt = buildQuickActionPrompt(body.action, language);
  const userContent = body.context
    ? `${body.context}\n\n\`\`\`${language}\n${body.code}\n\`\`\``
    : `\`\`\`${language}\n${body.code}\n\`\`\``;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  try {
    const { response, latencyMs } = await callModelRouter({
      slot: "fastLoop",
      messages,
      options: {
        model: body.model,
        orgId,
        userId: auth.userId,
        maxTokens: 4096,
      },
    });

    logUsage(orgId, response).catch((err) => {
      logger.error({ err }, "Failed to log quick action usage");
    });

    const totalMs = Math.round(performance.now() - requestStart);
    const content = response.choices[0]?.message?.content ?? "";

    logger.info(
      {
        action: body.action,
        userId: auth.userId,
        model: response.model,
        latencyMs,
        totalMs,
      },
      "Quick action completed (REST)"
    );

    return c.json(
      {
        action: body.action,
        result: content,
        model: response.model,
        provider: response.provider,
        usage: response.usage,
        responseTimeMs: totalMs,
        modelLatencyMs: latencyMs,
      },
      200,
      {
        "X-Response-Time": `${totalMs}ms`,
        "X-Model-Latency": `${latencyMs}ms`,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { error: msg, action: body.action, userId: auth.userId },
      "Quick action failed"
    );
    return c.json({ error: "Failed to complete quick action" }, 500);
  }
});

function buildQuickActionPrompt(action: string, language: string): string {
  const prompts: Record<string, string> = {
    explain: `You are a senior developer. Explain the following ${language} code clearly and concisely. Focus on what it does, not how to improve it. Be brief.`,
    "fix-lint": `You are a code quality expert. Fix all lint errors and style issues in the following ${language} code. Return only the corrected code without explanations.`,
    "add-types":
      "You are a TypeScript expert. Add proper type annotations to the following code. Return only the typed code.",
    refactor: `You are a senior developer. Refactor the following ${language} code to improve readability and maintainability. Return the refactored code with brief inline comments explaining changes.`,
    "add-tests": `You are a testing expert. Write comprehensive unit tests for the following ${language} code. Use modern testing patterns.`,
    document: `You are a documentation expert. Add JSDoc/TSDoc comments to the following ${language} code. Return only the documented code.`,
    review: `You are a code reviewer. Review the following ${language} code and provide actionable feedback on bugs, performance, security, and maintainability. Be concise and specific.`,
  };

  return (prompts[action] ?? prompts.explain) as string;
}

async function logUsage(
  orgId: string,
  response: ModelRouterResponse
): Promise<void> {
  await db.insert(modelUsageLogs).values({
    id: generateId("mlog"),
    orgId,
    sessionId: null,
    modelKey: response.model,
    provider: response.provider,
    slot: response.slot,
    promptTokens: response.usage.prompt_tokens,
    completionTokens: response.usage.completion_tokens,
    totalTokens: response.usage.total_tokens,
    costUsd: response.usage.cost_usd,
  });
}

export { fastPathsApp };
