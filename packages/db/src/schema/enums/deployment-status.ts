import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const deploymentStatusValues = [
  "queued",
  "building",
  "deploying",
  "live",
  "failed",
  "deleted",
] as const;
export type DeploymentStatus = (typeof deploymentStatusValues)[number];
export const deploymentStatusEnum = pgEnum(
  "deployment_status",
  deploymentStatusValues
);
export const DeploymentStatusEnum = createEnumMap(deploymentStatusValues);
