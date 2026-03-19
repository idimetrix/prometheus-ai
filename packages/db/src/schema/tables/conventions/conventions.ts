import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { projects } from "../projects/projects";

export const projectConventions = pgTable(
  "project_conventions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text("category", {
      enum: [
        "naming",
        "structure",
        "imports",
        "error_handling",
        "testing",
        "styling",
        "api",
        "database",
        "other",
      ],
    }).notNull(),
    pattern: text("pattern").notNull(),
    description: text("description").notNull(),
    confidence: real("confidence").notNull().default(0.5),
    fileCount: integer("file_count").notNull().default(0),
    examples: jsonb("examples").default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_conventions_project_idx").on(table.projectId),
    index("project_conventions_project_category_idx").on(
      table.projectId,
      table.category
    ),
  ]
);
