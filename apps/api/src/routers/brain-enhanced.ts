import type { Database } from "@prometheus/db";
import {
  agentMemories,
  codeEmbeddings,
  episodicMemories,
  proceduralMemories,
  projects,
} from "@prometheus/db";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
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

export const brainEnhancedRouter = router({
  /**
   * Get assembled context for a project from project-brain service.
   * Returns code context, convention context, architecture context, and recent changes.
   */
  getProjectContext: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        taskDescription: z.string().max(2000).default(""),
        agentRole: z.string().default("orchestrator"),
        maxTokens: z.number().int().min(1000).max(100_000).default(14_000),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const brainUrl = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
      try {
        const response = await fetch(`${brainUrl}/context/assemble`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: input.projectId,
            taskDescription: input.taskDescription,
            agentRole: input.agentRole,
            maxTokens: input.maxTokens,
          }),
        });

        if (!response.ok) {
          return {
            codeContext: null,
            conventionContext: null,
            architectureContext: null,
            recentChanges: null,
          };
        }

        const data = (await response.json()) as {
          global?: string;
          taskSpecific?: string;
          session?: string;
        };

        return {
          codeContext: data.taskSpecific ?? null,
          conventionContext: data.global ?? null,
          architectureContext: data.global ?? null,
          recentChanges: data.session ?? null,
        };
      } catch {
        return {
          codeContext: null,
          conventionContext: null,
          architectureContext: null,
          recentChanges: null,
        };
      }
    }),

  /**
   * Trigger full project re-indexing via queue job.
   */
  indexProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      try {
        const { indexingQueue } = await import("@prometheus/queue");
        await indexingQueue.add("index-project", {
          projectId: input.projectId,
          orgId: ctx.orgId,
          filePaths: [],
          fullReindex: true,
          triggeredBy: "manual",
        });
        return { queued: true, projectId: input.projectId };
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to enqueue indexing job",
        });
      }
    }),

  /**
   * Get memory layer statistics for a project.
   */
  getMemoryStats: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const [semanticCount, episodicCount, proceduralCount, memoryCount] =
        await Promise.all([
          ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(codeEmbeddings)
            .where(eq(codeEmbeddings.projectId, input.projectId)),
          ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(episodicMemories)
            .where(eq(episodicMemories.projectId, input.projectId)),
          ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(proceduralMemories)
            .where(eq(proceduralMemories.projectId, input.projectId)),
          ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(agentMemories)
            .where(eq(agentMemories.projectId, input.projectId)),
        ]);

      return {
        semantic: semanticCount[0]?.count ?? 0,
        episodic: episodicCount[0]?.count ?? 0,
        procedural: proceduralCount[0]?.count ?? 0,
        agentMemories: memoryCount[0]?.count ?? 0,
        total:
          (semanticCount[0]?.count ?? 0) +
          (episodicCount[0]?.count ?? 0) +
          (proceduralCount[0]?.count ?? 0) +
          (memoryCount[0]?.count ?? 0),
      };
    }),

  /**
   * Search project brain across specified memory layers.
   */
  search: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        query: z.string().min(1).max(1000),
        layers: z
          .array(z.enum(["semantic", "episodic", "procedural"]))
          .default(["semantic", "episodic", "procedural"]),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectOrg(ctx.db, input.projectId, ctx.orgId);

      const brainUrl = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

      const results: Record<
        string,
        Array<{ content: string; filePath?: string; score?: number }>
      > = {};

      const tasks = input.layers.map(async (layer) => {
        try {
          if (layer === "semantic") {
            const response = await fetch(`${brainUrl}/search/semantic`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: input.projectId,
                query: input.query,
                limit: input.limit,
              }),
            });
            if (response.ok) {
              const data = (await response.json()) as {
                results: Array<{
                  content: string;
                  filePath?: string;
                  score?: number;
                }>;
              };
              results.semantic = data.results;
            }
          } else if (layer === "episodic") {
            const response = await fetch(
              `${brainUrl}/memory/${input.projectId}?type=episodic&query=${encodeURIComponent(input.query)}&limit=${input.limit}`
            );
            if (response.ok) {
              const data = (await response.json()) as {
                memories: Array<{ content: string }>;
              };
              results.episodic = data.memories.map((m) => ({
                content:
                  typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content),
              }));
            }
          } else if (layer === "procedural") {
            const response = await fetch(
              `${brainUrl}/procedural/find-relevant`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  projectId: input.projectId,
                  taskDescription: input.query,
                  limit: input.limit,
                }),
              }
            );
            if (response.ok) {
              const data = (await response.json()) as {
                procedures: Array<{ content: string }>;
              };
              results.procedural = data.procedures.map((p) => ({
                content:
                  typeof p.content === "string"
                    ? p.content
                    : JSON.stringify(p.content),
              }));
            }
          }
        } catch {
          results[layer] = [];
        }
      });

      await Promise.allSettled(tasks);

      return { results };
    }),
});
