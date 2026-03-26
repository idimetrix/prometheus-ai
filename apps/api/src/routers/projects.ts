import { getInternalAuthHeaders } from "@prometheus/auth";
import {
  generateScaffoldBlueprint,
  listScaffoldTemplates,
} from "@prometheus/config-stacks";
import type { Database } from "@prometheus/db";
import {
  blueprints,
  blueprintVersions,
  projectMembers,
  projectRepositories,
  projectRules,
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
  addProjectRepoSchema,
  archiveProjectSchema,
  createProjectSchema,
  createRuleSchema,
  deleteRuleSchema,
  forkProjectSchema,
  getProjectSchema,
  importRulesFromFileSchema,
  listProjectReposSchema,
  listProjectsSchema,
  listRulesSchema,
  reindexProjectRepoSchema,
  removeProjectMemberSchema,
  removeProjectRepoSchema,
  rulesFileSchema,
  scaffoldProjectSchema,
  setDefaultRepoSchema,
  shareProjectSchema,
  unshareProjectSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
  updateProjectSettingsSchema,
  updateRuleSchema,
} from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("projects-router");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

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
      await ctx.db.insert(projectSettings).values({ projectId: id });
      await ctx.db.insert(projectMembers).values({
        id: generateId("pm"),
        projectId: id,
        userId: ctx.auth.userId,
        role: "owner",
      });
      if (input.repoUrl) {
        await indexingQueue.add(
          "index-project",
          {
            projectId: id,
            orgId: ctx.orgId,
            filePaths: [],
            fullReindex: true,
            triggeredBy: "manual",
          },
          { jobId: `index-${id}-init` }
        );
        logger.info(
          { projectId: id, repoUrl: input.repoUrl },
          "Repo clone/index job enqueued"
        );
      }
      logger.info({ projectId: id, orgId: ctx.orgId }, "Project created");
      return project as NonNullable<typeof project>;
    }),

  scaffold: protectedProcedure
    .input(scaffoldProjectSchema)
    .mutation(async ({ input, ctx }) => {
      const id = generateId("proj");

      let scaffoldedFiles: Array<{ content: string; path: string }> | null =
        null;
      let scaffoldMode: "prompt" | "template" = "template";

      if (input.template) {
        const blueprint = generateScaffoldBlueprint(input.template, input.name);
        if (!blueprint) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Unknown template: ${input.template}. Use projects.listTemplates to see available templates.`,
          });
        }
        scaffoldedFiles = Object.entries(blueprint.files).map(
          ([path, content]) => ({
            path,
            content: String(content),
          })
        );
      } else {
        scaffoldMode = "prompt";
      }

      const [project] = await ctx.db
        .insert(projects)
        .values({
          id,
          orgId: ctx.orgId,
          name: input.name,
          description: input.description ?? null,
          techStackPreset: input.template ?? null,
          status: "setup",
        })
        .returning();

      await ctx.db.insert(projectSettings).values({ projectId: id });
      await ctx.db.insert(projectMembers).values({
        id: generateId("pm"),
        projectId: id,
        userId: ctx.auth.userId,
        role: "owner",
      });

      logger.info(
        {
          projectId: id,
          orgId: ctx.orgId,
          template: input.template,
          scaffoldMode,
          fileCount: scaffoldedFiles?.length ?? 0,
        },
        "Project scaffolded"
      );

      return {
        project: project as NonNullable<typeof project>,
        scaffoldMode,
        scaffoldedFiles,
      };
    }),

  listTemplates: protectedProcedure.query(() => {
    const templates = listScaffoldTemplates();
    return {
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        languages: t.languages,
      })),
    };
  }),

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
          blueprints: { where: eq(blueprints.isActive, true), limit: 1 },
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
      return { projects: items, nextCursor: hasMore ? items.at(-1)?.id : null };
    }),

  update: protectedProcedure
    .input(
      z.object({ projectId: z.string().min(1), data: updateProjectSchema })
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
        .values({ projectId: input.projectId, ...input.settings })
        .returning();
      logger.info({ projectId: input.projectId }, "Project settings updated");
      return created as NonNullable<typeof created>;
    }),

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
        { projectId: input.projectId, removedUserId: input.userId },
        "Project member removed"
      );
      return { success: true };
    }),

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
        const cb = await ctx.db.query.blueprints.findFirst({
          where: eq(blueprints.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cb) {
          conditions.push(lt(blueprints.createdAt, cb.createdAt));
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
        { jobId: `index-${input.projectId}-${Date.now()}` }
      );
      logger.info(
        { projectId: input.projectId, fullReindex: input.fullReindex },
        "File index triggered"
      );
      return { success: true, message: "File indexing job queued" };
    }),

  stats: protectedProcedure
    .input(getProjectSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      const [sessionCount] = await ctx.db
        .select({ count: count() })
        .from(sessions)
        .where(eq(sessions.projectId, input.projectId));
      const [taskCount] = await ctx.db
        .select({ count: count() })
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId));
      const [activeSessionCount] = await ctx.db
        .select({ count: count() })
        .from(sessions)
        .where(
          and(
            eq(sessions.projectId, input.projectId),
            eq(sessions.status, "active")
          )
        );
      const [runningTaskCount] = await ctx.db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(eq(tasks.projectId, input.projectId), eq(tasks.status, "running"))
        );
      const [creditsResult] = await ctx.db
        .select({
          creditsUsed: sql<number>`COALESCE(SUM(${tasks.creditsConsumed}), 0)`,
        })
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId));
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

  listTechStackPresets: protectedProcedure.query(async ({ ctx }) => {
    return { presets: await ctx.db.query.techStackPresets.findMany() };
  }),

  selectTechStackPreset: protectedProcedure
    .input(
      z.object({ projectId: z.string().min(1), presetSlug: z.string().min(1) })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "contributor"
      );
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
        .set({ techStackPreset: input.presetSlug, updatedAt: new Date() })
        .where(
          and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId))
        )
        .returning();
      logger.info(
        { projectId: input.projectId, preset: input.presetSlug },
        "Tech stack preset selected"
      );
      return { project: updated as NonNullable<typeof updated>, preset };
    }),

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
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
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

  rules: router({
    list: protectedProcedure
      .input(listRulesSchema)
      .query(async ({ input, ctx }) => {
        await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
        const conditions = [
          eq(projectRules.projectId, input.projectId),
          eq(projectRules.orgId, ctx.orgId),
        ];
        if (input.type) {
          conditions.push(eq(projectRules.type, input.type));
        }
        const rules = await ctx.db.query.projectRules.findMany({
          where: and(...conditions),
          orderBy: [desc(projectRules.createdAt)],
        });
        return { rules };
      }),

    create: protectedProcedure
      .input(createRuleSchema)
      .mutation(async ({ input, ctx }) => {
        await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
        await verifyProjectRole(
          ctx.db,
          input.projectId,
          ctx.auth.userId,
          "contributor"
        );
        const id = generateId("rule");
        const [rule] = await ctx.db
          .insert(projectRules)
          .values({
            id,
            projectId: input.projectId,
            orgId: ctx.orgId,
            type: input.type,
            rule: input.rule,
            source: input.source ?? "manual",
            enabled: input.enabled ?? true,
          })
          .returning();
        logger.info(
          { ruleId: id, projectId: input.projectId },
          "Project rule created"
        );
        return rule as NonNullable<typeof rule>;
      }),

    update: protectedProcedure
      .input(updateRuleSchema)
      .mutation(async ({ input, ctx }) => {
        const existing = await ctx.db.query.projectRules.findFirst({
          where: and(
            eq(projectRules.id, input.ruleId),
            eq(projectRules.orgId, ctx.orgId)
          ),
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
        }
        await verifyProjectRole(
          ctx.db,
          existing.projectId,
          ctx.auth.userId,
          "contributor"
        );
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (input.type !== undefined) {
          updateData.type = input.type;
        }
        if (input.rule !== undefined) {
          updateData.rule = input.rule;
        }
        if (input.enabled !== undefined) {
          updateData.enabled = input.enabled;
        }
        const [updated] = await ctx.db
          .update(projectRules)
          .set(updateData)
          .where(
            and(
              eq(projectRules.id, input.ruleId),
              eq(projectRules.orgId, ctx.orgId)
            )
          )
          .returning();
        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
        }
        logger.info({ ruleId: input.ruleId }, "Project rule updated");
        return updated;
      }),

    delete: protectedProcedure
      .input(deleteRuleSchema)
      .mutation(async ({ input, ctx }) => {
        const existing = await ctx.db.query.projectRules.findFirst({
          where: and(
            eq(projectRules.id, input.ruleId),
            eq(projectRules.orgId, ctx.orgId)
          ),
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
        }
        await verifyProjectRole(
          ctx.db,
          existing.projectId,
          ctx.auth.userId,
          "contributor"
        );
        await ctx.db
          .delete(projectRules)
          .where(
            and(
              eq(projectRules.id, input.ruleId),
              eq(projectRules.orgId, ctx.orgId)
            )
          );
        logger.info({ ruleId: input.ruleId }, "Project rule deleted");
        return { success: true };
      }),

    importFromFile: protectedProcedure
      .input(importRulesFromFileSchema)
      .mutation(async ({ input, ctx }) => {
        await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
        await verifyProjectRole(
          ctx.db,
          input.projectId,
          ctx.auth.userId,
          "contributor"
        );
        let parsed: {
          rules: Array<{ type: string; rule: string; enabled: boolean }>;
        };
        try {
          parsed = rulesFileSchema.parse(JSON.parse(input.content));
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Invalid rules file format. Expected JSON with { rules: [{ type, rule, enabled }] }",
          });
        }
        const created: (typeof projectRules.$inferSelect)[] = [];
        for (const entry of parsed.rules) {
          const id = generateId("rule");
          const [rule] = await ctx.db
            .insert(projectRules)
            .values({
              id,
              projectId: input.projectId,
              orgId: ctx.orgId,
              type: entry.type as
                | "code_style"
                | "architecture"
                | "testing"
                | "review"
                | "prompt"
                | "security",
              rule: entry.rule,
              source: "file",
              enabled: entry.enabled,
            })
            .returning();
          if (rule) {
            created.push(rule);
          }
        }
        logger.info(
          { projectId: input.projectId, importedCount: created.length },
          "Rules imported from file"
        );
        return { rules: created, importedCount: created.length };
      }),
  }),

  share: protectedProcedure
    .input(shareProjectSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "owner"
      );
      const slug =
        input.slug ??
        `${input.projectId.slice(0, 8)}-${Date.now().toString(36)}`;
      // Check slug uniqueness
      const existing = await ctx.db.query.projects.findFirst({
        where: eq(projects.shareSlug, slug),
        columns: { id: true },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Share slug is already taken. Choose a different slug.",
        });
      }
      const [updated] = await ctx.db
        .update(projects)
        .set({ shareSlug: slug, isPublic: true, updatedAt: new Date() })
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
      logger.info(
        { projectId: input.projectId, slug },
        "Project shared publicly"
      );
      return { slug: updated.shareSlug, isPublic: true };
    }),

  unshare: protectedProcedure
    .input(unshareProjectSchema)
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
        .set({
          shareSlug: null,
          isPublic: false,
          updatedAt: new Date(),
        })
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
      logger.info({ projectId: input.projectId }, "Project unshared");
      return { success: true };
    }),

  fork: protectedProcedure
    .input(forkProjectSchema)
    .mutation(async ({ input, ctx }) => {
      // The source project must be public (no org check needed)
      const source = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.isPublic, true)
        ),
        with: { settings: true },
      });
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Public project not found",
        });
      }
      const forkName = input.name ?? `${source.name} (fork)`;
      const forkId = generateId("proj");
      const [forked] = await ctx.db
        .insert(projects)
        .values({
          id: forkId,
          orgId: ctx.orgId,
          name: forkName,
          description: source.description,
          repoUrl: source.repoUrl,
          techStackPreset: source.techStackPreset,
          status: "setup",
          forkedFromId: source.id,
        })
        .returning();
      // Copy settings
      if (source.settings) {
        await ctx.db.insert(projectSettings).values({
          projectId: forkId,
          agentAggressiveness: source.settings.agentAggressiveness,
          ciLoopMaxIterations: source.settings.ciLoopMaxIterations,
          parallelAgentCount: source.settings.parallelAgentCount,
          blueprintEnforcement: source.settings.blueprintEnforcement,
          testCoverageTarget: source.settings.testCoverageTarget,
          securityScanLevel: source.settings.securityScanLevel,
          deployTarget: source.settings.deployTarget,
          modelCostBudget: source.settings.modelCostBudget,
        });
      } else {
        await ctx.db.insert(projectSettings).values({ projectId: forkId });
      }
      // Add forker as owner
      await ctx.db.insert(projectMembers).values({
        id: generateId("pm"),
        projectId: forkId,
        userId: ctx.auth.userId,
        role: "owner",
      });
      // Increment fork count on source
      await ctx.db
        .update(projects)
        .set({ forkCount: sql`${projects.forkCount} + 1` })
        .where(eq(projects.id, source.id));
      logger.info(
        { forkId, sourceId: source.id, orgId: ctx.orgId },
        "Project forked"
      );
      return forked as NonNullable<typeof forked>;
    }),

  repos: router({
    list: protectedProcedure
      .input(listProjectReposSchema)
      .query(async ({ input, ctx }) => {
        await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
        const repos = await ctx.db.query.projectRepositories.findMany({
          where: and(
            eq(projectRepositories.projectId, input.projectId),
            eq(projectRepositories.orgId, ctx.orgId)
          ),
          orderBy: [
            desc(projectRepositories.isPrimary),
            desc(projectRepositories.createdAt),
          ],
        });
        return { repos };
      }),

    add: protectedProcedure
      .input(addProjectRepoSchema)
      .mutation(async ({ input, ctx }) => {
        await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
        await verifyProjectRole(
          ctx.db,
          input.projectId,
          ctx.auth.userId,
          "contributor"
        );

        const existing = await ctx.db.query.projectRepositories.findMany({
          where: eq(projectRepositories.projectId, input.projectId),
        });
        const isPrimary = existing.length === 0;

        const id = generateId("prepo");
        const [repo] = await ctx.db
          .insert(projectRepositories)
          .values({
            id,
            projectId: input.projectId,
            orgId: ctx.orgId,
            repoUrl: input.repoUrl,
            provider: input.provider,
            defaultBranch: input.defaultBranch,
            isMonorepo: input.isMonorepo,
            workspaceType: input.workspaceType ?? null,
            rootPath: input.rootPath,
            isPrimary,
          })
          .returning();

        await indexingQueue.add(
          "index-project",
          {
            projectId: input.projectId,
            orgId: ctx.orgId,
            filePaths: [],
            fullReindex: true,
            triggeredBy: "manual",
          },
          { jobId: `index-${id}-init` }
        );

        logger.info(
          { repoId: id, projectId: input.projectId, repoUrl: input.repoUrl },
          "Repository added to project"
        );
        return repo as NonNullable<typeof repo>;
      }),

    remove: protectedProcedure
      .input(removeProjectRepoSchema)
      .mutation(async ({ input, ctx }) => {
        await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
        await verifyProjectRole(
          ctx.db,
          input.projectId,
          ctx.auth.userId,
          "contributor"
        );

        const deleted = await ctx.db
          .delete(projectRepositories)
          .where(
            and(
              eq(projectRepositories.id, input.repoId),
              eq(projectRepositories.projectId, input.projectId),
              eq(projectRepositories.orgId, ctx.orgId)
            )
          )
          .returning();

        if (deleted.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Repository not found",
          });
        }

        logger.info(
          { repoId: input.repoId, projectId: input.projectId },
          "Repository removed from project"
        );
        return { success: true };
      }),

    reindex: protectedProcedure
      .input(reindexProjectRepoSchema)
      .mutation(async ({ input, ctx }) => {
        await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
        await verifyProjectRole(
          ctx.db,
          input.projectId,
          ctx.auth.userId,
          "contributor"
        );

        const repo = await ctx.db.query.projectRepositories.findFirst({
          where: and(
            eq(projectRepositories.id, input.repoId),
            eq(projectRepositories.projectId, input.projectId)
          ),
        });

        if (!repo) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Repository not found",
          });
        }

        await ctx.db
          .update(projectRepositories)
          .set({ indexStatus: "pending", updatedAt: new Date() })
          .where(eq(projectRepositories.id, input.repoId));

        await indexingQueue.add(
          "index-project",
          {
            projectId: input.projectId,
            orgId: ctx.orgId,
            filePaths: [],
            fullReindex: true,
            triggeredBy: "manual",
          },
          { jobId: `reindex-${input.repoId}-${Date.now()}` }
        );

        logger.info(
          { repoId: input.repoId, projectId: input.projectId },
          "Repository reindex triggered"
        );
        return { success: true };
      }),

    setDefault: protectedProcedure
      .input(setDefaultRepoSchema)
      .mutation(async ({ input, ctx }) => {
        await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
        await verifyProjectRole(
          ctx.db,
          input.projectId,
          ctx.auth.userId,
          "contributor"
        );

        const repo = await ctx.db.query.projectRepositories.findFirst({
          where: and(
            eq(projectRepositories.id, input.repoId),
            eq(projectRepositories.projectId, input.projectId)
          ),
        });

        if (!repo) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Repository not found",
          });
        }

        await ctx.db
          .update(projectRepositories)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(eq(projectRepositories.projectId, input.projectId));

        const [updated] = await ctx.db
          .update(projectRepositories)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(eq(projectRepositories.id, input.repoId))
          .returning();

        logger.info(
          { repoId: input.repoId, projectId: input.projectId },
          "Default repository set"
        );
        return updated as NonNullable<typeof updated>;
      }),
  }),
});
