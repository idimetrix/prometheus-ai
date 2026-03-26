import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const prReviewStatusValues = [
  "pending",
  "approved",
  "changes_requested",
] as const;
export type PRReviewStatus = (typeof prReviewStatusValues)[number];
export const prReviewStatusEnum = pgEnum(
  "pr_review_status",
  prReviewStatusValues
);
export const PRReviewStatusEnum = createEnumMap(prReviewStatusValues);
