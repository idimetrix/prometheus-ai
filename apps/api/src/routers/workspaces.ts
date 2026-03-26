import {
  projects,
  workspaceMembers,
  workspaceProjects,
  workspaces,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("workspaces-router");

export const workspacesRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        isDefault: z.boolean().default(false),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const workspace = await ctx.db
        .insert(workspaces)
        .values({
          id: generateId(),
          orgId: ctx.orgId,
          name: input.name,
          description: input.description ?? null,
          isDefault: input.isDefault,
          settings: input.settings ?? {},
        })
        .returning();

      return workspace[0];
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.id),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      return workspace;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const results = await ctx.db.query.workspaces.findMany({
      where: eq(workspaces.orgId, ctx.orgId),
      orderBy: (ws, { asc }) => [asc(ws.name)],
    });

    return { workspaces: results };
  }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().nullable().optional(),
        isDefault: z.boolean().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;

      const existing = await ctx.db.query.workspaces.findFirst({
        where: and(eq(workspaces.id, id), eq(workspaces.orgId, ctx.orgId)),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const updated = await ctx.db
        .update(workspaces)
        .set(data)
        .where(and(eq(workspaces.id, id), eq(workspaces.orgId, ctx.orgId)))
        .returning();

      return updated[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.id),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      await ctx.db
        .delete(workspaces)
        .where(
          and(eq(workspaces.id, input.id), eq(workspaces.orgId, ctx.orgId))
        );

      return { success: true };
    }),

  // ─── Add project to workspace ───────────────────────────────────────────
  addProject: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        projectId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify workspace ownership
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.workspaceId),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Verify project ownership
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

      // Check for existing association
      const existing = await ctx.db
        .select()
        .from(workspaceProjects)
        .where(
          and(
            eq(workspaceProjects.workspaceId, input.workspaceId),
            eq(workspaceProjects.projectId, input.projectId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Project is already in this workspace",
        });
      }

      const [association] = await ctx.db
        .insert(workspaceProjects)
        .values({
          id: generateId("wsp"),
          workspaceId: input.workspaceId,
          projectId: input.projectId,
        })
        .returning();

      logger.info(
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
        },
        "Project added to workspace"
      );

      return association as NonNullable<typeof association>;
    }),

  // ─── Remove project from workspace ──────────────────────────────────────
  removeProject: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        projectId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify workspace ownership
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.workspaceId),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const [deleted] = await ctx.db
        .delete(workspaceProjects)
        .where(
          and(
            eq(workspaceProjects.workspaceId, input.workspaceId),
            eq(workspaceProjects.projectId, input.projectId)
          )
        )
        .returning();

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project association not found",
        });
      }

      return { success: true };
    }),

  // ─── Add member to workspace ────────────────────────────────────────────
  addMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        userId: z.string().min(1),
        role: z.enum(["admin", "member", "viewer"]).default("member"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.workspaceId),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Check for existing membership
      const existing = await ctx.db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this workspace",
        });
      }

      const [member] = await ctx.db
        .insert(workspaceMembers)
        .values({
          id: generateId("wsm"),
          workspaceId: input.workspaceId,
          orgId: ctx.orgId,
          userId: input.userId,
          role: input.role,
        })
        .returning();

      logger.info(
        {
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: input.role,
        },
        "Member added to workspace"
      );

      return member as NonNullable<typeof member>;
    }),

  // ─── Remove member from workspace ───────────────────────────────────────
  removeMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        userId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.workspaceId),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const [deleted] = await ctx.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId)
          )
        )
        .returning();

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in workspace",
        });
      }

      return { success: true };
    }),

  // ─── List projects in workspace ─────────────────────────────────────────
  listProjects: protectedProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.workspaceId),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const associations = await ctx.db
        .select({
          associationId: workspaceProjects.id,
          projectId: workspaceProjects.projectId,
          addedAt: workspaceProjects.createdAt,
          name: projects.name,
          description: projects.description,
          status: projects.status,
        })
        .from(workspaceProjects)
        .innerJoin(projects, eq(workspaceProjects.projectId, projects.id))
        .where(eq(workspaceProjects.workspaceId, input.workspaceId));

      return { projects: associations };
    }),

  // ─── List members in workspace ──────────────────────────────────────────
  listMembers: protectedProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.workspaceId),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const members = await ctx.db
        .select({
          id: workspaceMembers.id,
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          joinedAt: workspaceMembers.createdAt,
        })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, input.workspaceId));

      return { members };
    }),

  // ─── Update workspace settings ──────────────────────────────────────────
  updateSettings: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        settings: z.object({
          defaultModel: z.string().optional(),
          defaultBranchStrategy: z
            .enum(["feature-branch", "trunk-based", "gitflow"])
            .optional(),
          defaultAgentAggressiveness: z
            .enum(["conservative", "balanced", "aggressive"])
            .optional(),
          maxConcurrentTasks: z.number().int().min(1).max(50).optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.workspaceId),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const currentSettings =
        (workspace.settings as Record<string, unknown>) ?? {};
      const mergedSettings = { ...currentSettings, ...input.settings };

      const [updated] = await ctx.db
        .update(workspaces)
        .set({ settings: mergedSettings })
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.orgId, ctx.orgId)
          )
        )
        .returning();

      return updated;
    }),
});
