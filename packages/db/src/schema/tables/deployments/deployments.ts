import { index, pgTable, text } from "drizzle-orm/pg-core";
import { deploymentProviderEnum, deploymentStatusEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: deploymentProviderEnum("provider").notNull(),
    status: deploymentStatusEnum("status").notNull().default("queued"),
    url: text("url"),
    branch: text("branch"),
    buildLogs: text("build_logs"),
    errorMessage: text("error_message"),
    providerDeploymentId: text("provider_deployment_id"),
    ...timestamps,
  },
  (table) => [
    index("deployments_project_id_idx").on(table.projectId),
    index("deployments_org_id_idx").on(table.orgId),
    index("deployments_status_idx").on(table.status),
  ]
);
