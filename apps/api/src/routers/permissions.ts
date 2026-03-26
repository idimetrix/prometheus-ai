import type { Database } from "@prometheus/db";
import { agentPermissions, projectMembers, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("permissions-router");

// ---------------------------------------------------------------------------
// Default permissions
// ---------------------------------------------------------------------------

const DEFAULT_PERMISSIONS: Record<string, "allowed" | "ask" | "denied"> = {
  file_read: "allowed",
  file_write: "ask",
  file_delete: "ask",
  terminal: "ask",
  git_commit: "ask",
  git_push: "denied",
  git_create_pr: "ask",
  git_force_push: "denied",
  deployment: "denied",
  env_modify: "denied",
};

const TOOL_CATEGORIES: Record<string, string[]> = {
  "File Operations": ["file_read", "file_write", "file_delete"],
  Git: ["git_commit", "git_push", "git_create_pr", "git_force_push"],
  Terminal: ["terminal"],
  Deployment: ["deployment"],
  Integrations: ["env_modify"],
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  file_read: "Read files from the project repository",
  file_write: "Create or modify files in the project repository",
  file_delete: "Delete files from the project repository",
  terminal: "Execute terminal commands in the sandbox environment",
  git_commit: "Create git commits with changes",
  git_push: "Push commits to the remote repository",
  git_create_pr: "Create pull requests on the remote repository",
  git_force_push: "Force push to the remote repository (destructive)",
  deployment: "Deploy the application to production or staging",
  env_modify: "Modify environment variables and secrets",
};

const DANGEROUS_TOOLS = new Set([
  "git_push",
  "git_force_push",
  "deployment",
  "env_modify",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const permissionValueSchema = z.enum(["allowed", "ask", "denied"]);

const listPermissionsSchema = z.object({
  projectId: z.string().min(1),
});

const setPermissionSchema = z.object({
  projectId: z.string().min(1),
  toolName: z.string().min(1),
  permission: permissionValueSchema,
  conditions: z.record(z.string(), z.unknown()).optional(),
});

const resetPermissionsSchema = z.object({
  projectId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const permissionsRouter = router({
  /**
   * List all permissions for a project.
   * Returns the merged view: stored overrides on top of defaults.
   */
  list: protectedProcedure
    .input(listPermissionsSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const stored = await ctx.db.query.agentPermissions.findMany({
        where: and(
          eq(agentPermissions.projectId, input.projectId),
          eq(agentPermissions.orgId, ctx.orgId)
        ),
      });

      const storedMap = new Map(stored.map((p) => [p.toolName, p]));

      // Merge defaults with stored overrides
      const permissions = Object.entries(DEFAULT_PERMISSIONS).map(
        ([toolName, defaultPermission]) => {
          const override = storedMap.get(toolName);
          return {
            toolName,
            permission: override?.permission ?? defaultPermission,
            conditions: override?.conditions ?? null,
            isDefault: !override,
            isDangerous: DANGEROUS_TOOLS.has(toolName),
            description: TOOL_DESCRIPTIONS[toolName] ?? "",
            id: override?.id ?? null,
          };
        }
      );

      return {
        permissions,
        categories: TOOL_CATEGORIES,
      };
    }),

  /**
   * Set the permission for a specific tool on a project.
   */
  set: protectedProcedure
    .input(setPermissionSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "contributor"
      );

      // Validate tool name
      if (!(input.toolName in DEFAULT_PERMISSIONS)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown tool name: ${input.toolName}`,
        });
      }

      // Check if a permission already exists for this tool
      const existing = await ctx.db.query.agentPermissions.findFirst({
        where: and(
          eq(agentPermissions.projectId, input.projectId),
          eq(agentPermissions.orgId, ctx.orgId),
          eq(agentPermissions.toolName, input.toolName)
        ),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(agentPermissions)
          .set({
            permission: input.permission,
            conditions: input.conditions ?? null,
            updatedAt: new Date(),
          })
          .where(eq(agentPermissions.id, existing.id))
          .returning();

        logger.info(
          {
            projectId: input.projectId,
            toolName: input.toolName,
            permission: input.permission,
          },
          "Agent permission updated"
        );

        return updated as NonNullable<typeof updated>;
      }

      const [created] = await ctx.db
        .insert(agentPermissions)
        .values({
          id: generateId("aperm"),
          projectId: input.projectId,
          orgId: ctx.orgId,
          toolName: input.toolName,
          permission: input.permission,
          conditions: input.conditions ?? null,
          createdBy: ctx.auth.userId,
        })
        .returning();

      logger.info(
        {
          projectId: input.projectId,
          toolName: input.toolName,
          permission: input.permission,
        },
        "Agent permission created"
      );

      return created as NonNullable<typeof created>;
    }),

  /**
   * Reset all permissions for a project back to defaults.
   */
  reset: protectedProcedure
    .input(resetPermissionsSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);
      await verifyProjectRole(
        ctx.db,
        input.projectId,
        ctx.auth.userId,
        "owner"
      );

      await ctx.db
        .delete(agentPermissions)
        .where(
          and(
            eq(agentPermissions.projectId, input.projectId),
            eq(agentPermissions.orgId, ctx.orgId)
          )
        );

      logger.info(
        { projectId: input.projectId },
        "Agent permissions reset to defaults"
      );

      return { success: true };
    }),

  /**
   * Get the default permission set.
   */
  getDefaults: protectedProcedure.query(() => {
    const defaults = Object.entries(DEFAULT_PERMISSIONS).map(
      ([toolName, permission]) => ({
        toolName,
        permission,
        isDangerous: DANGEROUS_TOOLS.has(toolName),
        description: TOOL_DESCRIPTIONS[toolName] ?? "",
      })
    );

    return {
      defaults,
      categories: TOOL_CATEGORIES,
    };
  }),
});
