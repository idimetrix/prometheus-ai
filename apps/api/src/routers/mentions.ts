import { createLogger } from "@prometheus/logger";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
  listMentionTypes,
  type MentionTypeKey,
  resolveMentionByType,
} from "../utils/mention-types";

const logger = createLogger("mentions-router");

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

export const mentionsRouter = router({
  // ---------------------------------------------------------------------------
  // Resolve a mention to its content
  // ---------------------------------------------------------------------------
  resolve: protectedProcedure
    .input(
      z.object({
        mentionType: z.enum(["file", "codebase", "issue", "pr", "docs", "web"]),
        query: z.string().min(1).max(2000),
        projectId: z.string().optional(),
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const resolverCtx = {
        sandboxUrl: SANDBOX_MANAGER_URL,
        sessionId: input.sessionId ?? "default",
      };

      logger.info(
        {
          userId: ctx.auth.userId,
          mentionType: input.mentionType,
          query: input.query.slice(0, 100),
        },
        "Resolving mention"
      );

      const resolved = await resolveMentionByType(
        input.mentionType as MentionTypeKey,
        input.query,
        resolverCtx
      );

      return {
        content: resolved.content,
        isError: resolved.isError,
        mentionType: input.mentionType,
        query: input.query,
      };
    }),

  // ---------------------------------------------------------------------------
  // Autocomplete suggestions for mentions
  // ---------------------------------------------------------------------------
  suggest: protectedProcedure
    .input(
      z.object({
        partial: z.string().max(500),
        projectId: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(({ input, ctx }) => {
      const results: Array<{
        label: string;
        sublabel?: string;
        type: string;
        value: string;
      }> = [];

      const lowerPartial = input.partial.toLowerCase();

      // Check if the partial starts with a mention type prefix
      const mentionTypes = listMentionTypes();

      // If partial is empty or just "@", return all mention types as suggestions
      if (!lowerPartial || lowerPartial === "@") {
        return {
          suggestions: mentionTypes.map((mt) => ({
            label: mt.prefix,
            sublabel: mt.description,
            type: mt.key,
            value: mt.prefix,
          })),
        };
      }

      // Filter mention types by partial match
      for (const mt of mentionTypes) {
        if (
          mt.prefix.toLowerCase().includes(lowerPartial) ||
          mt.key.toLowerCase().includes(lowerPartial) ||
          mt.description.toLowerCase().includes(lowerPartial)
        ) {
          results.push({
            label: mt.prefix,
            sublabel: mt.description,
            type: mt.key,
            value: mt.prefix,
          });
        }
      }

      logger.info(
        {
          userId: ctx.auth.userId,
          partial: input.partial.slice(0, 50),
          resultCount: results.length,
        },
        "Mention suggestions"
      );

      return { suggestions: results.slice(0, input.limit) };
    }),

  // ---------------------------------------------------------------------------
  // List available mention types
  // ---------------------------------------------------------------------------
  types: protectedProcedure.query(() => {
    return { types: listMentionTypes() };
  }),
});
