import { getAuthContext } from "@prometheus/auth";
import { db, organizations } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:org-context");

/**
 * Middleware that extracts the Clerk JWT from the Authorization header,
 * resolves the org's plan tier from the database, and sets `orgId` and
 * `planTier` on the Hono context for downstream middleware (e.g. rate limiter).
 *
 * This is intentionally lightweight – it does NOT reject unauthenticated
 * requests so that public routes (health, webhooks) still work.
 */
export function orgContextMiddleware(): MiddlewareHandler {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: auth resolution requires multiple fallback paths
  return async (c: Context, next) => {
    const authHeader = c.req.header("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;

    if (token) {
      try {
        const auth = await getAuthContext(token);
        if (auth?.orgId) {
          // Try direct match first, then look up by Clerk org ID
          let org = await db
            .select({
              id: organizations.id,
              planTier: organizations.planTier,
            })
            .from(organizations)
            .where(eq(organizations.id, auth.orgId))
            .limit(1)
            .then((rows) => rows[0] ?? null);

          if (!org) {
            org = await db
              .select({
                id: organizations.id,
                planTier: organizations.planTier,
              })
              .from(organizations)
              .where(eq(organizations.clerkOrgId, auth.orgId))
              .limit(1)
              .then((rows) => rows[0] ?? null);
          }

          if (org) {
            c.set("orgId", org.id);
            c.set("planTier", org.planTier);
          } else {
            // Fall back to setting the raw orgId for personal workspace
            c.set("orgId", auth.orgId);
          }

          if (auth.orgRole) {
            c.set("orgRole", auth.orgRole);
          }
        }
      } catch (err) {
        logger.debug(
          { error: (err as Error).message },
          "org-context: failed to resolve auth"
        );
      }
    }

    await next();
  };
}
