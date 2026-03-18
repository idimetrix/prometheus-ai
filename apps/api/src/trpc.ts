import type { AuthContext } from "@prometheus/auth";
import { getAuthContext, hasOrgRole } from "@prometheus/auth";
import type { Database } from "@prometheus/db";
import { db, users } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import superjson from "superjson";
import { ZodError } from "zod";

const logger = createLogger("trpc");

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
  // middleware which attaches auth to the Hono context. The tRPC context
  // factory will read those values from c.get() when wired up. For now,
  // attempt Clerk JWT verification.
  if (token.startsWith("pk_live_")) {
    // API key auth is handled by Hono middleware; return null here and let
    // the middleware-injected context take over.
    return { auth: null, db, apiKeyId: null };
  }

  const auth = await getAuthContext(token);
  if (!auth) {
    return { auth: null, db, apiKeyId: null };
  }

  // Auto-create user record in DB if it doesn't exist yet.
  // Clerk webhook (clerk.ts) handles the full profile sync; this is a
  // fallback so that the user row exists before any query references it.
  const existing = await db.query.users.findFirst({
    where: eq(users.clerkId, auth.userId),
  });

  if (!existing) {
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
        .onConflictDoNothing();
    } catch (err) {
      // Race condition: another request may have created the row.
      logger.warn({ err }, "User auto-creation fallback failed (likely race)");
    }
  }

  return { auth, db, apiKeyId: null };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

const requestLogger = t.middleware(async ({ ctx, type, path, next }) => {
  const start = performance.now();
  const result = await next();
  const duration = performance.now() - start;

  if (type === "mutation" || duration > 500) {
    logger.info(
      {
        type,
        path,
        userId: ctx.auth?.userId,
        duration: Math.round(duration),
      },
      "tRPC request"
    );
  }
  return result;
});

const sanitizeErrors = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    logger.error({ error }, "Unhandled tRPC error");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : (error as Error).message,
    });
  }
});

export const router = t.router;
export const publicProcedure = t.procedure
  .use(requestLogger)
  .use(sanitizeErrors);

export const protectedProcedure = t.procedure
  .use(requestLogger)
  .use(sanitizeErrors)
  .use(async ({ ctx, next }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (!ctx.auth.orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization context required",
      });
    }
    return await next({
      ctx: {
        auth: ctx.auth,
        db: ctx.db,
        orgId: ctx.auth.orgId,
        apiKeyId: ctx.apiKeyId,
      } satisfies ProtectedContext,
    });
  });

/**
 * Procedure that requires a minimum org role.
 * Usage: `orgAdminProcedure` requires at least "admin" role.
 */
export const orgAdminProcedure = t.procedure
  .use(requestLogger)
  .use(sanitizeErrors)
  .use(async ({ ctx, next }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (!ctx.auth.orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization context required",
      });
    }
    if (!hasOrgRole(ctx.auth.orgRole, "admin")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admin or owner role required",
      });
    }
    return await next({
      ctx: {
        auth: ctx.auth,
        db: ctx.db,
        orgId: ctx.auth.orgId,
        apiKeyId: ctx.apiKeyId,
      } satisfies ProtectedContext,
    });
  });

export const orgOwnerProcedure = t.procedure
  .use(requestLogger)
  .use(sanitizeErrors)
  .use(async ({ ctx, next }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (!ctx.auth.orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization context required",
      });
    }
    if (!hasOrgRole(ctx.auth.orgRole, "owner")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Owner role required",
      });
    }
    return await next({
      ctx: {
        auth: ctx.auth,
        db: ctx.db,
        orgId: ctx.auth.orgId,
        apiKeyId: ctx.apiKeyId,
      } satisfies ProtectedContext,
    });
  });
