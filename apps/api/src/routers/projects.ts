import type { Database } from "@prometheus/db";
import {
  blueprints,
  blueprintVersions,
  projectMembers,
  projectSettings,
  projects,
  sessions,
  tasks,
  techStackPresets,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { indexingQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import {
  addProjectMemberSchema,
  archiveProjectSchema,
  createProjectSchema,
  getProjectSchema,
  listProjectsSchema,
  removeProjectMemberSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
  updateProjectSettingsSchema,
} from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("projects-router");

const PROJECT_BRAIN_URL = "http://localhost:4003";

/**
 * Verify that a project belongs to the caller's org.
 * Returns the project row or throws TRPC NOT_FOUND.
 */
async function verifyProjectAccess(
  db: Database,
  projectId: string,
  orgId: string
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  return project;
}

/**
 * Verify the caller has a specific minimum role on the project.
 * Roles ordered: owner > contributor > viewer.
 */
async function verifyProjectRole(
  db: Database,
  projectId: string,
  userId: string,
  minimumRole: "viewer" | "contributor" | "owner"
) {
  const member = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId)
    ),
  });

  if (!member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this project",
    });
  }

  const roleRank: Record<string, number> = {
    viewer: 0,
    contributor: 1,
    owner: 2,
  };
  if ((roleRank[member.role] ?? 0) < (roleRank[minimumRole] ?? 0)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This action requires at least '${minimumRole}' role`,
    });
  }

  return member;
}

export const projectsRouter = router({
  // ─── Create Project ───────────────────────────────────────────────────
  create: protectedProcedure
    .input(createProjectSchema)
    .mutation(async ({ input, ctx }) => {
      const id = generateId("proj");
      const [project] = await ctx.db
        .insert(projects)
        .values({
          id,
          orgId: ctx.orgId,
          name: input.name,
          description: input.description ?? null,
          repoUrl: input.repoUrl ?? null,
          techStackPreset: input.techStackPreset ?? null,
          status: "setup",
        })
        .returning();

      // Create default settings
      await ctx.db.insert(projectSettings).values({
        projectId: id,
      });

      // Add creator as owner
      await ctx.db.insert(projectMembers).values({
        id: generateId("pm"),
        projectId: id,
        userId: ctx.auth.userId,
        role: "owner",
      });

      logger.info({ projectId: id, orgId: ctx.orgId }, "Project created");
      return project as NonNullable<typeof project>;
    }),

  // ─── Get Project ──────────────────────────────────────────────────────
  get: protectedProcedure
    .input(getProjectSchema)
    .query(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
        with: {
          settings: true,
          members: true,
          blueprints: {
            where: eq(blueprints.isActive, true),
            limit: 1,
          },
        },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      return project;
    }),

  // ─── List Projects (paginated) ────────────────────────────────────────
  list: protectedProcedure
    .input(listProjectsSchema)
    .query(async ({ input, ctx }) => {
      const conditions = [eq(projects.orgId, ctx.orgId)];

      if (input.status) {
        conditions.push(eq(projects.status, input.status));
      }

      if (input.cursor) {
        const cursorProject = await ctx.db.query.projects.findFirst({
          where: eq(projects.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cursorProject) {
          conditions.push(lt(projects.createdAt, cursorProject.createdAt));
        }
      }

      const results = await ctx.db.query.projects.findMany({
        where: and(...conditions),
        orderBy: [desc(projects.createdAt)],
        limit: input.limit + 1,
        with: { settings: true },
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        projects: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Update Project ───────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        data: updateProjectSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "contributor"
      );

      const [updated] = await ctx.db
        .update(projects)
        .set({ ...input.data, updatedAt: new Date() })
        .where(
          and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId))
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      logger.info({ projectId: input.projectId }, "Project updated");
      return updated;
    }),

  // ─── Archive (Soft Delete) ────────────────────────────────────────────
  delete: protectedProcedure
    .input(archiveProjectSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "owner"
      );

      const [updated] = await ctx.db
        .update(projects)
        .set({ status: "archived", updatedAt: new Date() })
        .where(
          and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId))
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      logger.info({ projectId: input.projectId }, "Project archived");
      return { success: true };
    }),

  // ─── Update Project Settings ──────────────────────────────────────────
  updateSettings: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        settings: updateProjectSettingsSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "contributor"
      );

      // Upsert settings
      const existing = await ctx.db.query.projectSettings.findFirst({
        where: eq(projectSettings.projectId, input.projectId),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(projectSettings)
          .set(input.settings)
          .where(eq(projectSettings.projectId, input.projectId))
          .returning();
        return updated as NonNullable<typeof updated>;
      }

      const [created] = await ctx.db
        .insert(projectSettings)
        .values({
          projectId: input.projectId,
          ...input.settings,
        })
        .returning();

      logger.info({ projectId: input.projectId }, "Project settings updated");
      return created as NonNullable<typeof created>;
    }),

  // ─── Add Team Member ──────────────────────────────────────────────────
  addMember: protectedProcedure
    .input(addProjectMemberSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "owner"
      );

      // Check if member already exists
      const existing = await ctx.db.query.projectMembers.findFirst({
        where: and(
          eq(projectMembers.projectId, input.projectId),
          eq(projectMembers.userId, input.userId)
        ),
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this project",
        });
      }

      const [member] = await ctx.db
        .insert(projectMembers)
        .values({
          id: generateId("pm"),
          projectId: input.projectId,
          userId: input.userId,
          role: input.role ?? "contributor",
        })
        .returning();

      logger.info(
        {
          projectId: input.projectId,
          addedUserId: input.userId,
          role: input.role,
        },
        "Project member added"
      );

      return member as NonNullable<typeof member>;
    }),

  // ─── Update Team Member Role ──────────────────────────────────────────
  updateMember: protectedProcedure
    .input(updateProjectMemberSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "owner"
      );

      // Prevent demoting yourself if you're the only owner
      if (input.userId === ctx.auth.userId && input.role !== "owner") {
        const owners = await ctx.db.query.projectMembers.findMany({
          where: and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.role, "owner")
          ),
        });
        if (owners.length <= 1) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Cannot demote the last owner of a project",
          });
        }
      }

      const [updated] = await ctx.db
        .update(projectMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, input.userId)
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project member not found",
        });
      }

      logger.info(
        {
          projectId: input.projectId,
          updatedUserId: input.userId,
          newRole: input.role,
        },
        "Project member role updated"
      );

      return updated;
    }),

  // ─── Remove Team Member ───────────────────────────────────────────────
  removeMember: protectedProcedure
    .input(removeProjectMemberSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "owner"
      );

      // Prevent removing yourself if you're the only owner
      if (input.userId === ctx.auth.userId) {
        const owners = await ctx.db.query.projectMembers.findMany({
          where: and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.role, "owner")
          ),
        });
        if (owners.length <= 1) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Cannot remove the last owner of a project",
          });
        }
      }

      const deleted = await ctx.db
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, input.userId)
          )
        )
        .returning();

      if (deleted.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project member not found",
        });
      }

      logger.info(
        {
          projectId: input.projectId,
          removedUserId: input.userId,
        },
        "Project member removed"
      );

      return { success: true };
    }),

  // ─── Get Current Blueprint ────────────────────────────────────────────
  getBlueprint: protectedProcedure
    .input(getProjectSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const blueprint = await ctx.db.query.blueprints.findFirst({
        where: and(
          eq(blueprints.projectId, input.projectId),
          eq(blueprints.isActive, true)
        ),
        with: {
          versions: { orderBy: [desc(blueprintVersions.createdAt)], limit: 5 },
        },
      });

      return blueprint ?? null;
    }),

  // ─── List Blueprint Versions ──────────────────────────────────────────
  listBlueprintVersions: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const conditions = [eq(blueprints.projectId, input.projectId)];

      if (input.cursor) {
        const cursorBlueprint = await ctx.db.query.blueprints.findFirst({
          where: eq(blueprints.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cursorBlueprint) {
          conditions.push(lt(blueprints.createdAt, cursorBlueprint.createdAt));
        }
      }

      const results = await ctx.db.query.blueprints.findMany({
        where: and(...conditions),
        orderBy: [desc(blueprints.createdAt)],
        limit: input.limit + 1,
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        blueprints: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Trigger File Index ───────────────────────────────────────────────
  triggerFileIndex: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        fullReindex: z.boolean().default(false),
        filePaths: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const _project = await verifyProjectAccess(
        ctx.db,
        input.projectId,
        ctx.orgId
      );
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "contributor"
      );

      await indexingQueue.add(
        "index-project",
        {
          projectId: input.projectId,
          orgId: ctx.orgId,
          filePaths: input.filePaths ?? [],
          fullReindex: input.fullReindex,
          triggeredBy: "manual",
        },
        {
          jobId: `index-${input.projectId}-${Date.now()}`,
        }
      );

      logger.info(
        {
          projectId: input.projectId,
          fullReindex: input.fullReindex,
        },
        "File index triggered"
      );

      return { success: true, message: "File indexing job queued" };
    }),

  // ─── Project Stats ────────────────────────────────────────────────────
  stats: protectedProcedure
    .input(getProjectSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Count sessions
      const [sessionCount] = await ctx.db
        .select({ count: count() })
        .from(sessions)
        .where(eq(sessions.projectId, input.projectId));

      // Count tasks
      const [taskCount] = await ctx.db
        .select({ count: count() })
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId));

      // Count active sessions
      const [activeSessionCount] = await ctx.db
        .select({ count: count() })
        .from(sessions)
        .where(
          and(
            eq(sessions.projectId, input.projectId),
            eq(sessions.status, "active")
          )
        );

      // Count running tasks
      const [runningTaskCount] = await ctx.db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(eq(tasks.projectId, input.projectId), eq(tasks.status, "running"))
        );

      // Sum credits consumed for tasks in this project
      const [creditsResult] = await ctx.db
        .select({
          creditsUsed: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
        })
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId));

      // Count members
      const [memberCount] = await ctx.db
        .select({ count: count() })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, input.projectId));

      return {
        totalSessions: Number(sessionCount?.count ?? 0),
        activeSessions: Number(activeSessionCount?.count ?? 0),
        totalTasks: Number(taskCount?.count ?? 0),
        runningTasks: Number(runningTaskCount?.count ?? 0),
        creditsUsed: Number(creditsResult?.creditsUsed ?? 0),
        memberCount: Number(memberCount?.count ?? 0),
      };
    }),

  // ─── List Tech Stack Presets ──────────────────────────────────────────
  listTechStackPresets: protectedProcedure.query(async ({ ctx }) => {
    const presets = await ctx.db.query.techStackPresets.findMany();
    return { presets };
  }),

  // ─── Select Tech Stack Preset ─────────────────────────────────────────
  selectTechStackPreset: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        presetSlug: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "contributor"
      );

      // Verify the preset exists
      const preset = await ctx.db.query.techStackPresets.findFirst({
        where: eq(techStackPresets.slug, input.presetSlug),
      });
      if (!preset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tech stack preset not found",
        });
      }

      const [updated] = await ctx.db
        .update(projects)
        .set({
          techStackPreset: input.presetSlug,
          updatedAt: new Date(),
        })
        .where(
          and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId))
        )
        .returning();

      logger.info(
        {
          projectId: input.projectId,
          preset: input.presetSlug,
        },
        "Tech stack preset selected"
      );

      return { project: updated as NonNullable<typeof updated>, preset };
    }),

  // ─── Search Project Files ──────────────────────────────────────────────
  search: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        query: z.string().min(1, "Search query is required").max(1000),
        fileTypes: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const res = await fetch(`${PROJECT_BRAIN_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: input.projectId,
          orgId: ctx.orgId,
          query: input.query,
          fileTypes: input.fileTypes ?? [],
          limit: input.limit,
        }),
      });

      if (!res.ok) {
        logger.error(
          { projectId: input.projectId, status: res.status },
          "Failed to search project files via project-brain"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search project files",
        });
      }

      const data = (await res.json()) as {
        results: Array<{
          filePath: string;
          content: string;
          score: number;
          lineStart: number;
          lineEnd: number;
        }>;
      };

      logger.info(
        {
          projectId: input.projectId,
          query: input.query,
          resultCount: data.results.length,
        },
        "Project file search completed"
      );
      return { results: data.results };
    }),
});
