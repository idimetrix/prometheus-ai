import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { users } from "../users/users";
import { organizations } from "./organizations";

export const teamAgentQuotas = pgTable(
  "team_agent_quotas",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    maxConcurrentSessions: integer("max_concurrent_sessions")
      .notNull()
      .default(2),
    maxDailyCredits: integer("max_daily_credits").notNull().default(100),
    currentActiveSessions: integer("current_active_sessions")
      .notNull()
      .default(0),
    creditsUsedToday: integer("credits_used_today").notNull().default(0),
    lastResetAt: timestamp("last_reset_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...timestamps,
  },
  (table) => [
    index("team_agent_quotas_org_id_idx").on(table.orgId),
    index("team_agent_quotas_user_id_idx").on(table.userId),
    index("team_agent_quotas_org_user_idx").on(table.orgId, table.userId),
  ]
);
