import { persistentSandboxes, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("persistent-envs-router");

export const persistentEnvsRouter = router({
  // ---------------------------------------------------------------------------
  // Create a persistent environment
  // ---------------------------------------------------------------------------
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(200).optional(),
        purpose: z.enum(["dev", "test", "staging"]).default("dev"),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify project access
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
        columns: { id: true, name: true },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const [env] = await ctx.db
        .insert(persistentSandboxes)
        .values({
          orgId: ctx.orgId,
          projectId: input.projectId,
          status: "active",
          purpose: input.purpose,
          config: input.config ?? {},
          lastActivityAt: new Date(),
        })
        .returning();

      if (!env) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create environment",
        });
      }

      logger.info(
        {
          envId: env.id,
          projectId: input.projectId,
          purpose: input.purpose,
          orgId: ctx.orgId,
        },
        "Persistent environment created"
      );

      return { environment: env };
    }),

  // ---------------------------------------------------------------------------
  // List environments for org/project
  // ---------------------------------------------------------------------------
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        status: z.enum(["active", "suspended", "terminated"]).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [eq(persistentSandboxes.orgId, ctx.orgId)];

      if (input.projectId) {
        conditions.push(eq(persistentSandboxes.projectId, input.projectId));
      }
      if (input.status) {
        conditions.push(eq(persistentSandboxes.status, input.status));
      }

      const environments = await ctx.db.query.persistentSandboxes.findMany({
        where: and(...conditions),
        orderBy: [desc(persistentSandboxes.createdAt)],
        limit: input.limit,
      });

      return { environments };
    }),

  // ---------------------------------------------------------------------------
  // Get environment details with status
  // ---------------------------------------------------------------------------
  get: protectedProcedure
    .input(z.object({ envId: z.string() }))
    .query(async ({ input, ctx }) => {
      const env = await ctx.db.query.persistentSandboxes.findFirst({
        where: and(
          eq(persistentSandboxes.id, input.envId),
          eq(persistentSandboxes.orgId, ctx.orgId)
        ),
      });

      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      return { environment: env };
    }),

  // ---------------------------------------------------------------------------
  // Suspend (snapshot and shut down) an environment
  // ---------------------------------------------------------------------------
  suspend: protectedProcedure
    .input(z.object({ envId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const env = await ctx.db.query.persistentSandboxes.findFirst({
        where: and(
          eq(persistentSandboxes.id, input.envId),
          eq(persistentSandboxes.orgId, ctx.orgId)
        ),
      });

      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      if (env.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot suspend environment with status "${env.status}"`,
        });
      }

      const snapshotUrl = `snapshot://${env.id}/${Date.now()}`;

      const [updated] = await ctx.db
        .update(persistentSandboxes)
        .set({
          status: "suspended",
          snapshotUrl,
        })
        .where(eq(persistentSandboxes.id, input.envId))
        .returning();

      logger.info(
        { envId: input.envId, orgId: ctx.orgId },
        "Persistent environment suspended"
      );

      return { environment: updated };
    }),

  // ---------------------------------------------------------------------------
  // Resume a suspended environment from snapshot
  // ---------------------------------------------------------------------------
  resume: protectedProcedure
    .input(z.object({ envId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const env = await ctx.db.query.persistentSandboxes.findFirst({
        where: and(
          eq(persistentSandboxes.id, input.envId),
          eq(persistentSandboxes.orgId, ctx.orgId)
        ),
      });

      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      if (env.status !== "suspended") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot resume environment with status "${env.status}"`,
        });
      }

      const [updated] = await ctx.db
        .update(persistentSandboxes)
        .set({
          status: "active",
          lastActivityAt: new Date(),
        })
        .where(eq(persistentSandboxes.id, input.envId))
        .returning();

      logger.info(
        { envId: input.envId, orgId: ctx.orgId },
        "Persistent environment resumed"
      );

      return { environment: updated };
    }),

  // ---------------------------------------------------------------------------
  // Destroy an environment and clean up
  // ---------------------------------------------------------------------------
  destroy: protectedProcedure
    .input(z.object({ envId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const env = await ctx.db.query.persistentSandboxes.findFirst({
        where: and(
          eq(persistentSandboxes.id, input.envId),
          eq(persistentSandboxes.orgId, ctx.orgId)
        ),
      });

      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      if (env.status === "terminated") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Environment is already terminated",
        });
      }

      const [updated] = await ctx.db
        .update(persistentSandboxes)
        .set({
          status: "terminated",
          containerId: null,
          sessionId: null,
        })
        .where(eq(persistentSandboxes.id, input.envId))
        .returning();

      logger.info(
        { envId: input.envId, orgId: ctx.orgId },
        "Persistent environment destroyed"
      );

      return { environment: updated };
    }),

  // ---------------------------------------------------------------------------
  // Connect a session to a persistent environment
  // ---------------------------------------------------------------------------
  connect: protectedProcedure
    .input(
      z.object({
        envId: z.string(),
        sessionId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const env = await ctx.db.query.persistentSandboxes.findFirst({
        where: and(
          eq(persistentSandboxes.id, input.envId),
          eq(persistentSandboxes.orgId, ctx.orgId)
        ),
      });

      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      if (env.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot connect to environment with status "${env.status}"`,
        });
      }

      const [updated] = await ctx.db
        .update(persistentSandboxes)
        .set({
          sessionId: input.sessionId,
          lastActivityAt: new Date(),
        })
        .where(eq(persistentSandboxes.id, input.envId))
        .returning();

      logger.info(
        { envId: input.envId, sessionId: input.sessionId, orgId: ctx.orgId },
        "Session connected to persistent environment"
      );

      return { environment: updated };
    }),
});
