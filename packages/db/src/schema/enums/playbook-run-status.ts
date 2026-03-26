import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const playbookRunStatusValues = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;
export type PlaybookRunStatus = (typeof playbookRunStatusValues)[number];
export const playbookRunStatusEnum = pgEnum(
  "playbook_run_status",
  playbookRunStatusValues
);
export const PlaybookRunStatusEnum = createEnumMap(playbookRunStatusValues);
