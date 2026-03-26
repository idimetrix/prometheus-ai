import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const ciStatusValues = [
  "pending",
  "running",
  "passed",
  "failed",
] as const;
export type CIStatus = (typeof ciStatusValues)[number];
export const ciStatusEnum = pgEnum("ci_status", ciStatusValues);
export const CIStatusEnum = createEnumMap(ciStatusValues);
