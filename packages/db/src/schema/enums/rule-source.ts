import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const ruleSourceValues = ["manual", "auto_detected", "file"] as const;
export type RuleSource = (typeof ruleSourceValues)[number];
export const ruleSourceEnum = pgEnum("rule_source", ruleSourceValues);
export const RuleSourceEnum = createEnumMap(ruleSourceValues);
