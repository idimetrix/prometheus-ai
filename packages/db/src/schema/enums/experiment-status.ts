import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const experimentStatusValues = [
  "running",
  "completed",
  "cancelled",
] as const;
export type ExperimentStatus = (typeof experimentStatusValues)[number];
export const experimentStatusEnum = pgEnum(
  "experiment_status",
  experimentStatusValues
);
export const ExperimentStatusEnum = createEnumMap(experimentStatusValues);
