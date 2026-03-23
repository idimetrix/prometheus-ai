import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const blueprintEnforcementValues = [
  "strict",
  "flexible",
  "advisory",
] as const;
export type BlueprintEnforcement = (typeof blueprintEnforcementValues)[number];
export const blueprintEnforcementEnum = pgEnum(
  "blueprint_enforcement",
  blueprintEnforcementValues
);
export const BlueprintEnforcementEnum = createEnumMap(
  blueprintEnforcementValues
);
