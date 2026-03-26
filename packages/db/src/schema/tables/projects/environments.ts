import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { environmentStatusEnum } from "../../enums/environment-status";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "./projects";

export const environments = pgTable(
  "environments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url"),
    status: environmentStatusEnum("status").notNull().default("active"),
    provider: text("provider"),
    lastDeployedAt: timestamp("last_deployed_at", {
      withTimezone: true,
      mode: "date",
    }),
    deploymentId: text("deployment_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("environments_project_name_idx").on(
      table.projectId,
      table.name
    ),
    index("environments_org_id_idx").on(table.orgId),
    index("environments_project_id_idx").on(table.projectId),
  ]
);
