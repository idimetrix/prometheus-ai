import { pgTable, text, timestamp, integer, real } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const usageRollups = pgTable("usage_rollups", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
});
