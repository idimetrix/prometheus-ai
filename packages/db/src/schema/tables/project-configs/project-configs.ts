import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "../projects/projects";

export const projectConfigs = pgTable(
  "project_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: "cascade" }),
    modelPreferences: jsonb("model_preferences").default({}),
    isolationLevel: text("isolation_level").notNull().default("standard"),
    rateLimits: jsonb("rate_limits").default({}),
    pluginAllowlist: jsonb("plugin_allowlist").default([]),
    agentBehavior: jsonb("agent_behavior").default({}),
    customConventions: jsonb("custom_conventions").default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("project_configs_project_id_idx").on(table.projectId)]
);
