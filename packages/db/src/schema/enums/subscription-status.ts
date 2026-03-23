import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const subscriptionStatusValues = [
  "active",
  "past_due",
  "cancelled",
  "trialing",
  "incomplete",
] as const;
export type SubscriptionStatus = (typeof subscriptionStatusValues)[number];
export const subscriptionStatusEnum = pgEnum(
  "subscription_status",
  subscriptionStatusValues
);
export const SubscriptionStatusEnum = createEnumMap(subscriptionStatusValues);
