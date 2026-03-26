import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const playbookCategoryValues = [
  "code_quality",
  "feature",
  "devops",
  "testing",
  "security",
  "refactoring",
  "custom",
] as const;
export type PlaybookCategory = (typeof playbookCategoryValues)[number];
export const playbookCategoryEnum = pgEnum(
  "playbook_category",
  playbookCategoryValues
);
export const PlaybookCategoryEnum = createEnumMap(playbookCategoryValues);
