import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";

export const deploymentPipelines = pgTable("deployment_pipelines", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  stages: jsonb("stages")
    .$type<
      Array<{
        name: string;
        type: "build" | "test" | "deploy" | "approval" | "notify";
        config: Record<string, unknown>;
        order: number;
        timeoutSeconds: number;
      }>
    >()
    .notNull()
    .default([]),
  enabled: text("enabled").notNull().default("true"),
  ...timestamps,
});

export const pipelineRuns = pgTable("pipeline_runs", {
  id: text("id").primaryKey(),
  pipelineId: text("pipeline_id").notNull(),
  projectId: text("project_id").notNull(),
  orgId: text("org_id").notNull(),
  status: text("status").notNull().default("pending"),
  triggeredBy: text("triggered_by"),
  branch: text("branch"),
  commitSha: text("commit_sha"),
  currentStage: text("current_stage"),
  stageResults: jsonb("stage_results")
    .$type<
      Array<{
        stage: string;
        status: string;
        startedAt: string;
        completedAt?: string;
        output?: string;
      }>
    >()
    .default([]),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
});
