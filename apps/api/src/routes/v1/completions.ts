import type { AuthContext } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import { db as defaultDb, modelUsageLogs } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { Hono } from "hono";
import {
  callModelRouter,
  type ModelRouterResponse,
} from "../../lib/model-router-client";

const logger = createLogger("api:v1:completions");

interface V1Env {
  Variables: {
    apiKeyAuth: AuthContext;
    apiKeyId: string;
    db: Database;
    orgId: string;
    userId: string;
  };
}

const completionsV1 = new Hono<V1Env>();

/**
 * Log model usage asynchronously. Fire-and-forget to avoid adding latency.
 */
async function logUsage(
  orgId: string,
  response: ModelRouterResponse
): Promise<void> {
  await defaultDb.insert(modelUsageLogs).values({
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

/**
 * POST /api/v1/completions - IDE-style code completion endpoint.
 *
 * Optimized for low latency (<500ms target). Uses the fastest available
 * model via the model-router "fast-completion" slot.
 *
 * Input:  { prefix, suffix, language, filePath?, maxTokens? }
 * Output: { completion: string, tokens: number, responseTimeMs: number }
 */
completionsV1.post("/", async (c) => {
  const requestStart = performance.now();
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");

  const body = await c.req.json<{
    filePath?: string;
    language: string;
    maxTokens?: number;
    prefix: string;
    suffix: string;
  }>();

  if (!(body.prefix || body.suffix)) {
    return c.json(
      {
        completion: "",
        tokens: 0,
        responseTimeMs: 0,
      },
      200
    );
  }

  if (!body.language) {
    return c.json(
      { error: "Bad Request", message: "'language' is required" },
      400
    );
  }

  const maxTokens = Math.min(body.maxTokens ?? 256, 1024);
  const filePath = body.filePath ?? "untitled";

  const systemPrompt = `You are an intelligent code completion engine. Complete the code at the cursor position. Return ONLY the completion text, no explanation, no markdown, no code fences. The completion should be natural, idiomatic ${body.language} code.`;

  // Truncate prefix/suffix to keep prompt small for speed
  const prefixContext = body.prefix.slice(-2000);
  const suffixContext = body.suffix.slice(0, 500);

  const userPrompt = `File: ${filePath}\nLanguage: ${body.language}\n\nCode before cursor:\n\`\`\`\n${prefixContext}\n\`\`\`\n\nCode after cursor:\n\`\`\`\n${suffixContext}\n\`\`\`\n\nComplete the code at the cursor position:`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const { response, latencyMs } = await callModelRouter(
      {
        slot: "fast-completion",
        messages,
        options: {
          maxTokens,
          orgId,
          userId: auth.userId,
        },
      },
      10_000 // 10s timeout for completions
    );

    const completion = response.choices[0]?.message?.content ?? "";
    const totalTokens = response.usage.total_tokens;
    const totalMs = Math.round(performance.now() - requestStart);

    // Log usage fire-and-forget
    logUsage(orgId, response).catch((err) => {
      logger.error({ err }, "Failed to log completion usage");
    });

    logger.debug(
      {
        language: body.language,
        filePath,
        totalMs,
        latencyMs,
        tokens: totalTokens,
        model: response.model,
      },
      "Completion served"
    );

    return c.json(
      {
        completion: completion.trim(),
        tokens: totalTokens,
        model: response.model,
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
      { error: msg, userId: auth.userId, language: body.language },
      "Completion failed"
    );
    return c.json(
      { completion: "", tokens: 0, error: "Completion request failed" },
      500
    );
  }
});

export { completionsV1 };
