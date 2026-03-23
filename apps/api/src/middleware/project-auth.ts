import { db, projectMembers, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:project-auth");

// ---------------------------------------------------------------------------
// Project-level roles: owner > contributor > viewer
// ---------------------------------------------------------------------------
export type ProjectRole = "owner" | "contributor" | "viewer";

const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  contributor: 1,
  owner: 2,
};

/**
 * Returns true if the user's project role meets or exceeds the required role.
 */
export function hasProjectRole(
  userRole: string,
  requiredRole: ProjectRole
): boolean {
  const userRank = ROLE_RANK[userRole as ProjectRole] ?? -1;
  const requiredRank = ROLE_RANK[requiredRole];
  return userRank >= requiredRank;
}

/**
 * Hono middleware factory that checks project membership and role.
 *
 * Expects:
 *   - `c.get("userId")` to be set by upstream auth middleware
 *   - `c.get("orgId")` to be set by upstream org-context middleware
 *   - Project ID extracted from the request path or query params
 *
 * @param requiredRole Minimum project role needed to proceed.
 * @param projectIdExtractor Optional function to extract projectId from the
 *   request. Defaults to reading `:projectId` path param.
 */
export function requireProjectRole(
  requiredRole: ProjectRole,
  projectIdExtractor?: (c: Context) => string | undefined
): MiddlewareHandler {
  return async (c: Context, next) => {
    const userId = c.get("userId") as string | undefined;
    const orgId = c.get("orgId") as string | undefined;

    if (!(userId && orgId)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const projectId = projectIdExtractor
      ? projectIdExtractor(c)
      : c.req.param("projectId");

    if (!projectId) {
      return c.json({ error: "Project ID is required" }, 400);
    }

    // Verify the project belongs to the org
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
      columns: { id: true },
    });

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Check the user's membership and role
    const member = await db.query.projectMembers.findFirst({
      where: and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId)
      ),
    });

    if (!member) {
      logger.warn({ userId, projectId }, "Project access denied: not a member");
      return c.json({ error: "You are not a member of this project" }, 403);
    }

    if (!hasProjectRole(member.role, requiredRole)) {
      logger.warn(
        { userId, projectId, userRole: member.role, requiredRole },
        "Project access denied: insufficient role"
      );
      return c.json(
        { error: `This action requires at least '${requiredRole}' role` },
        403
      );
    }

    // Attach project context for downstream handlers
    c.set("projectId", projectId);
    c.set("projectRole", member.role);

    await next();
  };
}

/**
 * tRPC-compatible helper to verify project role inside a tRPC procedure.
 * Throws TRPCError if access is denied.
 *
 * Usage inside a procedure:
 * ```ts
 * const member = await verifyProjectMembership(ctx.db, projectId, ctx.auth.userId, "contributor");
 * ```
 */
export async function verifyProjectMembership(
  dbInstance: typeof db,
  projectId: string,
  userId: string,
  requiredRole: ProjectRole
): Promise<{ id: string; role: string }> {
  const member = await dbInstance.query.projectMembers.findFirst({
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

  if (!hasProjectRole(member.role, requiredRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This action requires at least '${requiredRole}' role`,
    });
  }

  return member;
}
