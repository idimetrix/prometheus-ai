import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { agentPermissionEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { users } from "../users/users";
import { projects } from "./projects";

export const agentPermissions = pgTable(
  "agent_permissions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    permission: agentPermissionEnum("permission").notNull().default("ask"),
    conditions: jsonb("conditions").$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    index("agent_permissions_project_id_idx").on(table.projectId),
    index("agent_permissions_org_id_idx").on(table.orgId),
    index("agent_permissions_project_tool_idx").on(
      table.projectId,
      table.toolName
    ),
  ]
);
