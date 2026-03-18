#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# backup.sh - PostgreSQL backup to MinIO (S3-compatible)
#
# Usage:
#   bash infra/backup/backup.sh
#   bash infra/backup/backup.sh --database prometheus --bucket backups
#
# Environment variables (or flags):
#   DATABASE_URL    - PostgreSQL connection string
#   MINIO_ENDPOINT  - MinIO endpoint (default: http://localhost:9000)
#   MINIO_ACCESS_KEY
#   MINIO_SECRET_KEY
#   MINIO_BUCKET    - Target bucket (default: prometheus-backups)
#   RETENTION_DAYS  - Delete backups older than N days (default: 30)
##############################################################################

# Defaults
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_BUCKET="${MINIO_BUCKET:-prometheus-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/prometheus-backups"
BACKUP_FILE="prometheus_${TIMESTAMP}.sql.gz"

# Parse optional flags
while [[ $# -gt 0 ]]; do
  case $1 in
    --database) DATABASE_URL="$2"; shift 2 ;;
    --bucket)   MINIO_BUCKET="$2"; shift 2 ;;
    --endpoint) MINIO_ENDPOINT="$2"; shift 2 ;;
    --retention) RETENTION_DAYS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Validate required vars
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required."
  echo "  Set it as an environment variable or pass --database <url>"
  exit 1
fi

if [ -z "${MINIO_ACCESS_KEY:-}" ] || [ -z "${MINIO_SECRET_KEY:-}" ]; then
  echo "ERROR: MINIO_ACCESS_KEY and MINIO_SECRET_KEY are required."
  exit 1
fi

echo "============================================"
echo "  Prometheus Database Backup"
echo "  Timestamp:  ${TIMESTAMP}"
echo "  Bucket:     ${MINIO_BUCKET}"
echo "  Retention:  ${RETENTION_DAYS} days"
echo "============================================"
echo ""

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Step 1: Create PostgreSQL dump
echo "[1/4] Creating PostgreSQL dump..."
pg_dump "${DATABASE_URL}" \
  --format=plain \
  --no-owner \
  --no-privileges \
  --verbose \
  2>/dev/null | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"

BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
echo "  Dump created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Step 2: Configure MinIO client alias
echo "[2/4] Configuring MinIO client..."
mc alias set prometheus-backup "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4 2>/dev/null

# Ensure bucket exists
mc mb "prometheus-backup/${MINIO_BUCKET}" 2>/dev/null || true

# Step 3: Upload backup
echo "[3/4] Uploading backup to MinIO..."
mc cp "${BACKUP_DIR}/${BACKUP_FILE}" "prometheus-backup/${MINIO_BUCKET}/database/${BACKUP_FILE}"
echo "  Uploaded to ${MINIO_BUCKET}/database/${BACKUP_FILE}"

# Step 4: Clean up old backups (retention policy)
echo "[4/4] Applying retention policy (${RETENTION_DAYS} days)..."
CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +%Y%m%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y%m%d 2>/dev/null)
DELETED_COUNT=0

if [ -n "${CUTOFF_DATE}" ]; then
  for remote_file in $(mc ls "prometheus-backup/${MINIO_BUCKET}/database/" --json 2>/dev/null | grep -o '"key":"[^"]*"' | sed 's/"key":"//;s/"//'); do
    # Extract date from filename: prometheus_YYYYMMDD_HHMMSS.sql.gz
    FILE_DATE=$(echo "${remote_file}" | grep -oP '\d{8}' | head -1)
    if [ -n "${FILE_DATE}" ] && [ "${FILE_DATE}" -lt "${CUTOFF_DATE}" ]; then
      mc rm "prometheus-backup/${MINIO_BUCKET}/database/${remote_file}" 2>/dev/null
      DELETED_COUNT=$((DELETED_COUNT + 1))
    fi
  done
fi

echo "  Removed ${DELETED_COUNT} old backup(s)"

# Clean up local temp file
rm -f "${BACKUP_DIR}/${BACKUP_FILE}"

echo ""
echo "============================================"
echo "  Backup complete!"
echo "  File: ${BACKUP_FILE}"
echo "  Size: ${BACKUP_SIZE}"
echo "  Location: ${MINIO_BUCKET}/database/${BACKUP_FILE}"
echo "============================================"
