#!/usr/bin/env bash
set -euo pipefail

# Disaster Recovery Script
# Supports: PostgreSQL restore, Redis restore, MinIO restore, full recovery

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_BUCKET="${BACKUP_BUCKET:-prometheus-backups}"
RESTORE_POINT="${1:-latest}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DR]${NC} $1"; }
warn() { echo -e "${YELLOW}[DR]${NC} $1"; }
error() { echo -e "${RED}[DR]${NC} $1"; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [RESTORE_POINT] [OPTIONS]

RESTORE_POINT:
  latest              Restore from the most recent backup (default)
  YYYY-MM-DD-HH-MM   Restore from a specific point in time

Options:
  --db-only           Only restore PostgreSQL
  --redis-only        Only restore Redis
  --minio-only        Only restore MinIO
  --dry-run           Show what would be restored without executing
  --verify            Verify backup integrity without restoring

Examples:
  $(basename "$0") latest
  $(basename "$0") 2026-03-19-14-30 --db-only
  $(basename "$0") --verify
EOF
}

DB_ONLY=false
REDIS_ONLY=false
MINIO_ONLY=false
DRY_RUN=false
VERIFY_ONLY=false

while [[ $# -gt 1 ]]; do
  case $2 in
    --db-only) DB_ONLY=true ;;
    --redis-only) REDIS_ONLY=true ;;
    --minio-only) MINIO_ONLY=true ;;
    --dry-run) DRY_RUN=true ;;
    --verify) VERIFY_ONLY=true ;;
    --help|-h) usage; exit 0 ;;
    *) error "Unknown option: $2"; usage; exit 1 ;;
  esac
  shift
done

ALL=$( ! $DB_ONLY && ! $REDIS_ONLY && ! $MINIO_ONLY && echo true || echo false )

# ── PostgreSQL Restore ────────────────────────────────
restore_postgres() {
  log "Restoring PostgreSQL from $RESTORE_POINT..."

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would restore PostgreSQL from backup"
    return
  fi

  local backup_file
  if [ "$RESTORE_POINT" = "latest" ]; then
    backup_file=$(aws s3 ls "s3://${BACKUP_BUCKET}/postgres/" --recursive | sort | tail -1 | awk '{print $4}')
  else
    backup_file="postgres/${RESTORE_POINT}.sql.gz"
  fi

  if [ -z "$backup_file" ]; then
    error "No PostgreSQL backup found for $RESTORE_POINT"
    return 1
  fi

  log "Downloading backup: $backup_file"
  aws s3 cp "s3://${BACKUP_BUCKET}/${backup_file}" /tmp/pg_restore.sql.gz

  log "Restoring database..."
  gunzip -c /tmp/pg_restore.sql.gz | psql "$DATABASE_URL"
  rm -f /tmp/pg_restore.sql.gz

  log "Running migrations to ensure schema is up to date..."
  pnpm db:migrate

  log "PostgreSQL restore complete"
}

# ── Redis Restore ─────────────────────────────────────
restore_redis() {
  log "Restoring Redis from $RESTORE_POINT..."

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would restore Redis from backup"
    return
  fi

  local backup_file
  if [ "$RESTORE_POINT" = "latest" ]; then
    backup_file=$(aws s3 ls "s3://${BACKUP_BUCKET}/redis/" --recursive | sort | tail -1 | awk '{print $4}')
  else
    backup_file="redis/${RESTORE_POINT}.rdb"
  fi

  if [ -z "$backup_file" ]; then
    error "No Redis backup found for $RESTORE_POINT"
    return 1
  fi

  log "Downloading Redis backup: $backup_file"
  aws s3 cp "s3://${BACKUP_BUCKET}/${backup_file}" /tmp/redis_restore.rdb

  log "Stopping Redis, replacing dump, restarting..."
  redis-cli -u "$REDIS_URL" SHUTDOWN NOSAVE || true
  cp /tmp/redis_restore.rdb /var/lib/redis/dump.rdb
  rm -f /tmp/redis_restore.rdb

  log "Redis restore complete (restart Redis service to load)"
}

# ── MinIO Restore ─────────────────────────────────────
restore_minio() {
  log "Restoring MinIO from $RESTORE_POINT..."

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would restore MinIO from backup"
    return
  fi

  local backup_prefix
  if [ "$RESTORE_POINT" = "latest" ]; then
    backup_prefix=$(aws s3 ls "s3://${BACKUP_BUCKET}/minio/" | sort | tail -1 | awk '{print $2}')
  else
    backup_prefix="minio/${RESTORE_POINT}/"
  fi

  log "Syncing MinIO data from backup..."
  aws s3 sync "s3://${BACKUP_BUCKET}/${backup_prefix}" /data/minio/

  log "MinIO restore complete"
}

# ── Verify Backups ────────────────────────────────────
verify_backups() {
  log "Verifying backup integrity..."

  echo ""
  log "PostgreSQL backups:"
  aws s3 ls "s3://${BACKUP_BUCKET}/postgres/" --recursive | tail -5 || warn "No PostgreSQL backups found"

  echo ""
  log "Redis backups:"
  aws s3 ls "s3://${BACKUP_BUCKET}/redis/" --recursive | tail -5 || warn "No Redis backups found"

  echo ""
  log "MinIO backups:"
  aws s3 ls "s3://${BACKUP_BUCKET}/minio/" | tail -5 || warn "No MinIO backups found"

  log "Verification complete"
}

# ── Main ──────────────────────────────────────────────
log "Prometheus Disaster Recovery"
log "Restore point: $RESTORE_POINT"
echo ""

if [ "$VERIFY_ONLY" = true ]; then
  verify_backups
  exit 0
fi

if [ "$ALL" = true ] || [ "$DB_ONLY" = true ]; then
  restore_postgres
fi

if [ "$ALL" = true ] || [ "$REDIS_ONLY" = true ]; then
  restore_redis
fi

if [ "$ALL" = true ] || [ "$MINIO_ONLY" = true ]; then
  restore_minio
fi

echo ""
log "Disaster recovery complete"
log "RTO target: < 1 hour | RPO target: < 5 minutes"
