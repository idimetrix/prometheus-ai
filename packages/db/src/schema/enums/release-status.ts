import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const releaseStatusValues = ["draft", "published"] as const;
export type ReleaseStatus = (typeof releaseStatusValues)[number];
export const releaseStatusEnum = pgEnum("release_status", releaseStatusValues);
export const ReleaseStatusEnum = createEnumMap(releaseStatusValues);
