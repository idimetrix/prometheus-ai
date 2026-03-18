#!/usr/bin/env bash
set -euo pipefail

# Point-in-Time Recovery Script
# Usage: ./pitr-restore.sh <target-timestamp>

TARGET="${1:?Usage: pitr-restore.sh <target-timestamp> (e.g., '2026-03-18 14:30:00')}"
DB_URL="${DATABASE_URL:?DATABASE_URL required}"
WAL_ARCHIVE="${WAL_ARCHIVE_PATH:-/var/lib/postgresql/wal-archive}"

echo "=== Point-in-Time Recovery ==="
echo "Target: ${TARGET}"
echo ""

echo "This will restore the database to: ${TARGET}"
echo "Current data WILL BE LOST."
read -p "Type 'restore' to confirm: " CONFIRM
[ "$CONFIRM" != "restore" ] && echo "Aborted." && exit 1

# Stop PostgreSQL
echo "Stopping PostgreSQL..."
pg_ctl stop -D /var/lib/postgresql/data 2>/dev/null || true

# Create recovery.conf
cat > /var/lib/postgresql/data/recovery.conf << EOF
restore_command = 'cp ${WAL_ARCHIVE}/%f %p'
recovery_target_time = '${TARGET}'
recovery_target_action = 'promote'
EOF

# Start PostgreSQL in recovery mode
echo "Starting recovery..."
pg_ctl start -D /var/lib/postgresql/data -w

echo "=== Recovery initiated. Check logs for completion. ==="
