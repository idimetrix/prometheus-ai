import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { agentStatusEnum } from "../../enums";
import { sessions } from "../sessions/sessions";

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: agentStatusEnum("status").notNull().default("idle"),
    modelUsed: text("model_used"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    stepsCompleted: integer("steps_completed").notNull().default(0),
    currentTaskId: text("current_task_id"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
  },
  (table) => [
    index("agents_session_id_idx").on(table.sessionId),
    index("agents_session_status_idx").on(table.sessionId, table.status),
  ]
);
