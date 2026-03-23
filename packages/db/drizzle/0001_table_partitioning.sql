-- ════════════════════════════════════════════════════════════════
-- Phase 9.4: Table Partitioning Migration
-- Converts high-volume tables to partitioned tables for improved
-- query performance and maintenance (VACUUM, retention deletes).
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. session_events — Range partition by month on `timestamp`
-- ──────────────────────────────────────────────────────────────

-- Rename existing table
ALTER TABLE session_events RENAME TO session_events_old;

-- Create partitioned table with same schema
CREATE TABLE session_events (
  LIKE session_events_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED
) PARTITION BY RANGE (timestamp);

-- Create 12 months of partitions (current month + 6 future + 5 past)
CREATE TABLE session_events_2025_10 PARTITION OF session_events
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE session_events_2025_11 PARTITION OF session_events
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE session_events_2025_12 PARTITION OF session_events
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE session_events_2026_01 PARTITION OF session_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE session_events_2026_02 PARTITION OF session_events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE session_events_2026_03 PARTITION OF session_events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE session_events_2026_04 PARTITION OF session_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE session_events_2026_05 PARTITION OF session_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE session_events_2026_06 PARTITION OF session_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE session_events_2026_07 PARTITION OF session_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE session_events_2026_08 PARTITION OF session_events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE session_events_2026_09 PARTITION OF session_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- Default partition for overflow
CREATE TABLE session_events_default PARTITION OF session_events DEFAULT;

-- Migrate existing data
INSERT INTO session_events SELECT * FROM session_events_old;

-- Create indexes on the partitioned table (auto-propagated to partitions)
CREATE INDEX idx_session_events_timestamp ON session_events (timestamp);
CREATE INDEX idx_session_events_session_id ON session_events (session_id, timestamp);
CREATE INDEX idx_session_events_org_id ON session_events (org_id, timestamp);
CREATE INDEX idx_session_events_type ON session_events (event_type, timestamp);

-- Drop old table after successful migration
DROP TABLE session_events_old;

-- ──────────────────────────────────────────────────────────────
-- 2. audit_logs — Range partition by quarter on `created_at`
-- ──────────────────────────────────────────────────────────────

ALTER TABLE audit_logs RENAME TO audit_logs_old;

CREATE TABLE audit_logs (
  LIKE audit_logs_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED
) PARTITION BY RANGE (created_at);

-- 8 quarters: Q3 2024 through Q2 2026
CREATE TABLE audit_logs_2024_q3 PARTITION OF audit_logs
  FOR VALUES FROM ('2024-07-01') TO ('2024-10-01');
CREATE TABLE audit_logs_2024_q4 PARTITION OF audit_logs
  FOR VALUES FROM ('2024-10-01') TO ('2025-01-01');
CREATE TABLE audit_logs_2025_q1 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE audit_logs_2025_q2 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE audit_logs_2025_q3 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE audit_logs_2025_q4 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
CREATE TABLE audit_logs_2026_q1 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE audit_logs_2026_q2 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

INSERT INTO audit_logs SELECT * FROM audit_logs_old;

CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX idx_audit_logs_org_id ON audit_logs (org_id, created_at);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs (action, created_at);
CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id, created_at);

DROP TABLE audit_logs_old;

-- ──────────────────────────────────────────────────────────────
-- 3. code_embeddings — Hash partition by project_id (16 shards)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE code_embeddings RENAME TO code_embeddings_old;

CREATE TABLE code_embeddings (
  LIKE code_embeddings_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED
) PARTITION BY HASH (project_id);

CREATE TABLE code_embeddings_p00 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE code_embeddings_p01 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE code_embeddings_p02 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE code_embeddings_p03 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE code_embeddings_p04 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE code_embeddings_p05 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE code_embeddings_p06 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE code_embeddings_p07 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE code_embeddings_p08 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE code_embeddings_p09 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE code_embeddings_p10 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE code_embeddings_p11 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE code_embeddings_p12 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE code_embeddings_p13 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE code_embeddings_p14 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE code_embeddings_p15 PARTITION OF code_embeddings FOR VALUES WITH (MODULUS 16, REMAINDER 15);

INSERT INTO code_embeddings SELECT * FROM code_embeddings_old;

CREATE INDEX idx_code_embeddings_project ON code_embeddings (project_id);
CREATE INDEX idx_code_embeddings_file ON code_embeddings (project_id, file_path);
CREATE INDEX idx_code_embeddings_updated ON code_embeddings (updated_at);

DROP TABLE code_embeddings_old;

-- ──────────────────────────────────────────────────────────────
-- Auto-partition creation function for session_events
-- Call monthly via cron to create future partitions
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_session_events_partition()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  partition_date DATE;
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  -- Create partitions for the next 3 months
  FOR i IN 0..2 LOOP
    partition_date := date_trunc('month', NOW() + (i || ' months')::interval);
    partition_name := 'session_events_' || to_char(partition_date, 'YYYY_MM');
    start_date := partition_date;
    end_date := partition_date + interval '1 month';

    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = partition_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF session_events FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
      );
      RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
  END LOOP;
END;
$$;

-- Auto-partition creation function for audit_logs
CREATE OR REPLACE FUNCTION create_audit_logs_partition()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  partition_date DATE;
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
  quarter_num INT;
BEGIN
  -- Create partitions for the next 2 quarters
  FOR i IN 0..1 LOOP
    partition_date := date_trunc('quarter', NOW() + (i * 3 || ' months')::interval);
    quarter_num := EXTRACT(QUARTER FROM partition_date);
    partition_name := 'audit_logs_' || to_char(partition_date, 'YYYY') || '_q' || quarter_num;
    start_date := partition_date;
    end_date := partition_date + interval '3 months';

    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = partition_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
      );
      RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
