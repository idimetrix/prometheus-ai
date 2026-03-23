---
name: trpc-hono-patterns
description: tRPC v11 + Hono router patterns, Zod validation, middleware chain, SuperJSON serialization in Prometheus
user-invocable: false
---

# tRPC + Hono API Patterns

## Architecture

- **Hono** serves as the HTTP framework (`apps/api/src/index.ts`)
- **tRPC** is mounted at `/trpc/*` via `@hono/trpc-server`
- **SuperJSON** handles serialization (dates, Maps, Sets preserved)
- **Clerk** provides auth via Bearer token in Authorization header

## Entry Point (`apps/api/src/index.ts`)

```typescript
import { trpcServer } from "@hono/trpc-server";
app.use("/trpc/*", trpcServer({
  router: appRouter,
  createContext,
}));
```

Additional Hono routes (not tRPC):
- `GET /health` — health check
- `POST /api/sse` — server-sent events
- `POST /webhooks/stripe` — Stripe webhooks
- `POST /webhooks/clerk` — Clerk webhooks

## Context & Middleware

### Public procedure (no auth required)
```typescript
import { publicProcedure } from "../trpc";
```

### Protected procedure (auth + orgId required)
```typescript
import { protectedProcedure } from "../trpc";

// ctx automatically includes:
// - ctx.auth: AuthContext (userId, orgId, etc.)
// - ctx.db: Database instance
// - ctx.orgId: string (guaranteed non-null)
```

The `protectedProcedure` middleware:
1. Checks `ctx.auth` exists → throws `UNAUTHORIZED` if not
2. Checks `ctx.auth.orgId` exists → throws `FORBIDDEN` if not
3. Passes `ProtectedContext` with guaranteed `auth`, `db`, `orgId`

## Router Pattern

Routers live in `apps/api/src/routers/` and are composed in `routers/index.ts`:

```typescript
// apps/api/src/routers/my-feature.ts
import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { eq } from "drizzle-orm";
import * as schema from "@prometheus/db/schema";

export const myFeatureRouter = router({
  list: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(schema.myTable)
        .where(eq(schema.myTable.orgId, ctx.orgId));  // ALWAYS filter by orgId
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .insert(schema.myTable)
        .values({
          orgId: ctx.orgId,  // ALWAYS set orgId
          name: input.name,
        })
        .returning();
      return result;
    }),
});
```

### Register the router:
```typescript
// apps/api/src/routers/index.ts
import { myFeatureRouter } from "./my-feature";

export const appRouter = router({
  // ... existing routers
  myFeature: myFeatureRouter,
});
```

## Input Validation

- Use Zod schemas from `@prometheus/validators` for shared schemas
- Define inline Zod schemas for route-specific inputs
- Never trust client input — always validate with `.input()`

## Error Handling

```typescript
import { TRPCError } from "@trpc/server";

throw new TRPCError({
  code: "NOT_FOUND",
  message: "Resource not found",
});
```

## Existing Routers

health, sessions, tasks, projects, queue, billing, analytics, settings, brain, fleet, user, integrations
