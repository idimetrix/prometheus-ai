import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const reviewSeverityValues = [
  "info",
  "warning",
  "error",
  "critical",
] as const;
export type ReviewSeverity = (typeof reviewSeverityValues)[number];
export const reviewSeverityEnum = pgEnum(
  "review_severity",
  reviewSeverityValues
);
export const ReviewSeverityEnum = createEnumMap(reviewSeverityValues);
