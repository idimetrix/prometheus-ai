import { pgTable, text, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const modelUsage = pgTable("model_usage", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  taskId: text("task_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  costUsd: real("cost_usd").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modelConfigs = pgTable("model_configs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  apiKeyEncrypted: text("api_key_encrypted"),
  isDefault: boolean("is_default").notNull().default(false),
  priority: integer("priority").notNull().default(0),
});
