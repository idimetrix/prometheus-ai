import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { subscriptionStatusEnum } from "../../enums";
import { organizations } from "../organizations/organizations";

export const subscriptionPlans = pgTable("subscription_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stripePriceId: text("stripe_price_id"),
  creditsIncluded: integer("credits_included").notNull(),
  maxParallelAgents: integer("max_parallel_agents").notNull(),
  featuresJson: jsonb("features_json").notNull().default({}),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  },
  (table) => [
    index("subscriptions_org_id_idx").on(table.orgId),
    index("subscriptions_org_status_idx").on(table.orgId, table.status),
  ]
);
