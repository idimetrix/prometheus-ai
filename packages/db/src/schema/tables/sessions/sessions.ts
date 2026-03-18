import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  agentModeEnum,
  messageRoleEnum,
  sessionEventTypeEnum,
  sessionStatusEnum,
} from "../../enums";
import { projects } from "../projects/projects";
import { users } from "../users/users";

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: sessionStatusEnum("status").notNull().default("active"),
    mode: agentModeEnum("mode").notNull().default("task"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("sessions_project_id_idx").on(table.projectId),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_project_status_idx").on(table.projectId, table.status),
  ]
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    type: sessionEventTypeEnum("type").notNull(),
    data: jsonb("data").notNull().default({}),
    agentRole: text("agent_role"),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("session_events_session_id_idx").on(table.sessionId),
    index("session_events_session_type_idx").on(table.sessionId, table.type),
  ]
);

export const sessionMessages = pgTable(
  "session_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    modelUsed: text("model_used"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("session_messages_session_id_idx").on(table.sessionId)]
);
