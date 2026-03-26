import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const repoProviderValues = ["github", "gitlab", "bitbucket"] as const;
export type RepoProvider = (typeof repoProviderValues)[number];
export const repoProviderEnum = pgEnum("repo_provider", repoProviderValues);
export const RepoProviderEnum = createEnumMap(repoProviderValues);
