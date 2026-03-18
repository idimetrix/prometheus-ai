import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "../projects/projects";

export const domainRules = pgTable(
  "domain_rules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    condition: text("condition").notNull(),
    severity: text("severity").notNull().default("warning"),
    category: text("category").notNull().default("business"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("domain_rules_project_id_idx").on(table.projectId),
    index("domain_rules_project_category_idx").on(
      table.projectId,
      table.category
    ),
  ]
);
