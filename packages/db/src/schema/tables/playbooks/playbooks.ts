import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { playbookCategoryEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";

export const playbooks = pgTable(
  "playbooks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    category: playbookCategoryEnum("category").notNull().default("custom"),
    steps: jsonb("steps").notNull().default([]),
    parameters: jsonb("parameters").notNull().default([]),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(false),
    usageCount: integer("usage_count").notNull().default(0),
    tags: jsonb("tags").notNull().default([]),
    ...timestamps,
  },
  (table) => [
    index("playbooks_org_id_idx").on(table.orgId),
    index("playbooks_category_idx").on(table.category),
    index("playbooks_is_builtin_idx").on(table.isBuiltin),
    index("playbooks_is_public_idx").on(table.isPublic),
    index("playbooks_usage_count_idx").on(table.usageCount),
  ]
);
