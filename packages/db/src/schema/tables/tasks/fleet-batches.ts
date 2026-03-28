import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";

export const fleetBatches = pgTable(
  "fleet_batches",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name"),
    status: text("status", {
      enum: ["pending", "running", "completed", "partial", "failed"],
    })
      .notNull()
      .default("pending"),
    totalTasks: integer("total_tasks").notNull().default(0),
    completedTasks: integer("completed_tasks").notNull().default(0),
    failedTasks: integer("failed_tasks").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("fleet_batches_org_id_idx").on(table.orgId),
    index("fleet_batches_user_id_idx").on(table.userId),
    index("fleet_batches_org_status_idx").on(table.orgId, table.status),
  ]
);
