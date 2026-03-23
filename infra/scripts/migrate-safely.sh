#!/usr/bin/env bash
set -euo pipefail

# Safe database migration script
# 1. Creates backup before migration
# 2. Runs migration with dry-run option
# 3. Applies migration
# 4. Verifies schema
# 5. Supports rollback
#
# Usage:
#   ./migrate-safely.sh                  # Full migration with backup
#   ./migrate-safely.sh --dry-run        # Preview only, no changes applied
#   ./migrate-safely.sh --backup-only    # Create backup without migrating
#   ./migrate-safely.sh --rollback       # Restore from latest backup

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Parse arguments ──────────────────────────────────────────────────────────

DRY_RUN=false
BACKUP_ONLY=false
ROLLBACK=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --backup-only)
      BACKUP_ONLY=true
      ;;
    --rollback)
      ROLLBACK=true
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--dry-run] [--backup-only] [--rollback]"
      exit 1
      ;;
  esac
done

# ─── Configuration ────────────────────────────────────────────────────────────

DB_URL="${DATABASE_URL:?DATABASE_URL environment variable is required}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/prometheus-db-backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
LOG_FILE="/tmp/prometheus-migration_${TIMESTAMP}.log"

echo "============================================"
echo "  Prometheus Safe Database Migration"
echo "============================================"
echo "Timestamp : ${TIMESTAMP}"
echo "Dry-run   : ${DRY_RUN}"
echo "Backup-only: ${BACKUP_ONLY}"
echo "Rollback  : ${ROLLBACK}"
echo ""

# ─── Helper functions ─────────────────────────────────────────────────────────

create_backup() {
  echo "--- Creating Database Backup ---"
  mkdir -p "$BACKUP_DIR"

  if pg_dump "$DB_URL" --no-owner --no-privileges 2>/dev/null | gzip > "$BACKUP_FILE"; then
    local size
    size=$(ls -lh "$BACKUP_FILE" 2>/dev/null | awk '{print $5}')
    echo "Backup created: ${BACKUP_FILE} (${size})"
  else
    echo "ERROR: Backup failed!"
    rm -f "$BACKUP_FILE"
    exit 1
  fi
}

find_latest_backup() {
  local latest
  latest=$(ls -t "$BACKUP_DIR"/backup_*.sql.gz 2>/dev/null | head -1)
  echo "$latest"
}

restore_backup() {
  local backup_path="${1:-}"

  if [ -z "$backup_path" ]; then
    backup_path=$(find_latest_backup)
  fi

  if [ -z "$backup_path" ] || [ ! -f "$backup_path" ]; then
    echo "ERROR: No backup file found to restore."
    echo "Checked: ${BACKUP_DIR}/backup_*.sql.gz"
    exit 1
  fi

  echo "--- Restoring from Backup ---"
  echo "Backup file: ${backup_path}"
  echo ""
  echo "WARNING: This will overwrite the current database."
  echo "Press Ctrl+C within 5 seconds to abort..."
  sleep 5

  if gunzip -c "$backup_path" | psql "$DB_URL" > /dev/null 2>&1; then
    echo "Restore completed successfully."
  else
    echo "ERROR: Restore failed!"
    exit 1
  fi
}

verify_schema() {
  echo "--- Verifying Schema ---"
  cd "$PROJECT_ROOT"

  if pnpm db:check 2>&1 | tee -a "$LOG_FILE"; then
    echo "Schema verification passed."
  else
    echo "WARNING: Schema verification reported issues."
    echo "Check log: ${LOG_FILE}"
    return 1
  fi
}

run_migration() {
  echo "--- Running Migration ---"
  cd "$PROJECT_ROOT"

  if pnpm db:migrate 2>&1 | tee -a "$LOG_FILE"; then
    echo "Migration completed successfully."
  else
    echo ""
    echo "MIGRATION FAILED!"
    echo "Backup available at: ${BACKUP_FILE}"
    echo "To restore: $0 --rollback"
    echo "Log: ${LOG_FILE}"
    exit 1
  fi
}

pre_flight_checks() {
  echo "--- Pre-Flight Checks ---"

  # Check pg_dump is available
  if ! command -v pg_dump &> /dev/null; then
    echo "WARNING: pg_dump not found. Backup will be skipped."
  fi

  # Check psql is available
  if ! command -v psql &> /dev/null; then
    echo "WARNING: psql not found. Some checks will be skipped."
    return 0
  fi

  # Check for long-running transactions
  local long_tx
  long_tx=$(psql "$DB_URL" -t -c \
    "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - INTERVAL '5 minutes'" \
    2>/dev/null || echo "0")
  long_tx=$(echo "$long_tx" | tr -d ' ')

  if [ "$long_tx" -gt 0 ]; then
    echo "WARNING: ${long_tx} long-running transaction(s) detected."
    echo "Consider waiting for them to complete before migrating."
  fi

  # Check current table count
  local table_count
  table_count=$(psql "$DB_URL" -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" \
    2>/dev/null || echo "unknown")
  table_count=$(echo "$table_count" | tr -d ' ')
  echo "Current tables: ${table_count}"

  echo "Pre-flight checks passed."
}

# ─── Main ─────────────────────────────────────────────────────────────────────

# Handle rollback mode
if [ "$ROLLBACK" = true ]; then
  restore_backup
  echo ""
  verify_schema || true
  echo ""
  echo "=== Rollback Complete ==="
  exit 0
fi

# Pre-flight checks
pre_flight_checks
echo ""

# Create backup
create_backup
echo ""

# Handle backup-only mode
if [ "$BACKUP_ONLY" = true ]; then
  echo "=== Backup Complete (no migration applied) ==="
  exit 0
fi

# Handle dry-run mode
if [ "$DRY_RUN" = true ]; then
  echo "--- Dry Run Mode ---"
  echo "Would run: pnpm db:migrate"
  echo "Backup created at: ${BACKUP_FILE}"
  echo ""

  # Still verify current schema state
  verify_schema || true

  echo ""
  echo "=== Dry Run Complete (no changes applied) ==="
  exit 0
fi

# Full migration
run_migration
echo ""

# Post-migration verification
verify_schema || {
  echo ""
  echo "Schema verification failed after migration."
  echo "To rollback: $0 --rollback"
  echo "Backup: ${BACKUP_FILE}"
  exit 1
}

echo ""
echo "============================================"
echo "  Migration Complete"
echo "============================================"
echo "Backup : ${BACKUP_FILE}"
echo "Log    : ${LOG_FILE}"
echo ""
