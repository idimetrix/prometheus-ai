import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";

/**
 * Session sharing tokens and permissions.
 *
 * Allows users to share sessions with other team members via a unique
 * share token. Permissions control the level of access (viewer, editor, admin).
 */
export const sessionShares = pgTable(
  "session_shares",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `ssh_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    sessionId: text("session_id").notNull(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    /** Permission level: viewer, editor, admin */
    permission: text("permission").notNull().default("viewer"),
    shareToken: text("share_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("session_shares_session_id_idx").on(table.sessionId),
    index("session_shares_org_id_idx").on(table.orgId),
    index("session_shares_user_id_idx").on(table.userId),
    index("session_shares_share_token_idx").on(table.shareToken),
  ]
);

export type SessionShare = typeof sessionShares.$inferSelect;
export type NewSessionShare = typeof sessionShares.$inferInsert;
