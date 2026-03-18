import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const projectRoleValues = ["owner", "contributor", "viewer"] as const;
export type ProjectRole = (typeof projectRoleValues)[number];
export const projectRoleEnum = pgEnum("project_role", projectRoleValues);
export const ProjectRoleEnum = createEnumMap(projectRoleValues);
