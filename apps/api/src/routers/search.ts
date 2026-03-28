import type { Database } from "@prometheus/db";
import { codeEmbeddings, projects } from "@prometheus/db";
import { TRPCError } from "@trpc/server";
import { and, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

async function verifyProjectOrg(
  db: Database,
  projectId: string,
  orgId: string
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
    columns: { id: true },
  });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
}

export const searchRouter = router({
  /**
   * Search code content across a project using text matching.
   */
  code: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        query: z.string().min(1).max(500),
        language: z.string().optional(),
        filePattern: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const conditions = [
        eq(codeEmbeddings.projectId, input.projectId),
        ilike(codeEmbeddings.content, `%${input.query}%`),
      ];

      if (input.filePattern) {
        conditions.push(
          ilike(codeEmbeddings.filePath, `%${input.filePattern}%`)
        );
      }

      if (input.language) {
        conditions.push(ilike(codeEmbeddings.filePath, `%.${input.language}`));
      }

      const results = await ctx.db
        .select({
          id: codeEmbeddings.id,
          filePath: codeEmbeddings.filePath,
          content: codeEmbeddings.content,
          chunkIndex: codeEmbeddings.chunkIndex,
        })
        .from(codeEmbeddings)
        .where(and(...conditions))
        .limit(input.limit);

      return { results, total: results.length };
    }),

  /**
   * Search files by name pattern.
   */
  files: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        pattern: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const files = await ctx.db
        .selectDistinct({ filePath: codeEmbeddings.filePath })
        .from(codeEmbeddings)
        .where(
          and(
            eq(codeEmbeddings.projectId, input.projectId),
            ilike(codeEmbeddings.filePath, `%${input.pattern}%`)
          )
        )
        .limit(input.limit);

      return { files: files.map((f) => f.filePath), total: files.length };
    }),

  /**
   * Semantic code search using embeddings via project-brain.
   * Proxies to the project-brain service for vector similarity search.
   */
  semantic: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        naturalLanguageQuery: z.string().min(1).max(1000),
        limit: z.number().int().min(1).max(30).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const brainUrl = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
      try {
        const response = await fetch(`${brainUrl}/search/semantic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: input.projectId,
            query: input.naturalLanguageQuery,
            limit: input.limit,
          }),
        });

        if (!response.ok) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Semantic search service unavailable",
          });
        }

        const data = (await response.json()) as {
          results: Array<{
            filePath: string;
            content: string;
            score: number;
          }>;
        };
        return { results: data.results };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform semantic search",
        });
      }
    }),

  /**
   * Search for symbols (functions, classes, types) in a project.
   */
  symbols: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        symbolName: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const brainUrl = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
      try {
        const response = await fetch(`${brainUrl}/symbols/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: input.projectId,
            query: input.symbolName,
          }),
        });

        if (!response.ok) {
          // Fallback to text search in code embeddings
          const results = await ctx.db
            .select({
              id: codeEmbeddings.id,
              filePath: codeEmbeddings.filePath,
              content: codeEmbeddings.content,
            })
            .from(codeEmbeddings)
            .where(
              and(
                eq(codeEmbeddings.projectId, input.projectId),
                sql`${codeEmbeddings.content} ~* ${`\\m${input.symbolName}\\M`}`
              )
            )
            .limit(input.limit);

          return { results, source: "text-fallback" as const };
        }

        const data = (await response.json()) as {
          results: Array<{
            name: string;
            kind: string;
            filePath: string;
            line: number;
          }>;
        };
        return { results: data.results, source: "symbol-store" as const };
      } catch {
        // Fallback to text search
        const results = await ctx.db
          .select({
            id: codeEmbeddings.id,
            filePath: codeEmbeddings.filePath,
            content: codeEmbeddings.content,
          })
          .from(codeEmbeddings)
          .where(
            and(
              eq(codeEmbeddings.projectId, input.projectId),
              ilike(codeEmbeddings.content, `%${input.symbolName}%`)
            )
          )
          .limit(input.limit);

        return { results, source: "text-fallback" as const };
      }
    }),
});
