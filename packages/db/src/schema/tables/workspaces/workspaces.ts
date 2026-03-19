import { boolean, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    settings: jsonb("settings").default({}),
    ...timestamps,
  },
  (table) => [
    index("workspaces_org_id_idx").on(table.orgId),
    index("workspaces_org_name_idx").on(table.orgId, table.name),
  ]
);
