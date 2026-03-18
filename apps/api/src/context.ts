import type { AuthContext } from "@prometheus/auth";
import { getAuthContext } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import { db, users } from "@prometheus/db";
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
  }

  return { auth, db, apiKeyId: null };
}
