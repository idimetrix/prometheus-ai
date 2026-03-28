import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sessions } from "./sessions";

/**
 * Approval gates pause agent execution until a human approves/rejects.
 * Used for long-running sessions that need human-in-the-loop decisions
 * before proceeding with risky operations (deployments, destructive changes, etc.).
 */
export const sessionApprovalGates = pgTable(
  "session_approval_gates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `sag_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Gate type: deployment, destructive_change, external_api, cost_threshold, manual */
    gateType: text("gate_type").notNull(),
    /** Human-readable description of what the agent wants to do */
    description: text("description").notNull(),
    /** Structured context about the pending action */
    context: jsonb("context").$type<Record<string, unknown>>().default({}),
    /** Status: pending, approved, rejected, expired */
    status: text("status").notNull().default("pending"),
    /** Who resolved this gate (user ID) */
    resolvedBy: text("resolved_by"),
    /** Optional rejection reason */
    rejectionReason: text("rejection_reason"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("session_approval_gates_session_id_idx").on(table.sessionId),
    index("session_approval_gates_status_idx").on(
      table.sessionId,
      table.status
    ),
  ]
);

export type SessionApprovalGate = typeof sessionApprovalGates.$inferSelect;
export type NewSessionApprovalGate = typeof sessionApprovalGates.$inferInsert;
