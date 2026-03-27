import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";

/**
 * Approval requests for sensitive or destructive operations.
 *
 * When an agent or user attempts a guarded action (e.g., deployment,
 * force push, environment variable modification), an approval request
 * is created and must be approved before the action can proceed.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `apr_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    orgId: text("org_id").notNull(),
    projectId: text("project_id"),
    sessionId: text("session_id"),
    requesterId: text("requester_id").notNull(),
    approverId: text("approver_id"),
    /** Action type, e.g. "deployment", "git_force_push", "env_modify" */
    actionType: text("action_type").notNull(),
    actionPayload: jsonb("action_payload")
      .$type<Record<string, unknown>>()
      .default({}),
    /** Status: pending, approved, rejected, expired */
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("approval_requests_org_id_idx").on(table.orgId),
    index("approval_requests_status_idx").on(table.orgId, table.status),
    index("approval_requests_requester_id_idx").on(table.requesterId),
    index("approval_requests_approver_id_idx").on(table.approverId),
    index("approval_requests_session_id_idx").on(table.sessionId),
    index("approval_requests_project_id_idx").on(table.projectId),
    index("approval_requests_action_type_idx").on(
      table.orgId,
      table.actionType
    ),
  ]
);

export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;
