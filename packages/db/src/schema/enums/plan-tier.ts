import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const planTierValues = [
  "hobby",
  "starter",
  "pro",
  "team",
  "studio",
  "enterprise",
] as const;
export type PlanTier = (typeof planTierValues)[number];
export const planTierEnum = pgEnum("plan_tier", planTierValues);
export const PlanTierEnum = createEnumMap(planTierValues);
