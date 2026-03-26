import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    providerAccountId: text("provider_account_id"),
    providerUsername: text("provider_username"),
    ...timestamps,
  },
  (table) => [
    index("oauth_tokens_org_id_idx").on(table.orgId),
    index("oauth_tokens_user_id_idx").on(table.userId),
    index("oauth_tokens_org_provider_idx").on(table.orgId, table.provider),
    index("oauth_tokens_user_provider_idx").on(table.userId, table.provider),
  ]
);
