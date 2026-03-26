import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizations } from "../organizations/organizations";
import { users } from "../users/users";

/**
 * Available API key scopes for fine-grained permission control.
 */
export const API_KEY_SCOPES = [
  "sessions:read",
  "sessions:write",
  "projects:read",
  "projects:write",
  "fleet:manage",
  "tasks:read",
  "tasks:write",
  "audit:read",
  "billing:read",
  "settings:read",
  "settings:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    keyHash: text("key_hash").notNull().unique(),
    name: text("name").notNull(),
    scopes: jsonb("scopes").$type<ApiKeyScope[]>().default([]),
    projectIds: jsonb("project_ids").$type<string[]>(),
    lastUsed: timestamp("last_used", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    requestCount: integer("request_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_org_id_idx").on(table.orgId),
    index("api_keys_user_id_idx").on(table.userId),
  ]
);
