import type { AuthContext } from "@prometheus/auth";
import { getAuthContext } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import { db, organizations, users } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";

const logger = createLogger("trpc:context");

export interface Context {
  /** Set when authenticated via API key instead of Clerk JWT */
  apiKeyId: string | null;
  auth: AuthContext | null;
  db: Database;
}

export interface ProtectedContext {
  apiKeyId: string | null;
  auth: AuthContext;
  db: Database;
  orgId: string;
}

/**
 * Resolve a Clerk org ID (from JWT) to our internal org ID.
 * Clerk JWTs contain org_id like "org_xxxxx" which is the Clerk-side ID.
 * We need to translate this to our internal org ID.
 *
 * If the orgId already matches an internal org (e.g. from dev auth bypass),
 * it is returned as-is.
 */
async function resolveOrgId(clerkOrgId: string): Promise<string | null> {
  // First check if it already matches an internal org (dev auth / seeded data)
  const directMatch = await db.query.organizations.findFirst({
    where: eq(organizations.id, clerkOrgId),
    columns: { id: true },
  });
  if (directMatch) {
    return directMatch.id;
  }

  // Look up by Clerk org ID
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
    columns: { id: true },
  });
  if (org) {
    return org.id;
  }

  logger.debug(
    { clerkOrgId },
    "Could not resolve Clerk org ID to internal org"
  );
  return null;
}

export async function createContext(
  opts: FetchCreateContextFnOptions
): Promise<Context> {
  const authHeader = opts.req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { auth: null, db, apiKeyId: null };
  }

  const token = authHeader.slice(7);

  // API keys start with "pk_live_" — they are handled by the api-key-auth
  // middleware which attaches auth to the Hono context.
  if (token.startsWith("pk_live_")) {
    return { auth: null, db, apiKeyId: null };
  }

  const auth = await getAuthContext(token);
  if (!auth) {
    return { auth: null, db, apiKeyId: null };
  }

  // Dev auth bypass uses user IDs directly (not Clerk IDs)
  const isDevAuth =
    process.env.DEV_AUTH_BYPASS === "true" && token.startsWith("dev_token_");
  if (isDevAuth) {
    return { auth, db, apiKeyId: null };
  }

  // Resolve Clerk org ID -> internal org ID
  if (auth.orgId) {
    const internalOrgId = await resolveOrgId(auth.orgId);
    if (internalOrgId) {
      auth.orgId = internalOrgId;
    }
    // If resolution fails, keep the original — it may be a personal workspace
  }

  // Auto-create or sync user record in DB.
  // Clerk webhook (clerk.ts) handles the full profile sync; this is a
  // fallback so that the user row exists before any query references it.
  const existing = await db.query.users.findFirst({
    where: eq(users.clerkId, auth.userId),
  });

  if (!existing) {
    // Try email fallback for seeded users
    const emailFallback = await db.query.users.findFirst({
      where: eq(users.email, `${auth.userId}@pending.clerk`),
    });

    if (emailFallback) {
      // Link seeded user to their Clerk account
      try {
        await db
          .update(users)
          .set({ clerkId: auth.userId })
          .where(eq(users.id, emailFallback.id));
      } catch (err) {
        logger.warn(
          { err },
          "User email-fallback linking failed (likely race)"
        );
      }
    } else {
      // Create new user with onConflictDoUpdate to sync profile data
      try {
        await db
          .insert(users)
          .values({
            id: generateId(),
            clerkId: auth.userId,
            email: `${auth.userId}@pending.clerk`,
            name: null,
            avatarUrl: null,
          })
          .onConflictDoUpdate({
            target: users.clerkId,
            set: {
              // Keep existing data — Clerk webhook will provide real profile
              updatedAt: new Date(),
            },
          });
      } catch (err) {
        logger.warn(
          { err },
          "User auto-creation fallback failed (likely race)"
        );
      }
    }

    // Verify user actually exists after creation attempt
    const verified = await db.query.users.findFirst({
      where: eq(users.clerkId, auth.userId),
      columns: { id: true },
    });
    if (!verified) {
      logger.error(
        { userId: auth.userId },
        "User record missing after auto-creation"
      );
    }
  }

  return { auth, db, apiKeyId: null };
}
