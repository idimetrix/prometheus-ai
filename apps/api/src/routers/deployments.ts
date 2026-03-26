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
  // ─── Deploy (shorthand for createPreviewDeployment) ───────────────────────
  deploy: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        provider: deploymentProviderSchema,
        branch: z.string().optional(),
        environment: z.string().optional(),
        sessionId: z.string().optional(),
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

      const provider = getDeploymentProvider(input.provider);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unsupported deployment provider: ${input.provider}`,
        });
      }

      const id = generateId("deploy");

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
        { jobId: `deploy-${id}` }
      );

      logger.info(
        {
          deploymentId: id,
          projectId: input.projectId,
          provider: input.provider,
          environment: input.environment,
        },
        "Deployment queued"
      );

      return deployment as NonNullable<typeof deployment>;
    }),

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

      const provider = getDeploymentProvider(input.provider);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unsupported deployment provider: ${input.provider}`,
        });
      }

      const id = generateId("deploy");

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
        { jobId: `deploy-${id}` }
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

  // ─── Get Deployment Status (live from provider) ─────────────────────────
  getStatus: protectedProcedure
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

      // If we have a provider deployment ID, fetch live status
      if (deployment.providerDeploymentId) {
        const provider = getDeploymentProvider(deployment.provider);
        if (provider) {
          try {
            const liveStatus = await provider.getStatus(
              deployment.providerDeploymentId
            );

            // Sync DB status if it changed
            const newStatus = mapProviderState(
              liveStatus.state,
              liveStatus.ready
            );
            if (newStatus && newStatus !== deployment.status) {
              await ctx.db
                .update(deployments)
                .set({
                  status: newStatus,
                  url: liveStatus.url ?? deployment.url,
                  errorMessage:
                    liveStatus.errorMessage ?? deployment.errorMessage,
                  updatedAt: new Date(),
                })
                .where(eq(deployments.id, deployment.id));
            }

            return {
              deploymentId: deployment.id,
              status: newStatus ?? deployment.status,
              providerState: liveStatus.state,
              url: liveStatus.url ?? deployment.url,
              ready: liveStatus.ready,
              errorMessage: liveStatus.errorMessage ?? deployment.errorMessage,
              provider: deployment.provider,
              branch: deployment.branch,
              createdAt: deployment.createdAt,
            };
          } catch (err) {
            logger.warn(
              { err, deploymentId: deployment.id },
              "Failed to fetch live provider status, falling back to DB"
            );
          }
        }
      }

      // Fall back to DB state
      return {
        deploymentId: deployment.id,
        status: deployment.status,
        providerState: null,
        url: deployment.url,
        ready: deployment.status === "live",
        errorMessage: deployment.errorMessage,
        provider: deployment.provider,
        branch: deployment.branch,
        createdAt: deployment.createdAt,
      };
    }),

  // ─── List Deployments ────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
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

  // ─── List Deployments (legacy alias) ──────────────────────────────────────
  listDeployments: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
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

  // ─── Rollback ────────────────────────────────────────────────────────────
  rollback: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        targetDeploymentId: z.string().optional(),
      })
    )
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

      // If a target deployment is specified, we re-deploy that version
      if (input.targetDeploymentId) {
        const targetDeployment = await ctx.db.query.deployments.findFirst({
          where: and(
            eq(deployments.id, input.targetDeploymentId),
            eq(deployments.orgId, ctx.orgId),
            eq(deployments.projectId, deployment.projectId)
          ),
        });

        if (!targetDeployment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Target deployment not found",
          });
        }

        // Queue a new deployment that mirrors the target
        const id = generateId("deploy");
        const [rollbackDeployment] = await ctx.db
          .insert(deployments)
          .values({
            id,
            projectId: deployment.projectId,
            sessionId: null,
            orgId: ctx.orgId,
            provider: targetDeployment.provider,
            status: "queued",
            branch: targetDeployment.branch,
          })
          .returning();

        await previewDeploymentQueue.add(
          "preview-deployment",
          {
            deploymentId: id,
            projectId: deployment.projectId,
            orgId: ctx.orgId,
            provider: targetDeployment.provider,
            branch: targetDeployment.branch ?? undefined,
          },
          { jobId: `deploy-${id}` }
        );

        logger.info(
          {
            deploymentId: id,
            rolledBackFrom: input.deploymentId,
            rolledBackTo: input.targetDeploymentId,
          },
          "Rollback deployment created"
        );

        return rollbackDeployment as NonNullable<typeof rollbackDeployment>;
      }

      // No target specified: tear down the current deployment
      if (deployment.providerDeploymentId) {
        const provider = getDeploymentProvider(deployment.provider);
        if (provider) {
          try {
            await provider.teardown(deployment.providerDeploymentId);
          } catch (err) {
            logger.error(
              { err, deploymentId: input.deploymentId },
              "Failed to teardown deployment during rollback"
            );
          }
        }
      }

      const [updated] = await ctx.db
        .update(deployments)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(deployments.id, input.deploymentId))
        .returning();

      logger.info(
        { deploymentId: input.deploymentId },
        "Deployment rolled back (torn down)"
      );

      return updated as NonNullable<typeof updated>;
    }),

  // ─── Get Deployment Logs ─────────────────────────────────────────────────
  getLogs: protectedProcedure
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

  // ─── Get Deployment Logs (legacy alias) ─────────────────────────────────
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

      const [updated] = await ctx.db
        .update(deployments)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(deployments.id, input.deploymentId))
        .returning();

      logger.info({ deploymentId: input.deploymentId }, "Deployment deleted");

      return updated as NonNullable<typeof updated>;
    }),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map a provider-specific state string to our deployment status enum.
 */
function mapProviderState(
  providerState: string,
  ready: boolean
): "queued" | "building" | "deploying" | "live" | "failed" | "deleted" | null {
  if (ready) {
    return "live";
  }

  const normalized = providerState.toLowerCase();

  if (normalized === "error" || normalized === "canceled") {
    return "failed";
  }
  if (normalized === "building" || normalized === "processing") {
    return "building";
  }
  if (normalized === "deploying" || normalized === "uploading") {
    return "deploying";
  }
  if (
    normalized === "queued" ||
    normalized === "initializing" ||
    normalized === "pending"
  ) {
    return "queued";
  }
  if (normalized === "ready" || normalized === "live") {
    return "live";
  }

  return null;
}
