import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getAuthContext } from "@prometheus/auth";
import type { AuthContext } from "@prometheus/auth";
import { db } from "@prometheus/db";
import type { Database } from "@prometheus/db";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export interface Context {
  auth: AuthContext | null;
  db: Database;
}

export interface ProtectedContext {
  auth: AuthContext;
  db: Database;
  orgId: string;
}

export async function createContext(opts: FetchCreateContextFnOptions): Promise<Context> {
  const authHeader = opts.req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { auth: null, db };
  }

  const token = authHeader.slice(7);
  const auth = await getAuthContext(token);
  return { auth, db };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!ctx.auth.orgId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization context required" });
  }
  return next({
    ctx: {
      auth: ctx.auth,
      db: ctx.db,
      orgId: ctx.auth.orgId,
    } satisfies ProtectedContext,
  });
});
