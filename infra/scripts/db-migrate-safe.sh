#!/usr/bin/env bash
set -euo pipefail

# Safe Database Migration Script
# Usage: ./db-migrate-safe.sh [--allow-destructive]

ALLOW_DESTRUCTIVE=false
if [ "${1:-}" = "--allow-destructive" ]; then
  ALLOW_DESTRUCTIVE=true
fi

DB_URL="${DATABASE_URL:?DATABASE_URL environment variable required}"
BACKUP_DIR="/tmp/db-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== Safe Database Migration ==="
echo "Timestamp: ${TIMESTAMP}"

# Pre-checks
echo ""
echo "--- Pre-Migration Checks ---"

# Check for long-running transactions
echo "Checking for long-running transactions..."
LONG_TX=$(psql "$DB_URL" -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - INTERVAL '5 minutes'" 2>/dev/null || echo "0")
LONG_TX=$(echo "$LONG_TX" | tr -d ' ')
if [ "$LONG_TX" -gt 0 ]; then
  echo "WARNING: ${LONG_TX} long-running transactions detected. Consider waiting."
fi

# Check disk space
echo "Checking available disk space..."
DISK_FREE=$(df -P /var/lib/postgresql 2>/dev/null | tail -1 | awk '{print $4}' || echo "unknown")
echo "Available disk: ${DISK_FREE}KB"

# Create backup
echo ""
echo "--- Creating Pre-Migration Backup ---"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/pre-migrate_${TIMESTAMP}.sql.gz"
echo "Backing up to ${BACKUP_FILE}..."
pg_dump "$DB_URL" --no-owner --no-privileges 2>/dev/null | gzip > "$BACKUP_FILE" || {
  echo "WARNING: Backup failed. Proceeding with caution."
}
if [ -f "$BACKUP_FILE" ]; then
  BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
  echo "Backup created: ${BACKUP_SIZE}"
fi

# Check for destructive operations in pending migrations
echo ""
echo "--- Checking Migration Safety ---"
MIGRATION_FILES=$(find packages/db/src/migrations -name "*.sql" -newer "$BACKUP_FILE" 2>/dev/null || true)
if [ -n "$MIGRATION_FILES" ]; then
  DESTRUCTIVE=$(grep -il "DROP\|TRUNCATE\|DELETE FROM\|ALTER.*DROP" $MIGRATION_FILES 2>/dev/null || true)
  if [ -n "$DESTRUCTIVE" ] && [ "$ALLOW_DESTRUCTIVE" = false ]; then
    echo "BLOCKED: Destructive operations detected in migrations:"
    echo "$DESTRUCTIVE"
    echo ""
    echo "Re-run with --allow-destructive to proceed."
    exit 1
  fi
fi
echo "Migration safety check passed."

# Run migrations
echo ""
echo "--- Running Migrations ---"
cd "$(dirname "$0")/../.."
pnpm db:migrate 2>&1 | tee "/tmp/migration_${TIMESTAMP}.log"
MIGRATE_EXIT=$?

if [ $MIGRATE_EXIT -ne 0 ]; then
  echo ""
  echo "MIGRATION FAILED! Exit code: ${MIGRATE_EXIT}"
  echo "Backup available at: ${BACKUP_FILE}"
  echo "To restore: gunzip -c ${BACKUP_FILE} | psql ${DB_URL}"
  exit 1
fi

# Post-validation
echo ""
echo "--- Post-Migration Validation ---"

# Verify tables exist
TABLE_COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null || echo "0")
TABLE_COUNT=$(echo "$TABLE_COUNT" | tr -d ' ')
echo "Tables in database: ${TABLE_COUNT}"

echo ""
echo "=== Migration Complete ==="
echo "Backup: ${BACKUP_FILE}"
echo "Log: /tmp/migration_${TIMESTAMP}.log"
