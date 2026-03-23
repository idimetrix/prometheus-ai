import type { Database } from "@prometheus/db";
import {
  agentMemories,
  blueprints,
  codeEmbeddings,
  episodicMemories,
  proceduralMemories,
  projects,
} from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

/**
 * Verify that a project belongs to the caller's org.
 * Prevents cross-org access via projectId guessing.
 */
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

export const brainRouter = router({
  search: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        query: z.string().min(1, "Search query is required").max(1000),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      // RLS: verify project belongs to caller's org
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      // Text-based search fallback (semantic search requires embedding generation)
      const results = await ctx.db
        .select({
          id: codeEmbeddings.id,
          filePath: codeEmbeddings.filePath,
          content: codeEmbeddings.content,
          chunkIndex: codeEmbeddings.chunkIndex,
        })
        .from(codeEmbeddings)
        .where(
          and(
            eq(codeEmbeddings.projectId, input.projectId),
            sql`${codeEmbeddings.content} ILIKE ${`%${input.query}%`}`
          )
        )
        .limit(input.limit);

      return { results };
    }),

  getMemories: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        type: z
          .enum([
            "semantic",
            "episodic",
            "procedural",
            "architectural",
            "convention",
          ])
          .optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      // RLS: verify project belongs to caller's org
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const conditions = [eq(agentMemories.projectId, input.projectId)];
      if (input.type) {
        conditions.push(eq(agentMemories.memoryType, input.type));
      }

      const memories = await ctx.db.query.agentMemories.findMany({
        where: and(...conditions),
        orderBy: [desc(agentMemories.createdAt)],
        limit: input.limit,
      });

      return { memories };
    }),

  storeMemory: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        type: z.enum([
          "semantic",
          "episodic",
          "procedural",
          "architectural",
          "convention",
        ]),
        content: z.string().min(1, "Memory content is required").max(10_000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // RLS: verify project belongs to caller's org
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const id = generateId("mem");
      const [memory] = await ctx.db
        .insert(agentMemories)
        .values({
          id,
          projectId: input.projectId,
          memoryType: input.type,
          content: input.content,
        })
        .returning();

      return memory;
    }),

  getEpisodicMemories: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      // RLS: verify project belongs to caller's org
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const memories = await ctx.db.query.episodicMemories.findMany({
        where: eq(episodicMemories.projectId, input.projectId),
        orderBy: [desc(episodicMemories.createdAt)],
        limit: input.limit,
      });
      return { memories };
    }),

  getProceduralMemories: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      // RLS: verify project belongs to caller's org
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const memories = await ctx.db.query.proceduralMemories.findMany({
        where: eq(proceduralMemories.projectId, input.projectId),
      });
      return { memories };
    }),

  getBlueprint: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      // RLS: verify project belongs to caller's org
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const blueprint = await ctx.db.query.blueprints.findFirst({
        where: and(
          eq(blueprints.projectId, input.projectId),
          eq(blueprints.isActive, true)
        ),
        with: { versions: true },
      });
      return blueprint ?? null;
    }),

  graph: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        query: z.string().max(1000).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      // RLS: verify project belongs to caller's org
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      // Return file dependency graph from embeddings
      const files = await ctx.db
        .select({
          filePath: codeEmbeddings.filePath,
          chunkCount: sql<number>`COUNT(*)`,
        })
        .from(codeEmbeddings)
        .where(eq(codeEmbeddings.projectId, input.projectId))
        .groupBy(codeEmbeddings.filePath)
        .orderBy(codeEmbeddings.filePath);

      return {
        nodes: files.map((f) => ({
          id: f.filePath,
          label: f.filePath.split("/").pop() ?? f.filePath,
          chunks: Number(f.chunkCount),
        })),
        edges: [] as Array<{ source: string; target: string; type: string }>,
      };
    }),
});
