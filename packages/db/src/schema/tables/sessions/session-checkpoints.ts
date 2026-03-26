import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizations } from "../organizations/organizations";
import { sessions } from "./sessions";

export const sessionCheckpoints = pgTable(
  "session_checkpoints",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    iteration: integer("iteration").notNull(),
    agentState: jsonb("agent_state"),
    filesModified: jsonb("files_modified"),
    planProgress: jsonb("plan_progress"),
    toolCallCount: integer("tool_call_count"),
    tokensConsumed: integer("tokens_consumed"),
    creditsConsumed: integer("credits_consumed"),
    artifactUrl: text("artifact_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("session_checkpoints_session_id_idx").on(table.sessionId),
    index("session_checkpoints_org_id_idx").on(table.orgId),
    index("session_checkpoints_session_iteration_idx").on(
      table.sessionId,
      table.iteration
    ),
  ]
);
