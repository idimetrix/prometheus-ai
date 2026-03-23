import type { SkillPack } from "./ecommerce";

/**
 * Data Pipeline Skill Pack
 *
 * Patterns for ETL processes, job scheduling, data quality monitoring,
 * pipeline orchestration, and observability.
 */

export const DATA_PIPELINE_SKILL_PACK: SkillPack = {
  id: "skill-pack-data-pipeline",
  name: "Data Pipeline",
  description:
    "ETL processes, job scheduling, data quality monitoring, pipeline orchestration, and observability",
  category: "skill-pack",
  tags: ["etl", "data", "pipeline", "scheduling", "monitoring", "batch"],

  patterns: [
    {
      name: "ETL Pipeline",
      description:
        "Extract-Transform-Load pattern with error handling and retry logic",
      context: "Move and transform data between systems reliably",
      implementation: `
- Pipeline definition: source -> extractors -> transformers -> loaders -> sink
- PipelineRun table: id, pipelineId, status, startedAt, completedAt, recordsProcessed, errors
- Extract: connect to source (API, DB, file), paginate/stream, checkpoint progress
- Transform: validate, clean, enrich, map to target schema. Log invalid records
- Load: batch upsert to destination. Use transactions for atomicity
- Error handling: dead-letter queue for failed records, retry with exponential backoff
- Checkpointing: store last processed offset/cursor for resumable runs
- Idempotent loads: use upsert (ON CONFLICT) to handle re-runs safely
`,
    },
    {
      name: "Job Scheduling",
      description: "Cron-based and event-driven job scheduling with BullMQ",
      context: "Run data jobs on schedule or in response to events",
      implementation: `
- Use BullMQ for job queues with Redis backend
- JobSchedule table: id, name, cronExpression, pipelineId, enabled, lastRunAt, nextRunAt
- Repeatable jobs: BullMQ repeat option with cron expressions
- Job priorities: critical (1), high (3), normal (5), low (7), background (9)
- Concurrency control: limit parallel runs per pipeline and globally
- Job dependencies: wait for upstream jobs to complete before starting
- Dead-letter queue: move failed jobs after max retries
- Job lifecycle events: scheduled -> queued -> active -> completed/failed
`,
    },
    {
      name: "Data Quality Monitoring",
      description: "Automated data quality checks with alerts",
      context: "Ensure data accuracy, completeness, and consistency",
      implementation: `
- Quality checks: schema validation, null checks, range checks, uniqueness, referential integrity
- QualityRule table: id, pipelineId, ruleType, config, severity (error|warning|info)
- QualityResult table: id, runId, ruleId, passed, failedRecords, details
- Run checks after each pipeline stage (post-extract, post-transform, post-load)
- Threshold alerts: if failure rate > X%, pause pipeline and notify
- Trend tracking: compare quality metrics across runs to detect degradation
- Data profiling: automatically compute statistics (nulls, cardinality, distribution)
`,
    },
    {
      name: "Pipeline Orchestration",
      description:
        "DAG-based pipeline orchestration with dependency management",
      context: "Coordinate multiple interdependent pipelines",
      implementation: `
- DAG definition: nodes (pipeline steps) and edges (dependencies)
- Execution order: topological sort of the DAG
- Parallel execution: run independent branches concurrently
- Pipeline table: id, name, dagDefinition (jsonb), schedule, enabled
- PipelineStep table: id, pipelineId, name, type, config, dependsOn (array)
- Execution: create PipelineRun, then execute steps respecting dependencies
- Failure handling: fail-fast (stop all) or continue-on-error per step config
- Manual triggers: allow ad-hoc runs with parameter overrides
`,
    },
    {
      name: "Pipeline Observability",
      description: "Logging, metrics, and tracing for data pipelines",
      context: "Monitor pipeline health and debug issues",
      implementation: `
- Structured logging: every pipeline step logs with runId, stepName, recordCount
- Metrics: records_processed, processing_time_ms, error_count, queue_depth
- Dashboards: pipeline run history, success rate, average duration, throughput
- Alerting: Slack/email notifications on failure, SLA breach, or anomalous duration
- Tracing: correlate logs across pipeline steps with a shared traceId
- Retention: archive old run logs, keep metrics for trend analysis
`,
    },
  ],

  agentHints: {
    architect:
      "Design pipelines as composable steps in a DAG. Use BullMQ for scheduling. Checkpointing for resumability. Idempotent loads for safety.",
    frontend_coder:
      "Build pipeline DAG visualization. Run history table with status indicators. Real-time job progress updates via WebSocket.",
    backend_coder:
      "Implement ETL steps as isolated functions. Use BullMQ workers for execution. Database transactions for atomic loads. Dead-letter queues for failures.",
    test_engineer:
      "Test with sample datasets. Verify idempotent loads. Test failure recovery and retry logic. Test scheduling accuracy.",
    deploy_engineer:
      "Separate worker processes from API. Scale workers independently. Redis for BullMQ. Monitor queue depth and processing lag.",
  },
};
