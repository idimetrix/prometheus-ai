import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const ruleTypeValues = [
  "code_style",
  "architecture",
  "testing",
  "review",
  "prompt",
  "security",
] as const;
export type RuleType = (typeof ruleTypeValues)[number];
export const ruleTypeEnum = pgEnum("rule_type", ruleTypeValues);
export const RuleTypeEnum = createEnumMap(ruleTypeValues);
