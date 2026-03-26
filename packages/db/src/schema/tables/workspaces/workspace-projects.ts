import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { workspaces } from "./workspaces";

export const workspaceProjects = pgTable(
  "workspace_projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspace_projects_ws_proj_idx").on(
      table.workspaceId,
      table.projectId
    ),
    index("workspace_projects_workspace_id_idx").on(table.workspaceId),
    index("workspace_projects_project_id_idx").on(table.projectId),
  ]
);
