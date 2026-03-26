import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const branchStrategyValues = [
  "trunk-based",
  "gitflow",
  "feature-branch",
  "custom",
] as const;
export type BranchStrategy = (typeof branchStrategyValues)[number];
export const branchStrategyEnum = pgEnum(
  "branch_strategy",
  branchStrategyValues
);
export const BranchStrategyEnum = createEnumMap(branchStrategyValues);
