#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# restore.sh - Restore PostgreSQL from MinIO backup
#
# Usage:
#   bash infra/backup/restore.sh <backup-file>
#   bash infra/backup/restore.sh prometheus_20260318_120000.sql.gz
#   bash infra/backup/restore.sh --latest
#
# Environment variables:
#   DATABASE_URL    - PostgreSQL connection string
#   MINIO_ENDPOINT  - MinIO endpoint (default: http://localhost:9000)
#   MINIO_ACCESS_KEY
#   MINIO_SECRET_KEY
#   MINIO_BUCKET    - Source bucket (default: prometheus-backups)
##############################################################################

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_BUCKET="${MINIO_BUCKET:-prometheus-backups}"
BACKUP_DIR="/tmp/prometheus-restore"
BACKUP_FILE=""
USE_LATEST=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --latest)   USE_LATEST=true; shift ;;
    --database) DATABASE_URL="$2"; shift 2 ;;
    --bucket)   MINIO_BUCKET="$2"; shift 2 ;;
    --endpoint) MINIO_ENDPOINT="$2"; shift 2 ;;
    *)          BACKUP_FILE="$1"; shift ;;
  esac
done

# Validate
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required."
  exit 1
fi

if [ -z "${MINIO_ACCESS_KEY:-}" ] || [ -z "${MINIO_SECRET_KEY:-}" ]; then
  echo "ERROR: MINIO_ACCESS_KEY and MINIO_SECRET_KEY are required."
  exit 1
fi

if [ "$USE_LATEST" = false ] && [ -z "${BACKUP_FILE}" ]; then
  echo "ERROR: Specify a backup file or use --latest"
  echo ""
  echo "Usage:"
  echo "  bash infra/backup/restore.sh <backup-file>"
  echo "  bash infra/backup/restore.sh --latest"
  exit 1
fi

# Configure MinIO
mc alias set prometheus-backup "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4 2>/dev/null

# Find latest backup if requested
if [ "$USE_LATEST" = true ]; then
  echo "Finding latest backup..."
  BACKUP_FILE=$(mc ls "prometheus-backup/${MINIO_BUCKET}/database/" --json 2>/dev/null \
    | grep -o '"key":"[^"]*"' | sed 's/"key":"//;s/"//' \
    | sort -r | head -1)

  if [ -z "${BACKUP_FILE}" ]; then
    echo "ERROR: No backups found in ${MINIO_BUCKET}/database/"
    exit 1
  fi
  echo "  Latest backup: ${BACKUP_FILE}"
fi

echo ""
echo "============================================"
echo "  Prometheus Database Restore"
echo "  Backup: ${BACKUP_FILE}"
echo "  Bucket: ${MINIO_BUCKET}"
echo "============================================"
echo ""

# Safety prompt
echo "WARNING: This will overwrite the current database."
echo "Press Ctrl+C within 5 seconds to cancel..."
sleep 5
echo ""

mkdir -p "${BACKUP_DIR}"

# Step 1: Download backup
echo "[1/3] Downloading backup from MinIO..."
mc cp "prometheus-backup/${MINIO_BUCKET}/database/${BACKUP_FILE}" "${BACKUP_DIR}/${BACKUP_FILE}"
echo "  Downloaded: ${BACKUP_FILE}"

# Step 2: Decompress and restore
echo "[2/3] Restoring database..."
if [[ "${BACKUP_FILE}" == *.gz ]]; then
  gunzip -c "${BACKUP_DIR}/${BACKUP_FILE}" | psql "${DATABASE_URL}" --quiet --single-transaction 2>&1 | tail -5
else
  psql "${DATABASE_URL}" --quiet --single-transaction < "${BACKUP_DIR}/${BACKUP_FILE}" 2>&1 | tail -5
fi
echo "  Database restored"

# Step 3: Verify
echo "[3/3] Verifying restore..."
TABLE_COUNT=$(psql "${DATABASE_URL}" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
echo "  Tables in database: ${TABLE_COUNT}"

# Clean up
rm -rf "${BACKUP_DIR}"

echo ""
echo "============================================"
echo "  Restore complete!"
echo "  Source: ${BACKUP_FILE}"
echo "  Tables: ${TABLE_COUNT}"
echo "============================================"
