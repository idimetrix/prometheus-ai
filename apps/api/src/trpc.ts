import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getAuthContext } from "@prometheus/auth";
import type { AuthContext } from "@prometheus/auth";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export interface Context {
  auth: AuthContext | null;
}

export async function createContext(opts: FetchCreateContextFnOptions): Promise<Context> {
  const authHeader = opts.req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { auth: null };
  }

  const token = authHeader.slice(7);
  const auth = await getAuthContext(token);
  return { auth };
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
  return next({ ctx: { auth: ctx.auth } });
});
