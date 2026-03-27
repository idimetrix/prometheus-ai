import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";

/**
 * CI run records from external providers (GitHub Actions, GitLab CI,
 * Azure DevOps Pipelines, etc.).
 *
 * Tracks build/pipeline runs and their outcomes to provide CI status
 * visibility within the Prometheus dashboard.
 */
export const ciRuns = pgTable(
  "ci_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `cir_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    projectId: text("project_id").notNull(),
    orgId: text("org_id").notNull(),
    provider: text("provider").notNull(),
    externalRunId: text("external_run_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("pending"),
    conclusion: text("conclusion"),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    url: text("url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("ci_runs_project_id_idx").on(table.projectId),
    index("ci_runs_org_id_idx").on(table.orgId),
    index("ci_runs_provider_idx").on(table.projectId, table.provider),
    index("ci_runs_external_run_id_idx").on(
      table.provider,
      table.externalRunId
    ),
    index("ci_runs_status_idx").on(table.projectId, table.status),
    index("ci_runs_branch_idx").on(table.projectId, table.branch),
  ]
);

export type CiRun = typeof ciRuns.$inferSelect;
export type NewCiRun = typeof ciRuns.$inferInsert;
