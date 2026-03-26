import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const issueSyncProviderValues = [
  "github",
  "gitlab",
  "bitbucket",
  "linear",
  "jira",
] as const;
export type IssueSyncProvider = (typeof issueSyncProviderValues)[number];
export const issueSyncProviderEnum = pgEnum(
  "issue_sync_provider",
  issueSyncProviderValues
);
export const IssueSyncProviderEnum = createEnumMap(issueSyncProviderValues);
