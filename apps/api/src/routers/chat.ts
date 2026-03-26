import { db, modelUsageLogs } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createCacheKey, LRUCache } from "../lib/lru-cache";
import {
  callModelRouter,
  type ModelRouterResponse,
} from "../lib/model-router-client";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("chat-router");

/** Response cache: 100 entries, 5-minute TTL */
const responseCache = new LRUCache<ModelRouterResponse>({
  maxSize: 100,
  ttlMs: 5 * 60 * 1000,
});

// Periodically prune expired entries every 60s
setInterval(() => responseCache.prune(), 60_000);

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(100_000),
});

export const chatRouter = router({
  /**
   * Direct chat completion -- bypasses queue/orchestrator for simple Q&A.
   * Calls model-router directly and returns the response.
   * Caches non-streaming responses for 5 minutes.
   */
  complete: protectedProcedure
    .input(
      z.object({
        messages: z.array(messageSchema).min(1).max(50),
        model: z.string().optional(),
        projectId: z.string().optional(),
        slot: z.string().default("default"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const startMs = performance.now();

      // Check cache
      const cacheKey = createCacheKey(input.messages, input.model);
      const cached = responseCache.get(cacheKey);
      if (cached) {
        logger.info({ cacheKey, userId: ctx.auth.userId }, "Chat cache hit");
        return {
          ...cached,
          cached: true,
          responseTimeMs: Math.round(performance.now() - startMs),
        };
      }

      try {
        const { response, latencyMs } = await callModelRouter({
          slot: input.slot,
          messages: input.messages,
          options: {
            model: input.model,
            orgId: ctx.orgId,
            userId: ctx.auth.userId,
          },
        });

        // Cache the response
        responseCache.set(cacheKey, response);

        // Log usage asynchronously (fire-and-forget)
        logUsage(ctx.orgId, response).catch((err) => {
          logger.error({ err }, "Failed to log chat usage");
        });

        const totalMs = Math.round(performance.now() - startMs);
        logger.info(
          {
            userId: ctx.auth.userId,
            model: response.model,
            latencyMs,
            totalMs,
            tokens: response.usage.total_tokens,
          },
          "Direct chat completed"
        );

        return {
          ...response,
          cached: false,
          responseTimeMs: totalMs,
          modelLatencyMs: latencyMs,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg, userId: ctx.auth.userId }, "Chat failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to complete chat request",
        });
      }
    }),

  /**
   * Quick action: single tool call without full agent loop.
   * Use cases: explain code, fix lint, add types, etc.
   * Flow: API -> Model Router -> single LLM call -> parse -> return
   * Max 1 tool call round-trip.
   */
  quickAction: protectedProcedure
    .input(
      z.object({
        action: z.enum([
          "explain",
          "fix-lint",
          "add-types",
          "refactor",
          "add-tests",
          "document",
          "review",
        ]),
        code: z.string().min(1).max(50_000),
        language: z.string().default("typescript"),
        context: z.string().max(10_000).optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const startMs = performance.now();

      const systemPrompt = buildQuickActionPrompt(input.action, input.language);
      const userContent = input.context
        ? `${input.context}\n\n\`\`\`${input.language}\n${input.code}\n\`\`\``
        : `\`\`\`${input.language}\n${input.code}\n\`\`\``;

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];

      try {
        const { response, latencyMs } = await callModelRouter({
          slot: "fastLoop",
          messages,
          options: {
            model: input.model,
            orgId: ctx.orgId,
            userId: ctx.auth.userId,
            maxTokens: 4096,
          },
        });

        // Log usage asynchronously
        logUsage(ctx.orgId, response).catch((err) => {
          logger.error({ err }, "Failed to log quick action usage");
        });

        const totalMs = Math.round(performance.now() - startMs);
        const content = response.choices[0]?.message?.content ?? "";

        logger.info(
          {
            action: input.action,
            userId: ctx.auth.userId,
            model: response.model,
            latencyMs,
            totalMs,
          },
          "Quick action completed"
        );

        return {
          action: input.action,
          result: content,
          model: response.model,
          provider: response.provider,
          usage: response.usage,
          responseTimeMs: totalMs,
          modelLatencyMs: latencyMs,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { error: msg, action: input.action },
          "Quick action failed"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to complete quick action",
        });
      }
    }),
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
