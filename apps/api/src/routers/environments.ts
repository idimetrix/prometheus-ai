import { deployments, environments, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("environments-router");

export const environmentsRouter = router({
  // ─── List environments for a project ─────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const results = await ctx.db.query.environments.findMany({
        where: and(
          eq(environments.projectId, input.projectId),
          eq(environments.orgId, ctx.orgId)
        ),
        orderBy: [desc(environments.createdAt)],
      });

      return { environments: results };
    }),

  // ─── Create a new environment ────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(100),
        url: z.string().url().optional(),
        provider: z.string().max(50).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      // Check uniqueness of (projectId, name)
      const existing = await ctx.db.query.environments.findFirst({
        where: and(
          eq(environments.projectId, input.projectId),
          eq(environments.name, input.name)
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Environment "${input.name}" already exists for this project`,
        });
      }

      const id = generateId("env");

      const [environment] = await ctx.db
        .insert(environments)
        .values({
          id,
          projectId: input.projectId,
          orgId: ctx.orgId,
          name: input.name,
          url: input.url ?? null,
          provider: input.provider ?? null,
          status: "active",
        })
        .returning();

      logger.info(
        { environmentId: id, projectId: input.projectId, name: input.name },
        "Environment created"
      );

      return environment as NonNullable<typeof environment>;
    }),

  // ─── Update an environment ───────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        url: z.string().url().nullable().optional(),
        status: z.enum(["active", "inactive", "deploying"]).optional(),
        provider: z.string().max(50).nullable().optional(),
        deploymentId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.environments.findFirst({
        where: and(
          eq(environments.id, input.id),
          eq(environments.orgId, ctx.orgId)
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (input.url !== undefined) {
        updates.url = input.url;
      }
      if (input.status !== undefined) {
        updates.status = input.status;
      }
      if (input.provider !== undefined) {
        updates.provider = input.provider;
      }
      if (input.deploymentId !== undefined) {
        updates.deploymentId = input.deploymentId;
      }

      const [updated] = await ctx.db
        .update(environments)
        .set(updates)
        .where(
          and(eq(environments.id, input.id), eq(environments.orgId, ctx.orgId))
        )
        .returning();

      return updated as NonNullable<typeof updated>;
    }),

  // ─── Delete an environment ───────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [deleted] = await ctx.db
        .delete(environments)
        .where(
          and(eq(environments.id, input.id), eq(environments.orgId, ctx.orgId))
        )
        .returning();

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      logger.info({ environmentId: input.id }, "Environment deleted");

      return { success: true };
    }),

  // ─── Promote from one environment to another ────────────────────────────
  promote: protectedProcedure
    .input(
      z.object({
        sourceId: z.string().min(1),
        targetId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const source = await ctx.db.query.environments.findFirst({
        where: and(
          eq(environments.id, input.sourceId),
          eq(environments.orgId, ctx.orgId)
        ),
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source environment not found",
        });
      }

      const target = await ctx.db.query.environments.findFirst({
        where: and(
          eq(environments.id, input.targetId),
          eq(environments.orgId, ctx.orgId)
        ),
      });

      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target environment not found",
        });
      }

      if (source.projectId !== target.projectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Source and target environments must belong to the same project",
        });
      }

      // Copy deployment info from source to target
      const [updated] = await ctx.db
        .update(environments)
        .set({
          deploymentId: source.deploymentId,
          url: source.url,
          provider: source.provider,
          status: "deploying",
          lastDeployedAt: new Date(),
        })
        .where(eq(environments.id, input.targetId))
        .returning();

      logger.info(
        {
          sourceId: input.sourceId,
          targetId: input.targetId,
          sourceName: source.name,
          targetName: target.name,
        },
        "Environment promoted"
      );

      return {
        promoted: updated as NonNullable<typeof updated>,
        source: source.name,
        target: target.name,
      };
    }),

  // ─── Get deployment status for an environment ───────────────────────────
  getStatus: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const environment = await ctx.db.query.environments.findFirst({
        where: and(
          eq(environments.id, input.id),
          eq(environments.orgId, ctx.orgId)
        ),
      });

      if (!environment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      const deployment = environment.deploymentId
        ? await ctx.db.query.deployments.findFirst({
            where: eq(deployments.id, environment.deploymentId),
          })
        : null;

      return {
        environment: {
          id: environment.id,
          name: environment.name,
          status: environment.status,
          url: environment.url,
          provider: environment.provider,
          lastDeployedAt: environment.lastDeployedAt,
        },
        deployment: deployment
          ? {
              id: deployment.id,
              status: deployment.status,
              url: deployment.url,
              provider: deployment.provider,
              createdAt: deployment.createdAt,
            }
          : null,
      };
    }),
});
