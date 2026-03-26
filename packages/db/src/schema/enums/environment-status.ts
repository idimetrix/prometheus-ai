import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const environmentStatusValues = [
  "active",
  "inactive",
  "deploying",
] as const;
export type EnvironmentStatus = (typeof environmentStatusValues)[number];
export const environmentStatusEnum = pgEnum(
  "environment_status",
  environmentStatusValues
);
export const EnvironmentStatusEnum = createEnumMap(environmentStatusValues);
