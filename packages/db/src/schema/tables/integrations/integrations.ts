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

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    failureCount: text("failure_count").notNull().default("0"),
  },
  (table) => [
    index("webhook_subscriptions_org_id_idx").on(table.orgId),
    index("webhook_subscriptions_org_enabled_idx").on(
      table.orgId,
      table.enabled
    ),
  ]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    statusCode: text("status_code"),
    responseBody: text("response_body"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    success: boolean("success").notNull().default(false),
    attempt: text("attempt").notNull().default("1"),
  },
  (table) => [
    index("webhook_deliveries_sub_id_idx").on(table.subscriptionId),
    index("webhook_deliveries_event_idx").on(table.subscriptionId, table.event),
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
