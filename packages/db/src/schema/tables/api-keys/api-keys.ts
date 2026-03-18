import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "../organizations/organizations";
import { users } from "../users/users";

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
    lastUsed: timestamp("last_used", { withTimezone: true }),
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
