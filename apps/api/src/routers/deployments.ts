import { deployments, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { previewDeploymentQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDeploymentProvider } from "../deployments";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("deployments-router");

const deploymentProviderSchema = z.enum([
  "vercel",
  "netlify",
  "cloudflare",
  "docker",
]);

export const deploymentsRouter = router({
  // ─── Create Preview Deployment ───────────────────────────────────────────
  createPreviewDeployment: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        sessionId: z.string().optional(),
        provider: deploymentProviderSchema,
        branch: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify project access
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

      // Validate provider is supported
      const provider = getDeploymentProvider(input.provider);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unsupported deployment provider: ${input.provider}`,
        });
      }

      const id = generateId("deploy");

      // Create deployment record
      const [deployment] = await ctx.db
        .insert(deployments)
        .values({
          id,
          projectId: input.projectId,
          sessionId: input.sessionId ?? null,
          orgId: ctx.orgId,
          provider: input.provider,
          status: "queued",
          branch: input.branch ?? null,
        })
        .returning();

      // Queue the deployment job
      await previewDeploymentQueue.add(
        "preview-deployment",
        {
          deploymentId: id,
          projectId: input.projectId,
          sessionId: input.sessionId,
          orgId: ctx.orgId,
          provider: input.provider,
          branch: input.branch,
        },
        {
          jobId: `deploy-${id}`,
        }
      );

      logger.info(
        {
          deploymentId: id,
          projectId: input.projectId,
          provider: input.provider,
        },
        "Preview deployment created and queued"
      );

      return deployment as NonNullable<typeof deployment>;
    }),

  // ─── Get Deployment ──────────────────────────────────────────────────────
  getDeployment: protectedProcedure
    .input(z.object({ deploymentId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.orgId, ctx.orgId)
        ),
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      return deployment;
    }),

  // ─── List Deployments ────────────────────────────────────────────────────
  listDeployments: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify project access
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

      const results = await ctx.db.query.deployments.findMany({
        where: and(
          eq(deployments.projectId, input.projectId),
          eq(deployments.orgId, ctx.orgId)
        ),
        orderBy: [desc(deployments.createdAt)],
        limit: input.limit,
      });

      return { deployments: results };
    }),

  // ─── Delete Deployment ───────────────────────────────────────────────────
  deleteDeployment: protectedProcedure
    .input(z.object({ deploymentId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.orgId, ctx.orgId)
        ),
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Teardown the deployment with the provider
      if (deployment.providerDeploymentId) {
        const provider = getDeploymentProvider(deployment.provider);
        if (provider) {
          try {
            await provider.teardown(deployment.providerDeploymentId);
          } catch (err) {
            logger.error(
              { err, deploymentId: input.deploymentId },
              "Failed to teardown deployment with provider"
            );
          }
        }
      }

      // Mark as deleted
      const [updated] = await ctx.db
        .update(deployments)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(deployments.id, input.deploymentId))
        .returning();

      logger.info({ deploymentId: input.deploymentId }, "Deployment deleted");

      return updated as NonNullable<typeof updated>;
    }),

  // ─── Get Deployment Logs ─────────────────────────────────────────────────
  getDeploymentLogs: protectedProcedure
    .input(z.object({ deploymentId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.orgId, ctx.orgId)
        ),
        columns: {
          id: true,
          buildLogs: true,
          status: true,
          errorMessage: true,
        },
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      return {
        deploymentId: deployment.id,
        status: deployment.status,
        logs: deployment.buildLogs ?? "",
        errorMessage: deployment.errorMessage ?? null,
      };
    }),
});
