import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const reviewStatusValues = [
  "pending",
  "in_progress",
  "completed",
] as const;
export type ReviewStatus = (typeof reviewStatusValues)[number];
export const reviewStatusEnum = pgEnum("review_status", reviewStatusValues);
export const ReviewStatusEnum = createEnumMap(reviewStatusValues);
