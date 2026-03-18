import { pgTable, text, timestamp, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { projects } from "./projects";

export const integrationStatusEnum = pgEnum("integration_status", [
  "connected", "disconnected", "error",
]);

export const mcpConnections = pgTable("mcp_connections", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  credentialsEncrypted: text("credentials_encrypted"),
  status: integrationStatusEnum("status").notNull().default("disconnected"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
});

export const mcpToolConfigs = pgTable("mcp_tool_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  configJson: jsonb("config_json").notNull().default({}),
});
