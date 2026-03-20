import { createLogger } from "@prometheus/logger";
import type { MiddlewareHandler } from "hono";

const logger = createLogger("api:rbac");

export function rbacMiddleware(
  resource: string,
  action: string
): MiddlewareHandler {
  return async (c, next) => {
    const userId = c.get("userId") as string | undefined;
    const orgId = c.get("orgId") as string | undefined;
    const orgRole = c.get("orgRole") as string | undefined;

    if (!(userId && orgId)) {
      return c.json({ error: "Authentication required" }, 401);
    }

    // Permission hierarchy: owner > admin > member > viewer
    const ROLE_HIERARCHY: Record<string, number> = {
      viewer: 1,
      member: 2,
      admin: 3,
      owner: 4,
    };

    const ACTION_REQUIRED_LEVEL: Record<string, number> = {
      read: 1,
      write: 2,
      delete: 3,
      manage: 3,
      admin: 4,
    };

    const userLevel = ROLE_HIERARCHY[orgRole ?? "viewer"] ?? 1;
    const requiredLevel = ACTION_REQUIRED_LEVEL[action] ?? 2;

    if (userLevel < requiredLevel) {
      logger.warn({ userId, orgId, resource, action, orgRole }, "RBAC denied");
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    await next();
  };
}
