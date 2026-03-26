import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";
import { ruleSourceEnum, ruleTypeEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "./projects";

export const projectRules = pgTable(
  "project_rules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: ruleTypeEnum("type").notNull(),
    rule: text("rule").notNull(),
    source: ruleSourceEnum("source").notNull().default("manual"),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("project_rules_project_id_idx").on(table.projectId),
    index("project_rules_org_id_idx").on(table.orgId),
    index("project_rules_type_idx").on(table.projectId, table.type),
  ]
);
