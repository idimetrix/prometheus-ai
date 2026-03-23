import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const projectStatusValues = ["active", "archived", "setup"] as const;
export type ProjectStatus = (typeof projectStatusValues)[number];
export const projectStatusEnum = pgEnum("project_status", projectStatusValues);
export const ProjectStatusEnum = createEnumMap(projectStatusValues);
