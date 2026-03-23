import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const securityScanLevelValues = [
  "basic",
  "standard",
  "thorough",
] as const;
export type SecurityScanLevel = (typeof securityScanLevelValues)[number];
export const securityScanLevelEnum = pgEnum(
  "security_scan_level",
  securityScanLevelValues
);
export const SecurityScanLevelEnum = createEnumMap(securityScanLevelValues);
