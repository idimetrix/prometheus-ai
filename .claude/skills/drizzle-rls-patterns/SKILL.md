---
name: drizzle-rls-patterns
description: Drizzle ORM schema conventions, org_id RLS enforcement, pgvector embedding patterns, migration workflow in Prometheus
user-invocable: false
---

# Drizzle ORM & Database Patterns

## Schema Location

All schemas live in `packages/db/src/schema/` and are re-exported from `packages/db/src/schema/index.ts`.

## CRITICAL: org_id RLS Enforcement

**Every tenant-scoped table MUST have an `org_id` column** referencing `organizations.id` with `onDelete: "cascade"`.

**Every query on tenant-scoped data MUST filter by `orgId`** from the authenticated context.

```typescript
// CORRECT — always filter by orgId
const projects = await ctx.db
  .select()
  .from(schema.projects)
  .where(eq(schema.projects.orgId, ctx.orgId));

// WRONG — never query without org_id filter on tenant data
const projects = await ctx.db.select().from(schema.projects);
```

### Schema Pattern

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { generateId } from "@prometheus/utils";

export const myTable = pgTable("my_table", {
  id: text("id").primaryKey().$defaultFn(() => generateId()),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // ... other columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### Relations Pattern

```typescript
export const myTableRelations = relations(myTable, ({ one }) => ({
  organization: one(organizations, {
    fields: [myTable.orgId],
    references: [organizations.id],
  }),
}));
```

## pgvector Embeddings

Uses 768-dimensional vectors for code and memory embeddings:

```typescript
import { vector } from "drizzle-orm/pg-core";

embedding: vector("embedding", { dimensions: 768 }),
```

Tables using vectors:
- `code_embeddings` — file/function embeddings for semantic search
- `memories` — agent memory embeddings

## Migration Workflow

```bash
# Development — push schema changes directly (no migration files)
pnpm db:push

# Production — generate and run migration files
pnpm db:migrate
```

## Database Client

Import from `@prometheus/db`:
```typescript
import { db } from "@prometheus/db";
import * as schema from "@prometheus/db/schema";
```

## ID Generation

Always use `generateId()` from `@prometheus/utils` for primary keys — never use `uuid()` or `cuid()` directly.
