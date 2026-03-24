import { hasOrgRole } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Context, ProtectedContext } from "./context";

export type { Context, ProtectedContext } from "./context";
export { createContext } from "./context";

const logger = createLogger("trpc");

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
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }
    // Use orgId if available, otherwise fall back to userId as personal workspace
    const orgId = ctx.auth.orgId ?? ctx.auth.userId;
    if (!orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization or user context required",
      });
    }
    return await next({
      ctx: {
        auth: ctx.auth,
        db: ctx.db,
        orgId,
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
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }
    const orgId = ctx.auth.orgId ?? ctx.auth.userId;
    if (!orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization or user context required",
      });
    }
    // For personal workspaces (no org), treat user as admin
    if (ctx.auth.orgId && !hasOrgRole(ctx.auth.orgRole, "admin")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admin or owner role required",
      });
    }
    return await next({
      ctx: {
        auth: ctx.auth,
        db: ctx.db,
        orgId,
        apiKeyId: ctx.apiKeyId,
      } satisfies ProtectedContext,
    });
  });

export const orgOwnerProcedure = t.procedure
  .use(requestLogger)
  .use(sanitizeErrors)
  .use(async ({ ctx, next }) => {
    if (!ctx.auth) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }
    const orgId = ctx.auth.orgId ?? ctx.auth.userId;
    if (!orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization or user context required",
      });
    }
    // For personal workspaces (no org), treat user as owner
    if (ctx.auth.orgId && !hasOrgRole(ctx.auth.orgRole, "owner")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Owner role required",
      });
    }
    return await next({
      ctx: {
        auth: ctx.auth,
        db: ctx.db,
        orgId,
        apiKeyId: ctx.apiKeyId,
      } satisfies ProtectedContext,
    });
  });
