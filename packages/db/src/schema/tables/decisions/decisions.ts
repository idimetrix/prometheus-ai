import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";

export const decisionLogs = pgTable(
  "decision_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    agentRole: text("agent_role").notNull(),
    decision: text("decision").notNull(),
    reasoning: text("reasoning"),
    outcome: text("outcome"),
    confidence: real("confidence"),
    filesChanged: jsonb("files_changed").default([]),
    creditsConsumed: integer("credits_consumed").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("decision_logs_project_id_idx").on(table.projectId),
    index("decision_logs_session_id_idx").on(table.sessionId),
    index("decision_logs_project_role_idx").on(
      table.projectId,
      table.agentRole
    ),
  ]
);
