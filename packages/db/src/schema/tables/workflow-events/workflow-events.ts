import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sessions } from "../sessions/sessions";

export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id").notNull(),
    stepName: text("step_name").notNull(),
    eventType: text("event_type", {
      enum: ["start", "complete", "fail", "retry", "skip"],
    }).notNull(),
    data: jsonb("data").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("workflow_events_session_id_idx").on(table.sessionId),
    index("workflow_events_workflow_id_idx").on(table.workflowId),
    index("workflow_events_created_at_idx").on(table.createdAt),
  ]
);
