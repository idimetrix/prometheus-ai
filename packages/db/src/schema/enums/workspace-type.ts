import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const workspaceTypeValues = [
  "pnpm",
  "npm",
  "yarn",
  "nx",
  "turbo",
  "lerna",
  "rush",
  "cargo",
  "go",
] as const;
export type WorkspaceType = (typeof workspaceTypeValues)[number];
export const workspaceTypeEnum = pgEnum("workspace_type", workspaceTypeValues);
export const WorkspaceTypeEnum = createEnumMap(workspaceTypeValues);
