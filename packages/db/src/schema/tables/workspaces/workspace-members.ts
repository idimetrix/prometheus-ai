import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { workspaces } from "./workspaces";

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("member"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspace_members_ws_user_idx").on(
      table.workspaceId,
      table.userId
    ),
    index("workspace_members_workspace_id_idx").on(table.workspaceId),
    index("workspace_members_user_id_idx").on(table.userId),
  ]
);
