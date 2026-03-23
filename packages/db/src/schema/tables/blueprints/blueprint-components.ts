import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { componentTypeEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { blueprints } from "./blueprints";

export const blueprintComponents = pgTable(
  "blueprint_components",
  {
    id: text("id").primaryKey(),
    blueprintId: text("blueprint_id")
      .notNull()
      .references(() => blueprints.id, { onDelete: "cascade" }),
    componentType: componentTypeEnum("component_type").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    filePath: text("file_path"),
    dependencies: jsonb("dependencies").$type<string[]>().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    order: integer("order").default(0),
    ...timestamps,
  },
  (table) => [
    index("blueprint_components_blueprint_id_idx").on(table.blueprintId),
    index("blueprint_components_type_idx").on(
      table.blueprintId,
      table.componentType
    ),
  ]
);
