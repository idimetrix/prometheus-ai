import {
  chatConversations,
  chatMessages,
  db,
  modelUsageLogs,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createCacheKey, LRUCache } from "../lib/lru-cache";
import {
  callModelRouter,
  callModelRouterStream,
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

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

// ---------------------------------------------------------------------------
// SSE parsing helpers
// ---------------------------------------------------------------------------

interface ParsedSSEResult {
  content: string;
  model: string | undefined;
  tokensIn: number;
  tokensOut: number;
}

interface SSEChunkData {
  choices?: Array<{ delta?: { content?: string } }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function parseSingleSSELine(line: string): SSEChunkData | null {
  if (!line.startsWith("data: ") || line === "data: [DONE]") {
    return null;
  }
  try {
    return JSON.parse(line.slice(6)) as SSEChunkData;
  } catch {
    return null;
  }
}

function parseSSEContent(rawContent: string): ParsedSSEResult {
  const contentParts: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let model: string | undefined;

  for (const line of rawContent.split("\n")) {
    const parsed = parseSingleSSELine(line);
    if (!parsed) {
      continue;
    }

    const delta = parsed.choices?.[0]?.delta?.content;
    if (delta) {
      contentParts.push(delta);
    }
    if (parsed.usage) {
      tokensIn = parsed.usage.prompt_tokens ?? 0;
      tokensOut = parsed.usage.completion_tokens ?? 0;
    }
    if (parsed.model) {
      model = parsed.model;
    }
  }

  return {
    content: contentParts.join("") || "(empty response)",
    tokensIn,
    tokensOut,
    model,
  };
}

// ---------------------------------------------------------------------------
// Conversations sub-router
// ---------------------------------------------------------------------------

const conversationsRouter = router({
  /** List conversations for the current user/org with cursor pagination */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(chatConversations.orgId, ctx.orgId),
        eq(chatConversations.userId, ctx.auth.userId),
      ];

      if (input.projectId) {
        conditions.push(eq(chatConversations.projectId, input.projectId));
      }

      const rows = await db
        .select()
        .from(chatConversations)
        .where(and(...conditions))
        .orderBy(desc(chatConversations.createdAt))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items.at(-1)?.id : undefined;

      return { items, nextCursor };
    }),

  /** Get a single conversation with its messages */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [conversation] = await db
        .select()
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.id, input.id),
            eq(chatConversations.orgId, ctx.orgId),
            eq(chatConversations.userId, ctx.auth.userId)
          )
        )
        .limit(1);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const messages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversation.id))
        .orderBy(chatMessages.createdAt);

      return { ...conversation, messages };
    }),

  /** Create a new conversation */
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200).default("New Chat"),
        projectId: z.string().optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = generateId("conv");

      const [conversation] = await db
        .insert(chatConversations)
        .values({
          id,
          userId: ctx.auth.userId,
          orgId: ctx.orgId,
          title: input.title,
          projectId: input.projectId ?? null,
          model: input.model ?? null,
        })
        .returning();

      logger.info(
        { conversationId: id, userId: ctx.auth.userId },
        "Conversation created"
      );

      return conversation;
    }),

  /** Delete a conversation and its messages (cascade) */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [deleted] = await db
        .delete(chatConversations)
        .where(
          and(
            eq(chatConversations.id, input.id),
            eq(chatConversations.orgId, ctx.orgId),
            eq(chatConversations.userId, ctx.auth.userId)
          )
        )
        .returning({ id: chatConversations.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      logger.info(
        { conversationId: input.id, userId: ctx.auth.userId },
        "Conversation deleted"
      );

      return { success: true };
    }),
});

// ---------------------------------------------------------------------------
// Main chat router
// ---------------------------------------------------------------------------

export const chatRouter = router({
  conversations: conversationsRouter,

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
   * Streaming chat completion via model-router.
   * Persists conversation messages and streams the response back as SSE chunks.
   */
  stream: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        messages: z.array(messageSchema).min(1).max(50),
        model: z.string().optional(),
        slot: z.string().default("default"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify conversation ownership
      const [conversation] = await db
        .select()
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.id, input.conversationId),
            eq(chatConversations.orgId, ctx.orgId),
            eq(chatConversations.userId, ctx.auth.userId)
          )
        )
        .limit(1);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Persist the user message (last in the array)
      const lastUserMessage = [...input.messages]
        .reverse()
        .find((m) => m.role === "user");
      if (lastUserMessage) {
        await db.insert(chatMessages).values({
          id: generateId("cmsg"),
          conversationId: input.conversationId,
          role: "user",
          content: lastUserMessage.content,
        });
      }

      try {
        const { stream, latencyMs } = await callModelRouterStream({
          slot: input.slot,
          messages: input.messages,
          options: {
            model: input.model,
            orgId: ctx.orgId,
            userId: ctx.auth.userId,
          },
        });

        // Collect streamed chunks so we can persist the full assistant response
        const decoder = new TextDecoder();
        const chunks: string[] = [];

        const transformedStream = stream.pipeThrough(
          new TransformStream<Uint8Array, string>({
            transform(chunk, controller) {
              const text = decoder.decode(chunk, { stream: true });
              chunks.push(text);
              controller.enqueue(text);
            },
            async flush() {
              const result = parseSSEContent(chunks.join(""));

              await db
                .insert(chatMessages)
                .values({
                  id: generateId("cmsg"),
                  conversationId: input.conversationId,
                  role: "assistant",
                  content: result.content,
                  tokensIn: result.tokensIn || null,
                  tokensOut: result.tokensOut || null,
                  model: result.model ?? input.model ?? null,
                })
                .catch((err) => {
                  logger.error(
                    { err, conversationId: input.conversationId },
                    "Failed to persist assistant message"
                  );
                });
            },
          })
        );

        logger.info(
          {
            conversationId: input.conversationId,
            userId: ctx.auth.userId,
            latencyMs,
          },
          "Chat stream started"
        );

        return {
          stream: transformedStream,
          latencyMs,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { error: msg, conversationId: input.conversationId },
          "Chat stream failed"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start chat stream",
        });
      }
    }),

  /**
   * Execute a code block in a sandboxed environment.
   * Sends the code to the sandbox-manager service and returns stdout/stderr.
   */
  executeCode: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        language: z.enum(["typescript", "javascript", "python", "bash"]),
        code: z.string().min(1).max(50_000),
        timeoutMs: z.number().int().min(1000).max(30_000).default(10_000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify conversation ownership
      const [conversation] = await db
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.id, input.conversationId),
            eq(chatConversations.orgId, ctx.orgId),
            eq(chatConversations.userId, ctx.auth.userId)
          )
        )
        .limit(1);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const startMs = performance.now();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          input.timeoutMs + 5000
        );

        const res = await fetch(`${SANDBOX_MANAGER_URL}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: input.language,
            code: input.code,
            timeoutMs: input.timeoutMs,
            orgId: ctx.orgId,
            userId: ctx.auth.userId,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `Sandbox returned ${res.status}: ${body.slice(0, 200)}`
          );
        }

        const result = (await res.json()) as {
          stdout: string;
          stderr: string;
          exitCode: number;
          durationMs: number;
        };

        const totalMs = Math.round(performance.now() - startMs);

        logger.info(
          {
            conversationId: input.conversationId,
            userId: ctx.auth.userId,
            language: input.language,
            exitCode: result.exitCode,
            totalMs,
          },
          "Code execution completed"
        );

        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          totalMs,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { error: msg, conversationId: input.conversationId },
          "Code execution failed"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to execute code in sandbox",
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
