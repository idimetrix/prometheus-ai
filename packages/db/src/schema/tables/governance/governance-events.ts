import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "../../helpers";

export const governanceEvents = pgTable(
  "governance_events",
  {
    id,
    sessionId: text("session_id"),
    orgId: text("org_id").notNull(),
    projectId: text("project_id"),
    eventType: text("event_type").notNull(),
    agentRole: text("agent_role").notNull(),
    details: jsonb("details"),
    severity: text("severity").notNull(),
    ...timestamps,
  },
  (table) => [
    index("governance_events_org_id_idx").on(table.orgId),
    index("governance_events_session_id_idx").on(table.sessionId),
    index("governance_events_event_type_idx").on(table.eventType),
    index("governance_events_severity_idx").on(table.severity),
    index("governance_events_created_at_idx").on(table.createdAt),
  ]
);

export type GovernanceEvent = typeof governanceEvents.$inferSelect;
export type NewGovernanceEvent = typeof governanceEvents.$inferInsert;
