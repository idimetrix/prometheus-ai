import { deploymentPipelines, pipelineRuns } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("pipelines-router");

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface PipelineStage {
  config: Record<string, unknown>;
  name: string;
  order: number;
  timeoutSeconds: number;
  type: "build" | "test" | "deploy" | "approval" | "notify";
}

/* -------------------------------------------------------------------------- */
/*  Input schemas                                                              */
/* -------------------------------------------------------------------------- */

const stageSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["build", "test", "deploy", "approval", "notify"]),
  config: z.record(z.string(), z.unknown()).default({}),
  order: z.number().int().min(0).optional(),
  timeoutSeconds: z.number().int().min(1).max(86_400).default(300),
});

/* -------------------------------------------------------------------------- */
/*  Router                                                                     */
/* -------------------------------------------------------------------------- */

export const pipelinesRouter = router({
  /**
   * List pipeline definitions for a project.
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select()
        .from(deploymentPipelines)
        .where(
          and(
            eq(deploymentPipelines.projectId, input.projectId),
            eq(deploymentPipelines.orgId, ctx.orgId)
          )
        )
        .orderBy(desc(deploymentPipelines.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [totalResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(deploymentPipelines)
        .where(
          and(
            eq(deploymentPipelines.projectId, input.projectId),
            eq(deploymentPipelines.orgId, ctx.orgId)
          )
        );

      const total = totalResult?.count ?? 0;

      const items = rows.map((p) => {
        const stages = p.stages ?? [];
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          enabled: p.enabled === "true",
          stageCount: stages.length,
          stages: stages.map((s) => ({
            name: s.name,
            type: s.type,
            order: s.order,
          })),
          createdAt:
            p.createdAt instanceof Date
              ? p.createdAt.toISOString()
              : String(p.createdAt),
          updatedAt:
            p.updatedAt instanceof Date
              ? p.updatedAt.toISOString()
              : String(p.updatedAt),
        };
      });

      return { pipelines: items, total };
    }),

  /**
   * Get a single pipeline with full stage details.
   */
  get: protectedProcedure
    .input(z.object({ pipelineId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const [pipeline] = await ctx.db
        .select()
        .from(deploymentPipelines)
        .where(
          and(
            eq(deploymentPipelines.id, input.pipelineId),
            eq(deploymentPipelines.orgId, ctx.orgId)
          )
        );

      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      return {
        id: pipeline.id,
        projectId: pipeline.projectId,
        name: pipeline.name,
        description: pipeline.description,
        enabled: pipeline.enabled === "true",
        stages: pipeline.stages ?? [],
        createdBy: null as string | null,
        createdAt:
          pipeline.createdAt instanceof Date
            ? pipeline.createdAt.toISOString()
            : String(pipeline.createdAt),
        updatedAt:
          pipeline.updatedAt instanceof Date
            ? pipeline.updatedAt.toISOString()
            : String(pipeline.updatedAt),
      };
    }),

  /**
   * Create a new pipeline definition.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        stages: z.array(stageSchema).min(1).max(20),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = generateId("pipe");

      const stages: PipelineStage[] = input.stages.map((s, idx) => ({
        name: s.name,
        type: s.type,
        config: s.config,
        order: s.order ?? idx,
        timeoutSeconds: s.timeoutSeconds,
      }));

      const [pipeline] = await ctx.db
        .insert(deploymentPipelines)
        .values({
          id,
          projectId: input.projectId,
          orgId: ctx.orgId,
          name: input.name,
          description: input.description ?? null,
          enabled: "true",
          stages,
        })
        .returning();

      logger.info(
        {
          pipelineId: id,
          projectId: input.projectId,
          stageCount: stages.length,
        },
        "Pipeline created"
      );

      return {
        id: pipeline?.id,
        name: pipeline?.name,
        stages: pipeline?.stages ?? [],
        createdAt:
          pipeline?.createdAt instanceof Date
            ? pipeline?.createdAt.toISOString()
            : String(pipeline?.createdAt),
      };
    }),

  /**
   * Update an existing pipeline.
   */
  update: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().min(1),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).nullable().optional(),
        enabled: z.boolean().optional(),
        stages: z.array(stageSchema).min(1).max(20).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify the pipeline exists and belongs to this org
      const [existing] = await ctx.db
        .select()
        .from(deploymentPipelines)
        .where(
          and(
            eq(deploymentPipelines.id, input.pipelineId),
            eq(deploymentPipelines.orgId, ctx.orgId)
          )
        );

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) {
        updateData.name = input.name;
      }
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.enabled !== undefined) {
        updateData.enabled = input.enabled ? "true" : "false";
      }
      if (input.stages !== undefined) {
        updateData.stages = input.stages.map((s, idx) => ({
          name: s.name,
          type: s.type,
          config: s.config,
          order: s.order ?? idx,
          timeoutSeconds: s.timeoutSeconds,
        }));
      }

      const [pipeline] = await ctx.db
        .update(deploymentPipelines)
        .set(updateData)
        .where(eq(deploymentPipelines.id, input.pipelineId))
        .returning();

      logger.info({ pipelineId: input.pipelineId }, "Pipeline updated");

      return {
        id: pipeline?.id,
        name: pipeline?.name,
        description: pipeline?.description,
        enabled: pipeline?.enabled === "true",
        stages: pipeline?.stages ?? [],
        updatedAt:
          pipeline?.updatedAt instanceof Date
            ? pipeline?.updatedAt.toISOString()
            : String(pipeline?.updatedAt),
      };
    }),

  /**
   * Delete a pipeline definition.
   */
  delete: protectedProcedure
    .input(z.object({ pipelineId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await ctx.db
        .select({ id: deploymentPipelines.id })
        .from(deploymentPipelines)
        .where(
          and(
            eq(deploymentPipelines.id, input.pipelineId),
            eq(deploymentPipelines.orgId, ctx.orgId)
          )
        );

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      await ctx.db
        .delete(deploymentPipelines)
        .where(eq(deploymentPipelines.id, input.pipelineId));

      logger.info({ pipelineId: input.pipelineId }, "Pipeline deleted");

      return { success: true };
    }),

  /**
   * Trigger a pipeline run.
   */
  trigger: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().min(1),
        branch: z.string().optional(),
        commitSha: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [pipeline] = await ctx.db
        .select()
        .from(deploymentPipelines)
        .where(
          and(
            eq(deploymentPipelines.id, input.pipelineId),
            eq(deploymentPipelines.orgId, ctx.orgId)
          )
        );

      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      if (pipeline.enabled !== "true") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Pipeline is disabled",
        });
      }

      const runId = generateId("run");
      const now = new Date();
      const stages = pipeline.stages ?? [];
      const firstStage = stages[0];

      const [run] = await ctx.db
        .insert(pipelineRuns)
        .values({
          id: runId,
          pipelineId: pipeline.id,
          projectId: pipeline.projectId,
          orgId: ctx.orgId,
          status: "running",
          triggeredBy: ctx.auth.userId,
          branch: input.branch ?? "main",
          commitSha: input.commitSha ?? null,
          currentStage: firstStage?.name ?? null,
          stageResults: firstStage
            ? [
                {
                  stage: firstStage.name,
                  status: "running",
                  startedAt: now.toISOString(),
                },
              ]
            : [],
          startedAt: now,
          completedAt: null,
        })
        .returning();

      logger.info(
        { runId, pipelineId: pipeline.id, branch: run?.branch },
        "Pipeline run triggered"
      );

      return {
        runId: run?.id,
        pipelineId: pipeline.id,
        status: run?.status,
        currentStage: run?.currentStage,
        startedAt: run?.startedAt?.toISOString() ?? null,
      };
    }),

  /**
   * List pipeline execution runs.
   */
  listRuns: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select()
        .from(pipelineRuns)
        .where(
          and(
            eq(pipelineRuns.pipelineId, input.pipelineId),
            eq(pipelineRuns.orgId, ctx.orgId)
          )
        )
        .orderBy(desc(pipelineRuns.startedAt))
        .limit(input.limit)
        .offset(input.offset);

      const [totalResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(pipelineRuns)
        .where(
          and(
            eq(pipelineRuns.pipelineId, input.pipelineId),
            eq(pipelineRuns.orgId, ctx.orgId)
          )
        );

      const total = totalResult?.count ?? 0;

      const items = rows.map((r) => ({
        id: r.id,
        status: r.status,
        triggeredBy: r.triggeredBy,
        branch: r.branch,
        commitSha: r.commitSha,
        currentStage: r.currentStage,
        stageResults: r.stageResults ?? [],
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
      }));

      return { runs: items, total };
    }),
});
