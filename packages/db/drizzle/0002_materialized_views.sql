-- ════════════════════════════════════════════════════════════════
-- Phase 9.5: Materialized Views for Analytics
-- Pre-aggregated data for dashboard queries, billing summaries,
-- and org-level usage reports.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- mv_org_daily_stats: Per-org daily aggregated metrics
-- Refreshed every 15 minutes via Kubernetes CronJob
-- ──────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW mv_org_daily_stats AS
SELECT
  o.id AS org_id,
  date_trunc('day', se.timestamp)::date AS day,
  -- Task metrics
  COUNT(DISTINCT CASE WHEN se.event_type = 'task_completed' THEN se.id END) AS tasks_completed,
  COUNT(DISTINCT CASE WHEN se.event_type = 'task_failed' THEN se.id END) AS tasks_failed,
  COUNT(DISTINCT CASE WHEN se.event_type IN ('task_completed', 'task_failed', 'task_started') THEN se.id END) AS tasks_total,
  -- Credit usage
  COALESCE(SUM(
    CASE WHEN se.event_type = 'credit_consumed'
    THEN (se.metadata->>'credits')::numeric
    ELSE 0 END
  ), 0) AS credits_consumed,
  -- Active users (distinct users who triggered any event)
  COUNT(DISTINCT se.user_id) AS active_users,
  -- Session metrics
  COUNT(DISTINCT se.session_id) AS sessions,
  -- Timing
  MIN(se.timestamp) AS first_event_at,
  MAX(se.timestamp) AS last_event_at
FROM organizations o
LEFT JOIN session_events se ON se.org_id = o.id
  AND se.timestamp >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY o.id, date_trunc('day', se.timestamp)::date
WITH DATA;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_org_daily_stats_pk
  ON mv_org_daily_stats (org_id, day);

CREATE INDEX idx_mv_org_daily_stats_day
  ON mv_org_daily_stats (day);

CREATE INDEX idx_mv_org_daily_stats_org
  ON mv_org_daily_stats (org_id, day DESC);

-- ──────────────────────────────────────────────────────────────
-- mv_model_usage_hourly: Per-model hourly usage for cost tracking
-- ──────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW mv_model_usage_hourly AS
SELECT
  org_id,
  model_id,
  date_trunc('hour', created_at) AS hour,
  COUNT(*) AS request_count,
  SUM(input_tokens) AS total_input_tokens,
  SUM(output_tokens) AS total_output_tokens,
  SUM(cost_cents) AS total_cost_cents,
  AVG(latency_ms) AS avg_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_latency_ms
FROM model_usage_logs
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY org_id, model_id, date_trunc('hour', created_at)
WITH DATA;

CREATE UNIQUE INDEX idx_mv_model_usage_hourly_pk
  ON mv_model_usage_hourly (org_id, model_id, hour);

CREATE INDEX idx_mv_model_usage_hourly_hour
  ON mv_model_usage_hourly (hour);

-- ──────────────────────────────────────────────────────────────
-- mv_project_activity: Per-project activity summary
-- ──────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW mv_project_activity AS
SELECT
  p.id AS project_id,
  p.org_id,
  date_trunc('day', se.timestamp)::date AS day,
  COUNT(*) AS total_events,
  COUNT(DISTINCT se.user_id) AS active_users,
  COUNT(DISTINCT se.session_id) AS sessions,
  COUNT(DISTINCT CASE WHEN se.event_type LIKE 'agent_%' THEN se.id END) AS agent_events,
  COUNT(DISTINCT CASE WHEN se.event_type LIKE 'file_%' THEN se.id END) AS file_events
FROM projects p
LEFT JOIN session_events se ON se.project_id = p.id
  AND se.timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY p.id, p.org_id, date_trunc('day', se.timestamp)::date
WITH DATA;

CREATE UNIQUE INDEX idx_mv_project_activity_pk
  ON mv_project_activity (project_id, day);

CREATE INDEX idx_mv_project_activity_org
  ON mv_project_activity (org_id, day DESC);

-- ──────────────────────────────────────────────────────────────
-- Refresh functions
-- ──────────────────────────────────────────────────────────────

-- Refresh all materialized views concurrently (non-blocking)
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  start_time TIMESTAMPTZ;
BEGIN
  start_time := clock_timestamp();
  RAISE NOTICE 'Starting materialized view refresh at %', start_time;

  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_org_daily_stats;
  RAISE NOTICE 'Refreshed mv_org_daily_stats in %s', clock_timestamp() - start_time;

  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_usage_hourly;
  RAISE NOTICE 'Refreshed mv_model_usage_hourly in %s', clock_timestamp() - start_time;

  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_project_activity;
  RAISE NOTICE 'Refreshed mv_project_activity in %s', clock_timestamp() - start_time;

  RAISE NOTICE 'All views refreshed. Total time: %s', clock_timestamp() - start_time;
END;
$$;

-- Refresh a single view by name
CREATE OR REPLACE FUNCTION refresh_materialized_view(view_name TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', view_name);
  RAISE NOTICE 'Refreshed %', view_name;
END;
$$;

COMMIT;
