import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { integrationStatusEnum } from "../../enums";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";

export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    credentialsEncrypted: text("credentials_encrypted"),
    status: integrationStatusEnum("status").notNull().default("disconnected"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
  },
  (table) => [
    index("mcp_connections_org_id_idx").on(table.orgId),
    index("mcp_connections_org_provider_idx").on(table.orgId, table.provider),
  ]
);

export const mcpToolConfigs = pgTable(
  "mcp_tool_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    configJson: jsonb("config_json").notNull().default({}),
  },
  (table) => [index("mcp_tool_configs_project_id_idx").on(table.projectId)]
);
