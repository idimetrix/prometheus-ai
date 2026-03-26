import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const repoIndexStatusValues = [
  "pending",
  "indexing",
  "indexed",
  "failed",
] as const;
export type RepoIndexStatus = (typeof repoIndexStatusValues)[number];
export const repoIndexStatusEnum = pgEnum(
  "repo_index_status",
  repoIndexStatusValues
);
export const RepoIndexStatusEnum = createEnumMap(repoIndexStatusValues);
