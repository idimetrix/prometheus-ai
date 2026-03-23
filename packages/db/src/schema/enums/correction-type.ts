import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const correctionTypeValues = ["code", "approach", "style"] as const;
export type CorrectionType = (typeof correctionTypeValues)[number];
export const correctionTypeEnum = pgEnum(
  "correction_type",
  correctionTypeValues
);
export const CorrectionTypeEnum = createEnumMap(correctionTypeValues);
