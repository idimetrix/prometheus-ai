import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";

/**
 * Custom agents created by users to define specialized AI behaviors.
 * Each agent has a system prompt, model preference, and a set of allowed tools.
 */
export const customAgents = pgTable(
  "custom_agents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `cag_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    description: text("description").default(""),
    systemPrompt: text("system_prompt").notNull(),
    tools: jsonb("tools").$type<string[]>().default([]),
    modelPreference: text("model_preference").default(
      "claude-sonnet-4-20250514"
    ),
    isShared: boolean("is_shared").default(false),
    version: integer("version").default(1),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("custom_agents_org_id_idx").on(table.orgId),
    index("custom_agents_created_by_idx").on(table.createdBy),
    index("custom_agents_is_shared_idx").on(table.orgId, table.isShared),
  ]
);

/**
 * Version history for custom agents.
 * Each time an agent is updated, a version snapshot is stored here.
 */
export const customAgentVersions = pgTable(
  "custom_agent_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `cav_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    agentId: text("agent_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    description: text("description").default(""),
    systemPrompt: text("system_prompt").notNull(),
    tools: jsonb("tools").$type<string[]>().default([]),
    modelPreference: text("model_preference").default(
      "claude-sonnet-4-20250514"
    ),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("custom_agent_versions_agent_id_idx").on(table.agentId),
    index("custom_agent_versions_agent_version_idx").on(
      table.agentId,
      table.version
    ),
  ]
);

export type CustomAgent = typeof customAgents.$inferSelect;
export type NewCustomAgent = typeof customAgents.$inferInsert;
export type CustomAgentVersion = typeof customAgentVersions.$inferSelect;
export type NewCustomAgentVersion = typeof customAgentVersions.$inferInsert;
