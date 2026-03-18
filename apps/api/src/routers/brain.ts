import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import {
  codeEmbeddings, agentMemories, episodicMemories,
  proceduralMemories, blueprints, projects,
} from "@prometheus/db";
import { generateId } from "@prometheus/utils";

export const brainRouter = router({
  search: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      query: z.string().min(1).max(1000),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input, ctx }) => {
      // Text-based search fallback (semantic search requires embedding generation)
      const results = await ctx.db
        .select({
          id: codeEmbeddings.id,
          filePath: codeEmbeddings.filePath,
          content: codeEmbeddings.content,
          chunkIndex: codeEmbeddings.chunkIndex,
        })
        .from(codeEmbeddings)
        .where(and(
          eq(codeEmbeddings.projectId, input.projectId),
          sql`${codeEmbeddings.content} ILIKE ${'%' + input.query + '%'}`,
        ))
        .limit(input.limit);

      return { results };
    }),

  getMemories: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      type: z.enum(["semantic", "episodic", "procedural", "architectural", "convention"]).optional(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
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
    .input(z.object({
      projectId: z.string(),
      type: z.enum(["semantic", "episodic", "procedural", "architectural", "convention"]),
      content: z.string().min(1).max(10000),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = generateId("mem");
      const [memory] = await ctx.db.insert(agentMemories).values({
        id,
        projectId: input.projectId,
        memoryType: input.type,
        content: input.content,
      }).returning();

      return memory;
    }),

  getEpisodicMemories: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const memories = await ctx.db.query.episodicMemories.findMany({
        where: eq(episodicMemories.projectId, input.projectId),
        orderBy: [desc(episodicMemories.createdAt)],
        limit: input.limit,
      });
      return { memories };
    }),

  getProceduralMemories: protectedProcedure
    .input(z.object({
      projectId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const memories = await ctx.db.query.proceduralMemories.findMany({
        where: eq(proceduralMemories.projectId, input.projectId),
      });
      return { memories };
    }),

  getBlueprint: protectedProcedure
    .input(z.object({
      projectId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const blueprint = await ctx.db.query.blueprints.findFirst({
        where: and(
          eq(blueprints.projectId, input.projectId),
          eq(blueprints.isActive, true),
        ),
        with: { versions: true },
      });
      return blueprint ?? null;
    }),

  graph: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      query: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
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
