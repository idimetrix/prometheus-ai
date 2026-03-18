import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const deployTargetValues = ["staging", "production", "manual"] as const;
export type DeployTarget = (typeof deployTargetValues)[number];
export const deployTargetEnum = pgEnum("deploy_target", deployTargetValues);
export const DeployTargetEnum = createEnumMap(deployTargetValues);
