import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizations } from "../organizations/organizations";

export const installedPlugins = pgTable(
  "installed_plugins",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").default({}),
    permissions: jsonb("permissions").default([]),
    installedAt: timestamp("installed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("installed_plugins_org_id_idx").on(table.orgId),
    index("installed_plugins_org_plugin_idx").on(table.orgId, table.pluginId),
  ]
);
