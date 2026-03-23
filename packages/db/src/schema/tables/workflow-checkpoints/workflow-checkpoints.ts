import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sessions } from "../sessions/sessions";

export const workflowCheckpoints = pgTable(
  "workflow_checkpoints",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    orgId: text("org_id").notNull(),
    phase: text("phase").notNull(),
    iteration: text("iteration"),
    state: jsonb("state").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("workflow_checkpoints_session_id_idx").on(table.sessionId),
    index("workflow_checkpoints_session_task_idx").on(
      table.sessionId,
      table.taskId
    ),
    index("workflow_checkpoints_org_id_idx").on(table.orgId),
  ]
);
