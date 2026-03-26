import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../trpc";

const logger = createLogger("snippets-router");

/* -------------------------------------------------------------------------- */
/*  In-memory store (replace with DB table in production)                      */
/* -------------------------------------------------------------------------- */

interface SnippetRecord {
  code: string;
  createdAt: Date;
  createdBy: string;
  expiration: "never" | "1d" | "7d" | "30d";
  expiresAt: Date | null;
  id: string;
  language: string;
  orgId: string;
  title: string;
  visibility: "public" | "private";
}

const snippetStore = new Map<string, SnippetRecord>();

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function computeExpiresAt(expiration: string, from: Date): Date | null {
  switch (expiration) {
    case "1d":
      return new Date(from.getTime() + 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

function isExpired(snippet: SnippetRecord): boolean {
  if (!snippet.expiresAt) {
    return false;
  }
  return new Date() > snippet.expiresAt;
}

/* -------------------------------------------------------------------------- */
/*  Router                                                                     */
/* -------------------------------------------------------------------------- */

export const snippetsRouter = router({
  /**
   * Create a new code snippet.
   */
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        code: z.string().min(1).max(100_000),
        language: z.string().min(1).max(50),
        visibility: z.enum(["public", "private"]).default("public"),
        expiration: z.enum(["never", "1d", "7d", "30d"]).default("never"),
      })
    )
    .mutation(({ input, ctx }) => {
      const id = generateId();
      const now = new Date();

      const snippet: SnippetRecord = {
        id,
        title: input.title,
        code: input.code,
        language: input.language,
        visibility: input.visibility,
        expiration: input.expiration,
        expiresAt: computeExpiresAt(input.expiration, now),
        orgId: ctx.orgId,
        createdBy: ctx.auth.userId,
        createdAt: now,
      };

      snippetStore.set(id, snippet);

      logger.info(
        {
          id,
          language: input.language,
          visibility: input.visibility,
          orgId: ctx.orgId,
        },
        "Snippet created"
      );

      return {
        id: snippet.id,
        title: snippet.title,
        language: snippet.language,
        visibility: snippet.visibility,
        expiration: snippet.expiration,
        createdAt: snippet.createdAt.toISOString(),
        url: `/snippets/${snippet.id}`,
      };
    }),

  /**
   * Get a snippet by ID.
   * Public snippets can be fetched without authentication.
   * Private snippets require the caller to be in the same org.
   */
  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input, ctx }) => {
      const snippet = snippetStore.get(input.id);

      if (!snippet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Snippet not found",
        });
      }

      if (isExpired(snippet)) {
        snippetStore.delete(input.id);
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Snippet has expired",
        });
      }

      if (snippet.visibility === "private") {
        if (!ctx.auth) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Authentication required for private snippets",
          });
        }
        const orgId = ctx.auth.orgId ?? ctx.auth.userId;
        if (orgId !== snippet.orgId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You do not have access to this snippet",
          });
        }
      }

      return {
        id: snippet.id,
        title: snippet.title,
        code: snippet.code,
        language: snippet.language,
        visibility: snippet.visibility,
        expiration: snippet.expiration,
        createdAt: snippet.createdAt.toISOString(),
        url: `/snippets/${snippet.id}`,
      };
    }),

  /**
   * List snippets for the current user's org.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
        .default({ limit: 50, offset: 0 })
    )
    .query(({ input, ctx }) => {
      const allSnippets: SnippetRecord[] = [];

      for (const snippet of snippetStore.values()) {
        if (snippet.orgId === ctx.orgId && !isExpired(snippet)) {
          allSnippets.push(snippet);
        }
      }

      // Sort by creation date descending
      allSnippets.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const items = allSnippets
        .slice(input.offset, input.offset + input.limit)
        .map((s) => ({
          id: s.id,
          title: s.title,
          language: s.language,
          visibility: s.visibility,
          expiration: s.expiration,
          createdAt: s.createdAt.toISOString(),
          url: `/snippets/${s.id}`,
        }));

      return {
        items,
        total: allSnippets.length,
      };
    }),

  /**
   * Delete a snippet.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const snippet = snippetStore.get(input.id);

      if (!snippet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Snippet not found",
        });
      }

      if (snippet.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this snippet",
        });
      }

      snippetStore.delete(input.id);

      logger.info({ id: input.id, orgId: ctx.orgId }, "Snippet deleted");

      return { success: true };
    }),
});
