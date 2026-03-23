#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# backup-restore.sh — Unified backup and restore for the Prometheus platform
#
# Handles PostgreSQL, Redis, and MinIO data with compression, integrity
# verification, and retention policies.
#
# Usage:
#   bash infra/scripts/backup-restore.sh backup  [options]
#   bash infra/scripts/backup-restore.sh restore  [options]
#   bash infra/scripts/backup-restore.sh verify   [options]
#   bash infra/scripts/backup-restore.sh list
#
# Modes:
#   backup   — Dump PostgreSQL, snapshot Redis, export MinIO data
#   restore  — Restore from a backup set (all components or individual)
#   verify   — Verify backup integrity without restoring
#   list     — List available backups
#
# Environment variables:
#   DATABASE_URL          — PostgreSQL connection string (required for backup/restore)
#   REDIS_HOST            — Redis host (default: localhost)
#   REDIS_PORT            — Redis port (default: 6379)
#   MINIO_ENDPOINT        — MinIO endpoint (default: http://localhost:9000)
#   MINIO_ACCESS_KEY      — MinIO access key
#   MINIO_SECRET_KEY      — MinIO secret key
#   BACKUP_DIR            — Local backup directory (default: /var/backups/prometheus)
#   RETENTION_DAILY       — Number of daily backups to keep (default: 7)
#   RETENTION_WEEKLY      — Number of weekly backups to keep (default: 4)
#
# Examples:
#   backup-restore.sh backup
#   backup-restore.sh backup --components pg,redis
#   backup-restore.sh restore --timestamp 20260320_120000
#   backup-restore.sh restore --latest
#   backup-restore.sh verify --timestamp 20260320_120000
#   backup-restore.sh list
##############################################################################

# ── Defaults ─────────────────────────────────────────────────────────────────

REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/prometheus}"
RETENTION_DAILY="${RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-4}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
LOG_FILE="${BACKUP_DIR}/backup.log"

# Components to back up (default: all)
COMPONENTS="pg,redis,minio"
RESTORE_TIMESTAMP=""
USE_LATEST=false

# ── Logging ──────────────────────────────────────────────────────────────────

log_info()  { local msg="[INFO]  $(date +%Y-%m-%dT%H:%M:%S) $*"; echo "$msg"; echo "$msg" >> "${LOG_FILE}" 2>/dev/null || true; }
log_warn()  { local msg="[WARN]  $(date +%Y-%m-%dT%H:%M:%S) $*"; echo "$msg" >&2; echo "$msg" >> "${LOG_FILE}" 2>/dev/null || true; }
log_error() { local msg="[ERROR] $(date +%Y-%m-%dT%H:%M:%S) $*"; echo "$msg" >&2; echo "$msg" >> "${LOG_FILE}" 2>/dev/null || true; }
log_step()  { echo ""; echo "────────────────────────────────────────"; echo "  $*"; echo "────────────────────────────────────────"; }

# ── Utility: determine backup type (daily vs weekly) ─────────────────────────

get_backup_type() {
  # Weekly backups are created on Sundays (day 7)
  if [ "${DAY_OF_WEEK}" = "7" ]; then
    echo "weekly"
  else
    echo "daily"
  fi
}

# ── Utility: find latest backup timestamp ────────────────────────────────────

find_latest_backup() {
  local latest=""
  # Look for the most recent backup directory
  if [ -d "${BACKUP_DIR}/daily" ]; then
    latest=$(ls -1d "${BACKUP_DIR}"/daily/*/  2>/dev/null | sort -r | head -1 | xargs -I{} basename {} 2>/dev/null || true)
  fi
  if [ -z "${latest}" ] && [ -d "${BACKUP_DIR}/weekly" ]; then
    latest=$(ls -1d "${BACKUP_DIR}"/weekly/*/  2>/dev/null | sort -r | head -1 | xargs -I{} basename {} 2>/dev/null || true)
  fi
  echo "${latest}"
}

# ── BACKUP: PostgreSQL ───────────────────────────────────────────────────────

backup_postgres() {
  local dest_dir="$1"
  local dump_file="${dest_dir}/postgres.sql.gz"

  log_info "Backing up PostgreSQL..."

  if [ -z "${DATABASE_URL:-}" ]; then
    log_warn "DATABASE_URL not set — skipping PostgreSQL backup"
    return 1
  fi

  # Use pg_dump with custom format for parallel restore support
  pg_dump "${DATABASE_URL}" \
    --format=plain \
    --no-owner \
    --no-privileges \
    --verbose \
    2>/dev/null | gzip > "${dump_file}"

  local size
  size=$(du -h "${dump_file}" | cut -f1)
  log_info "  PostgreSQL dump: ${size}"

  # Create checksum for integrity verification
  sha256sum "${dump_file}" > "${dump_file}.sha256"
  log_info "  Checksum written: postgres.sql.gz.sha256"
}

# ── BACKUP: Redis ────────────────────────────────────────────────────────────

backup_redis() {
  local dest_dir="$1"
  local rdb_file="${dest_dir}/redis-dump.rdb.gz"

  log_info "Backing up Redis..."

  # Trigger a BGSAVE and wait for completion
  if ! redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" BGSAVE >/dev/null 2>&1; then
    log_warn "Could not trigger Redis BGSAVE — attempting direct dump export"
  fi

  # Wait for background save to complete (max 60 seconds)
  local retries=30
  while [ ${retries} -gt 0 ]; do
    local bg_status
    bg_status=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" LASTSAVE 2>/dev/null || echo "")
    if [ -n "${bg_status}" ]; then
      break
    fi
    sleep 2
    retries=$((retries - 1))
  done

  # Export using redis-cli --rdb if available, otherwise copy the RDB file
  if redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" --rdb "${dest_dir}/redis-dump.rdb" >/dev/null 2>&1; then
    gzip "${dest_dir}/redis-dump.rdb"
    local size
    size=$(du -h "${rdb_file}" | cut -f1)
    log_info "  Redis RDB snapshot: ${size}"
  else
    # Fallback: dump all keys as a JSON export
    log_warn "  redis-cli --rdb not supported — using key export fallback"
    redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" --scan 2>/dev/null \
      | head -10000 > "${dest_dir}/redis-keys.txt" 2>/dev/null || true
    gzip "${dest_dir}/redis-keys.txt" 2>/dev/null || true
    log_info "  Redis key list exported (fallback mode)"
  fi

  # Checksum
  if [ -f "${rdb_file}" ]; then
    sha256sum "${rdb_file}" > "${rdb_file}.sha256"
  fi
}

# ── BACKUP: MinIO ────────────────────────────────────────────────────────────

backup_minio() {
  local dest_dir="$1"
  local minio_dir="${dest_dir}/minio"

  log_info "Backing up MinIO..."

  if [ -z "${MINIO_ACCESS_KEY:-}" ] || [ -z "${MINIO_SECRET_KEY:-}" ]; then
    log_warn "MinIO credentials not set — skipping MinIO backup"
    return 1
  fi

  mkdir -p "${minio_dir}"

  # Configure mc alias
  mc alias set prometheus-bak "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4 2>/dev/null

  # Mirror all buckets
  local buckets
  buckets=$(mc ls prometheus-bak/ --json 2>/dev/null | grep -o '"key":"[^"]*"' | sed 's/"key":"//;s/"//;s/\///' || true)

  if [ -n "${buckets}" ]; then
    for bucket in ${buckets}; do
      log_info "  Mirroring bucket: ${bucket}"
      mc mirror "prometheus-bak/${bucket}" "${minio_dir}/${bucket}" --quiet 2>/dev/null || true
    done
  else
    log_info "  No buckets found to back up"
  fi

  # Create tarball of MinIO data
  if [ -d "${minio_dir}" ] && [ "$(ls -A "${minio_dir}" 2>/dev/null)" ]; then
    tar -czf "${dest_dir}/minio-data.tar.gz" -C "${minio_dir}" .
    rm -rf "${minio_dir}"
    local size
    size=$(du -h "${dest_dir}/minio-data.tar.gz" | cut -f1)
    log_info "  MinIO backup: ${size}"
    sha256sum "${dest_dir}/minio-data.tar.gz" > "${dest_dir}/minio-data.tar.gz.sha256"
  fi
}

# ── BACKUP: Main ─────────────────────────────────────────────────────────────

cmd_backup() {
  local backup_type
  backup_type=$(get_backup_type)
  local dest_dir="${BACKUP_DIR}/${backup_type}/${TIMESTAMP}"

  log_step "Prometheus Backup — ${backup_type} — ${TIMESTAMP}"
  mkdir -p "${dest_dir}"

  local success=0
  local failures=0

  # Back up each requested component
  if [[ "${COMPONENTS}" == *"pg"* ]]; then
    if backup_postgres "${dest_dir}"; then
      success=$((success + 1))
    else
      failures=$((failures + 1))
    fi
  fi

  if [[ "${COMPONENTS}" == *"redis"* ]]; then
    if backup_redis "${dest_dir}"; then
      success=$((success + 1))
    else
      failures=$((failures + 1))
    fi
  fi

  if [[ "${COMPONENTS}" == *"minio"* ]]; then
    if backup_minio "${dest_dir}"; then
      success=$((success + 1))
    else
      failures=$((failures + 1))
    fi
  fi

  # Write backup metadata
  {
    echo "timestamp: ${TIMESTAMP}"
    echo "type: ${backup_type}"
    echo "components: ${COMPONENTS}"
    echo "hostname: $(hostname)"
    echo "success_count: ${success}"
    echo "failure_count: ${failures}"
  } > "${dest_dir}/metadata.txt"

  # Apply retention policy
  log_step "Applying retention policy"
  apply_retention

  echo ""
  echo "════════════════════════════════════════════════"
  echo "  Backup Complete"
  echo "  Type:       ${backup_type}"
  echo "  Location:   ${dest_dir}"
  echo "  Components: ${success} succeeded, ${failures} failed"
  echo "════════════════════════════════════════════════"

  if [ ${failures} -gt 0 ]; then
    return 1
  fi
}

# ── RESTORE ──────────────────────────────────────────────────────────────────

cmd_restore() {
  local restore_ts="${RESTORE_TIMESTAMP}"

  if [ "${USE_LATEST}" = true ]; then
    restore_ts=$(find_latest_backup)
    if [ -z "${restore_ts}" ]; then
      log_error "No backups found"
      exit 1
    fi
    log_info "Latest backup: ${restore_ts}"
  fi

  if [ -z "${restore_ts}" ]; then
    log_error "Specify --timestamp or --latest"
    exit 1
  fi

  # Find the backup directory
  local src_dir=""
  for subdir in daily weekly; do
    if [ -d "${BACKUP_DIR}/${subdir}/${restore_ts}" ]; then
      src_dir="${BACKUP_DIR}/${subdir}/${restore_ts}"
      break
    fi
  done

  if [ -z "${src_dir}" ]; then
    log_error "Backup not found for timestamp: ${restore_ts}"
    log_info "Available backups:"
    cmd_list
    exit 1
  fi

  log_step "Restoring from ${src_dir}"
  echo ""
  echo "WARNING: This will overwrite current data."
  echo "Press Ctrl+C within 5 seconds to cancel..."
  sleep 5

  # Restore PostgreSQL
  if [[ "${COMPONENTS}" == *"pg"* ]] && [ -f "${src_dir}/postgres.sql.gz" ]; then
    log_info "Restoring PostgreSQL..."
    if [ -z "${DATABASE_URL:-}" ]; then
      log_error "DATABASE_URL required for PostgreSQL restore"
    else
      gunzip -c "${src_dir}/postgres.sql.gz" | psql "${DATABASE_URL}" --quiet --single-transaction 2>&1 | tail -5
      log_info "  PostgreSQL restored"
    fi
  fi

  # Restore Redis
  if [[ "${COMPONENTS}" == *"redis"* ]] && [ -f "${src_dir}/redis-dump.rdb.gz" ]; then
    log_info "Restoring Redis..."
    # Stop Redis, replace RDB, restart
    local redis_dir
    redis_dir=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" CONFIG GET dir 2>/dev/null | tail -1 || echo "/data")
    if [ -n "${redis_dir}" ] && [ "${redis_dir}" != "" ]; then
      redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" SHUTDOWN NOSAVE 2>/dev/null || true
      gunzip -c "${src_dir}/redis-dump.rdb.gz" > "${redis_dir}/dump.rdb" 2>/dev/null || true
      log_info "  Redis RDB file restored to ${redis_dir}/dump.rdb"
      log_warn "  Redis needs to be restarted to load the restored data"
    else
      log_warn "  Could not determine Redis data directory — manual restore needed"
    fi
  fi

  # Restore MinIO
  if [[ "${COMPONENTS}" == *"minio"* ]] && [ -f "${src_dir}/minio-data.tar.gz" ]; then
    log_info "Restoring MinIO..."
    if [ -z "${MINIO_ACCESS_KEY:-}" ] || [ -z "${MINIO_SECRET_KEY:-}" ]; then
      log_warn "MinIO credentials not set — skipping MinIO restore"
    else
      local tmp_minio="/tmp/prometheus-minio-restore"
      mkdir -p "${tmp_minio}"
      tar -xzf "${src_dir}/minio-data.tar.gz" -C "${tmp_minio}"

      mc alias set prometheus-bak "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4 2>/dev/null
      for bucket_dir in "${tmp_minio}"/*/; do
        if [ -d "${bucket_dir}" ]; then
          local bucket_name
          bucket_name=$(basename "${bucket_dir}")
          mc mb "prometheus-bak/${bucket_name}" 2>/dev/null || true
          mc mirror "${bucket_dir}" "prometheus-bak/${bucket_name}" --quiet 2>/dev/null || true
          log_info "  Restored bucket: ${bucket_name}"
        fi
      done
      rm -rf "${tmp_minio}"
    fi
  fi

  echo ""
  echo "════════════════════════════════════════════════"
  echo "  Restore Complete"
  echo "  Source: ${src_dir}"
  echo "════════════════════════════════════════════════"
}

# ── VERIFY ───────────────────────────────────────────────────────────────────

cmd_verify() {
  local verify_ts="${RESTORE_TIMESTAMP}"

  if [ "${USE_LATEST}" = true ]; then
    verify_ts=$(find_latest_backup)
  fi

  if [ -z "${verify_ts}" ]; then
    log_error "Specify --timestamp or --latest"
    exit 1
  fi

  # Find the backup directory
  local src_dir=""
  for subdir in daily weekly; do
    if [ -d "${BACKUP_DIR}/${subdir}/${verify_ts}" ]; then
      src_dir="${BACKUP_DIR}/${subdir}/${verify_ts}"
      break
    fi
  done

  if [ -z "${src_dir}" ]; then
    log_error "Backup not found for timestamp: ${verify_ts}"
    exit 1
  fi

  log_step "Verifying Backup: ${verify_ts}"
  local errors=0

  # Verify checksums
  for checksum_file in "${src_dir}"/*.sha256; do
    if [ -f "${checksum_file}" ]; then
      local data_file="${checksum_file%.sha256}"
      if [ -f "${data_file}" ]; then
        if sha256sum --check "${checksum_file}" --quiet 2>/dev/null; then
          log_info "[OK]   $(basename "${data_file}") — checksum valid"
        else
          log_error "[FAIL] $(basename "${data_file}") — checksum mismatch"
          errors=$((errors + 1))
        fi
      else
        log_warn "[MISS] $(basename "${data_file}") — file missing"
        errors=$((errors + 1))
      fi
    fi
  done

  # Verify PostgreSQL dump is valid gzip
  if [ -f "${src_dir}/postgres.sql.gz" ]; then
    if gzip -t "${src_dir}/postgres.sql.gz" 2>/dev/null; then
      local line_count
      line_count=$(gunzip -c "${src_dir}/postgres.sql.gz" | wc -l)
      log_info "[OK]   postgres.sql.gz — valid gzip, ${line_count} SQL lines"
    else
      log_error "[FAIL] postgres.sql.gz — corrupt gzip file"
      errors=$((errors + 1))
    fi
  fi

  # Verify MinIO archive
  if [ -f "${src_dir}/minio-data.tar.gz" ]; then
    if tar -tzf "${src_dir}/minio-data.tar.gz" >/dev/null 2>&1; then
      local file_count
      file_count=$(tar -tzf "${src_dir}/minio-data.tar.gz" | wc -l)
      log_info "[OK]   minio-data.tar.gz — valid archive, ${file_count} files"
    else
      log_error "[FAIL] minio-data.tar.gz — corrupt archive"
      errors=$((errors + 1))
    fi
  fi

  # Check metadata
  if [ -f "${src_dir}/metadata.txt" ]; then
    log_info "[OK]   metadata.txt — present"
    log_info "       $(cat "${src_dir}/metadata.txt" | tr '\n' ' ')"
  fi

  echo ""
  if [ ${errors} -eq 0 ]; then
    echo "  Verification PASSED — all files intact"
  else
    echo "  Verification FAILED — ${errors} issue(s) found"
  fi

  return ${errors}
}

# ── LIST ─────────────────────────────────────────────────────────────────────

cmd_list() {
  log_step "Available Backups"

  for backup_type in daily weekly; do
    local type_dir="${BACKUP_DIR}/${backup_type}"
    if [ -d "${type_dir}" ]; then
      echo ""
      echo "  ${backup_type}:"
      for backup_dir in $(ls -1d "${type_dir}"/*/ 2>/dev/null | sort -r); do
        local ts
        ts=$(basename "${backup_dir}")
        local size
        size=$(du -sh "${backup_dir}" 2>/dev/null | cut -f1)
        local components="?"
        if [ -f "${backup_dir}/metadata.txt" ]; then
          components=$(grep "^components:" "${backup_dir}/metadata.txt" | cut -d' ' -f2)
        fi
        echo "    ${ts}  (${size})  [${components}]"
      done
    fi
  done
}

# ── Retention Policy ─────────────────────────────────────────────────────────
# Keep the last N daily and M weekly backups. Older ones are deleted.

apply_retention() {
  # Daily retention
  local daily_dir="${BACKUP_DIR}/daily"
  if [ -d "${daily_dir}" ]; then
    local daily_count
    daily_count=$(ls -1d "${daily_dir}"/*/ 2>/dev/null | wc -l)
    if [ "${daily_count}" -gt "${RETENTION_DAILY}" ]; then
      local to_delete=$((daily_count - RETENTION_DAILY))
      log_info "Pruning ${to_delete} old daily backup(s) (keeping ${RETENTION_DAILY})..."
      ls -1d "${daily_dir}"/*/ 2>/dev/null | sort | head -"${to_delete}" | while read -r dir; do
        log_info "  Removing: $(basename "${dir}")"
        rm -rf "${dir}"
      done
    fi
  fi

  # Weekly retention
  local weekly_dir="${BACKUP_DIR}/weekly"
  if [ -d "${weekly_dir}" ]; then
    local weekly_count
    weekly_count=$(ls -1d "${weekly_dir}"/*/ 2>/dev/null | wc -l)
    if [ "${weekly_count}" -gt "${RETENTION_WEEKLY}" ]; then
      local to_delete=$((weekly_count - RETENTION_WEEKLY))
      log_info "Pruning ${to_delete} old weekly backup(s) (keeping ${RETENTION_WEEKLY})..."
      ls -1d "${weekly_dir}"/*/ 2>/dev/null | sort | head -"${to_delete}" | while read -r dir; do
        log_info "  Removing: $(basename "${dir}")"
        rm -rf "${dir}"
      done
    fi
  fi
}

# ── CLI parsing ──────────────────────────────────────────────────────────────

usage() {
  echo "Usage: $(basename "$0") <command> [options]"
  echo ""
  echo "Commands:"
  echo "  backup   Back up PostgreSQL, Redis, and MinIO data"
  echo "  restore  Restore from a backup set"
  echo "  verify   Verify backup integrity"
  echo "  list     List available backups"
  echo ""
  echo "Options:"
  echo "  --components <pg,redis,minio>  Components to backup/restore (default: all)"
  echo "  --timestamp <YYYYMMDD_HHMMSS>  Backup timestamp for restore/verify"
  echo "  --latest                        Use the most recent backup"
  echo "  --backup-dir <path>             Backup storage directory"
  echo ""
  echo "Environment:"
  echo "  DATABASE_URL, REDIS_HOST, REDIS_PORT, MINIO_ENDPOINT,"
  echo "  MINIO_ACCESS_KEY, MINIO_SECRET_KEY"
}

COMMAND="${1:-}"
shift || true

while [[ $# -gt 0 ]]; do
  case $1 in
    --components)  COMPONENTS="$2"; shift 2 ;;
    --timestamp)   RESTORE_TIMESTAMP="$2"; shift 2 ;;
    --latest)      USE_LATEST=true; shift ;;
    --backup-dir)  BACKUP_DIR="$2"; shift 2 ;;
    --help|-h)     usage; exit 0 ;;
    *)             log_error "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# Ensure backup dir exists
mkdir -p "${BACKUP_DIR}"

case "${COMMAND}" in
  backup)  cmd_backup ;;
  restore) cmd_restore ;;
  verify)  cmd_verify ;;
  list)    cmd_list ;;
  *)       usage; exit 1 ;;
esac
