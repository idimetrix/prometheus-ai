import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { orgRoleEnum, planTierEnum } from "../../enums";
import { timestamps } from "../../helpers";

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    clerkOrgId: text("clerk_org_id").unique(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    planTier: planTierEnum("plan_tier").notNull().default("hobby"),
    stripeCustomerId: text("stripe_customer_id").unique(),
    ...timestamps,
  },
  (table) => [index("organizations_clerk_org_id_idx").on(table.clerkOrgId)]
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: orgRoleEnum("role").notNull().default("member"),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
  },
  (table) => [
    index("org_members_org_id_idx").on(table.orgId),
    index("org_members_user_id_idx").on(table.userId),
    index("org_members_org_user_idx").on(table.orgId, table.userId),
  ]
);
