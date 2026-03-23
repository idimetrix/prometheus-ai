import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const architectureMetricTypeValues = [
  "complexity",
  "coupling",
  "cohesion",
  "depth",
] as const;
export type ArchitectureMetricType =
  (typeof architectureMetricTypeValues)[number];
export const architectureMetricTypeEnum = pgEnum(
  "architecture_metric_type",
  architectureMetricTypeValues
);
export const ArchitectureMetricTypeEnum = createEnumMap(
  architectureMetricTypeValues
);
