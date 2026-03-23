import {
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizations } from "../organizations/organizations";

export const modelUsageLogs = pgTable(
  "model_usage_logs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    modelKey: text("model_key").notNull(),
    provider: text("provider").notNull(),
    slot: text("slot").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("model_usage_logs_org_id_idx").on(table.orgId),
    index("model_usage_logs_model_key_idx").on(table.modelKey),
    index("model_usage_logs_created_at_idx").on(table.createdAt),
    index("model_usage_logs_org_created_idx").on(table.orgId, table.createdAt),
  ]
);
