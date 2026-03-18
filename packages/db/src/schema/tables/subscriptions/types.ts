import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { subscriptionPlans, subscriptions } from "./subscriptions";

export const insertSubscriptionSchema = createInsertSchema(subscriptions);
export const selectSubscriptionSchema = createSelectSchema(subscriptions);
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export const insertSubscriptionPlanSchema =
  createInsertSchema(subscriptionPlans);
export const selectSubscriptionPlanSchema =
  createSelectSchema(subscriptionPlans);
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type NewSubscriptionPlan = typeof subscriptionPlans.$inferInsert;
