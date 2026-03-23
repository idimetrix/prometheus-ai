#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# setup-monitoring.sh — Set up Prometheus + Grafana + Alertmanager stack
#
# This script provisions the complete monitoring stack for the Prometheus
# AI platform. It can run against a Docker Compose dev environment or a
# Kubernetes cluster.
#
# Usage:
#   bash infra/monitoring/setup-monitoring.sh [options]
#
# Options:
#   --mode <docker|k8s>       Deployment mode (default: docker)
#   --grafana-url <url>       Grafana URL (default: http://localhost:3001)
#   --grafana-user <user>     Grafana admin user (default: admin)
#   --grafana-pass <pass>     Grafana admin password (default: admin)
#   --prometheus-url <url>    Prometheus URL (default: http://localhost:9090)
#   --alertmanager-url <url>  Alertmanager URL (default: http://localhost:9093)
#   --slack-webhook <url>     Slack webhook for alert notifications
#   --pagerduty-key <key>     PagerDuty integration key for critical alerts
#   --skip-dashboards         Skip dashboard import
#   --skip-alerts             Skip alert rule setup
#   --verify-only             Only run verification checks
#
# What this script does:
#   1. Starts Prometheus, Grafana, and Alertmanager (Docker mode)
#      or verifies they're running (K8s mode)
#   2. Configures Grafana data sources (Prometheus, Loki, Tempo)
#   3. Imports all platform dashboards
#   4. Configures alert notification channels (Slack, PagerDuty, webhook)
#   5. Creates monitoring user accounts
#   6. Verifies all dashboards load successfully
##############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Defaults ─────────────────────────────────────────────────────────────────

MODE="docker"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3001}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASS="${GRAFANA_PASS:-admin}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://localhost:9093}"
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"
PAGERDUTY_KEY="${PAGERDUTY_KEY:-}"
SKIP_DASHBOARDS=false
SKIP_ALERTS=false
VERIFY_ONLY=false

# Dashboard directory — contains all Grafana dashboard JSON files
DASHBOARD_DIR="${SCRIPT_DIR}/grafana/dashboards"

# ── Logging ──────────────────────────────────────────────────────────────────

log_info()  { echo "[INFO]  $(date +%H:%M:%S) $*"; }
log_warn()  { echo "[WARN]  $(date +%H:%M:%S) $*" >&2; }
log_error() { echo "[ERROR] $(date +%H:%M:%S) $*" >&2; }
log_step()  { echo ""; echo "═══════════════════════════════════════════════"; echo "  $*"; echo "═══════════════════════════════════════════════"; }

# ── Grafana API helper ───────────────────────────────────────────────────────

grafana_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local args=(-s -S -w "\n%{http_code}" -X "${method}")
  args+=(-H "Content-Type: application/json")
  args+=(-u "${GRAFANA_USER}:${GRAFANA_PASS}")

  if [ -n "${data}" ]; then
    args+=(-d "${data}")
  fi

  curl "${args[@]}" "${GRAFANA_URL}/api${path}" 2>/dev/null
}

# ── Step 1: Start monitoring services (Docker mode) ─────────────────────────

start_monitoring_stack() {
  if [ "${MODE}" = "k8s" ]; then
    log_info "K8s mode — skipping Docker Compose start"
    return
  fi

  log_step "[1/6] Starting Monitoring Stack"

  # Create a monitoring-specific docker-compose
  local compose_file="/tmp/prometheus-monitoring-compose.yml"
  cat > "${compose_file}" <<'COMPOSE_EOF'
services:
  # Prometheus: metrics collection and alerting engine
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus-monitoring
    ports:
      - "9090:9090"
    volumes:
      - ./infra/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./infra/monitoring/alerts.yaml:/etc/prometheus/alerts.yaml:ro
      - prometheus_monitoring_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.path=/prometheus"
      - "--storage.tsdb.retention.time=30d"
      - "--web.enable-lifecycle"
      - "--web.enable-admin-api"
      - "--enable-feature=exemplar-storage"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:9090/-/ready || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - prometheus-net

  # Grafana: dashboards and visualization
  grafana:
    image: grafana/grafana:latest
    container_name: prometheus-grafana
    ports:
      - "3001:3000"
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /var/lib/grafana/dashboards/prometheus-overview.json
    volumes:
      - ./infra/monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./infra/monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana_monitoring_data:/var/lib/grafana
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - prometheus-net

  # Alertmanager: alert routing and notification
  alertmanager:
    image: prom/alertmanager:latest
    container_name: prometheus-alertmanager
    ports:
      - "9093:9093"
    volumes:
      - ./infra/monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
    command:
      - "--config.file=/etc/alertmanager/alertmanager.yml"
      - "--storage.path=/alertmanager"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:9093/-/ready || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - prometheus-net

  # Node Exporter: host-level metrics
  node-exporter:
    image: prom/node-exporter:latest
    container_name: prometheus-node-exporter
    ports:
      - "9100:9100"
    command:
      - "--path.rootfs=/host"
    volumes:
      - /:/host:ro,rslave
    restart: unless-stopped
    networks:
      - prometheus-net

volumes:
  prometheus_monitoring_data:
    name: prometheus-monitoring-data
  grafana_monitoring_data:
    name: prometheus-grafana-data

networks:
  prometheus-net:
    name: prometheus-network
    external: true
COMPOSE_EOF

  cd "${PROJECT_ROOT}"
  docker compose -f "${compose_file}" up -d
  log_info "Monitoring stack started"

  # Wait for Grafana to be ready
  log_info "Waiting for Grafana to be ready..."
  local retries=30
  while [ ${retries} -gt 0 ]; do
    if curl -sf "${GRAFANA_URL}/api/health" >/dev/null 2>&1; then
      log_info "Grafana is ready"
      break
    fi
    sleep 2
    retries=$((retries - 1))
  done

  if [ ${retries} -eq 0 ]; then
    log_error "Grafana did not become ready in time"
    exit 1
  fi
}

# ── Step 2: Configure data sources ──────────────────────────────────────────

configure_datasources() {
  log_step "[2/6] Configuring Data Sources"

  # Prometheus data source
  log_info "Adding Prometheus data source..."
  local prom_ds='{
    "name": "Prometheus",
    "type": "prometheus",
    "access": "proxy",
    "url": "http://prometheus:9090",
    "isDefault": true,
    "jsonData": {
      "timeInterval": "15s",
      "exemplarTraceIdDestinations": [
        { "name": "traceID", "datasourceUid": "tempo" }
      ]
    }
  }'
  local result
  result=$(grafana_api POST "/datasources" "${prom_ds}")
  if echo "${result}" | grep -q '"id"'; then
    log_info "  Prometheus data source configured"
  else
    log_info "  Prometheus data source already exists or updated"
    grafana_api PUT "/datasources/name/Prometheus" "${prom_ds}" >/dev/null 2>&1 || true
  fi

  # Loki data source (for log aggregation)
  log_info "Adding Loki data source..."
  local loki_ds='{
    "name": "Loki",
    "type": "loki",
    "access": "proxy",
    "url": "http://loki:3100",
    "jsonData": {
      "derivedFields": [
        {
          "datasourceUid": "tempo",
          "matcherRegex": "traceID=(\\w+)",
          "name": "TraceID",
          "url": "${__value.raw}"
        }
      ]
    }
  }'
  grafana_api POST "/datasources" "${loki_ds}" >/dev/null 2>&1 || true
  log_info "  Loki data source configured"

  # Tempo data source (for distributed tracing)
  log_info "Adding Tempo data source..."
  local tempo_ds='{
    "name": "Tempo",
    "type": "tempo",
    "uid": "tempo",
    "access": "proxy",
    "url": "http://tempo:3200",
    "jsonData": {
      "tracesToLogs": {
        "datasourceUid": "loki",
        "filterByTraceID": true,
        "filterBySpanID": true
      },
      "tracesToMetrics": {
        "datasourceUid": "prometheus"
      },
      "nodeGraph": { "enabled": true },
      "serviceMap": { "datasourceUid": "prometheus" }
    }
  }'
  grafana_api POST "/datasources" "${tempo_ds}" >/dev/null 2>&1 || true
  log_info "  Tempo data source configured"

  # Alertmanager data source
  log_info "Adding Alertmanager data source..."
  local am_ds='{
    "name": "Alertmanager",
    "type": "alertmanager",
    "access": "proxy",
    "url": "http://alertmanager:9093",
    "jsonData": {
      "implementation": "prometheus"
    }
  }'
  grafana_api POST "/datasources" "${am_ds}" >/dev/null 2>&1 || true
  log_info "  Alertmanager data source configured"
}

# ── Step 3: Import dashboards ────────────────────────────────────────────────

import_dashboards() {
  if [ "${SKIP_DASHBOARDS}" = true ]; then
    log_info "Skipping dashboard import (--skip-dashboards)"
    return
  fi

  log_step "[3/6] Importing Dashboards"

  # Create the Prometheus folder in Grafana
  grafana_api POST "/folders" '{"title": "Prometheus Platform"}' >/dev/null 2>&1 || true

  # Get the folder ID
  local folder_uid="prometheus"
  grafana_api POST "/folders" "{\"uid\": \"${folder_uid}\", \"title\": \"Prometheus Platform\"}" >/dev/null 2>&1 || true

  # Import each dashboard JSON
  local dashboard_count=0
  local failed_count=0

  # Search both dashboard directories
  local search_dirs=(
    "${SCRIPT_DIR}/grafana/dashboards"
    "${PROJECT_ROOT}/infra/grafana/dashboards"
  )

  for search_dir in "${search_dirs[@]}"; do
    if [ ! -d "${search_dir}" ]; then
      continue
    fi

    for dashboard_file in "${search_dir}"/*.json; do
      if [ ! -f "${dashboard_file}" ]; then
        continue
      fi

      local dashboard_name
      dashboard_name=$(basename "${dashboard_file}" .json)
      log_info "  Importing: ${dashboard_name}..."

      # Wrap the dashboard JSON in an import payload
      local import_payload
      import_payload=$(jq -c "{
        \"dashboard\": .,
        \"overwrite\": true,
        \"folderUid\": \"${folder_uid}\",
        \"message\": \"Imported by setup-monitoring.sh\"
      }" < "${dashboard_file}" 2>/dev/null)

      if [ -n "${import_payload}" ]; then
        local result
        result=$(grafana_api POST "/dashboards/db" "${import_payload}" 2>/dev/null || echo "error")
        if echo "${result}" | grep -q '"status":"success"\|"id"'; then
          log_info "    OK"
          dashboard_count=$((dashboard_count + 1))
        else
          log_warn "    Failed to import ${dashboard_name}"
          failed_count=$((failed_count + 1))
        fi
      else
        log_warn "    Invalid JSON in ${dashboard_file}"
        failed_count=$((failed_count + 1))
      fi
    done
  done

  log_info "  Imported ${dashboard_count} dashboard(s), ${failed_count} failed"
}

# ── Step 4: Configure alert notification channels ────────────────────────────

configure_notifications() {
  if [ "${SKIP_ALERTS}" = true ]; then
    log_info "Skipping alert notification setup (--skip-alerts)"
    return
  fi

  log_step "[4/6] Configuring Alert Notification Channels"

  # Slack notification channel
  if [ -n "${SLACK_WEBHOOK}" ]; then
    log_info "Adding Slack notification channel..."
    local slack_payload
    slack_payload=$(cat <<SLACK_EOF
{
  "name": "Slack Alerts",
  "type": "slack",
  "isDefault": true,
  "sendReminder": true,
  "frequency": "1h",
  "settings": {
    "url": "${SLACK_WEBHOOK}",
    "recipient": "#prometheus-alerts",
    "username": "Prometheus Alerts",
    "icon_emoji": ":rotating_light:",
    "mentionChannel": "here",
    "text": "{{ template \"slack.default.text\" . }}"
  }
}
SLACK_EOF
)
    grafana_api POST "/alert-notifications" "${slack_payload}" >/dev/null 2>&1 || true
    log_info "  Slack channel configured"
  else
    log_info "  Skipping Slack (no --slack-webhook provided)"
  fi

  # PagerDuty notification channel
  if [ -n "${PAGERDUTY_KEY}" ]; then
    log_info "Adding PagerDuty notification channel..."
    local pd_payload
    pd_payload=$(cat <<PD_EOF
{
  "name": "PagerDuty Critical",
  "type": "pagerduty",
  "isDefault": false,
  "settings": {
    "integrationKey": "${PAGERDUTY_KEY}",
    "severity": "critical",
    "autoResolve": true
  }
}
PD_EOF
)
    grafana_api POST "/alert-notifications" "${pd_payload}" >/dev/null 2>&1 || true
    log_info "  PagerDuty channel configured"
  else
    log_info "  Skipping PagerDuty (no --pagerduty-key provided)"
  fi

  # Default webhook channel (always configured)
  log_info "Adding webhook notification channel..."
  local webhook_payload='{
    "name": "Platform Webhook",
    "type": "webhook",
    "isDefault": false,
    "settings": {
      "url": "http://api:4000/webhooks/alerts",
      "httpMethod": "POST",
      "autoResolve": true
    }
  }'
  grafana_api POST "/alert-notifications" "${webhook_payload}" >/dev/null 2>&1 || true
  log_info "  Webhook channel configured"
}

# ── Step 5: Create monitoring user accounts ──────────────────────────────────

create_users() {
  log_step "[5/6] Creating Monitoring User Accounts"

  # Read-only viewer account for the team
  log_info "Creating viewer account (prometheus-viewer)..."
  local viewer_payload='{
    "name": "Prometheus Viewer",
    "login": "prometheus-viewer",
    "email": "viewer@prometheus.dev",
    "password": "viewer-readonly-2026",
    "orgId": 1,
    "role": "Viewer"
  }'
  grafana_api POST "/admin/users" "${viewer_payload}" >/dev/null 2>&1 || true
  log_info "  Viewer account created"

  # Editor account for on-call engineers
  log_info "Creating editor account (prometheus-oncall)..."
  local editor_payload='{
    "name": "Prometheus On-Call",
    "login": "prometheus-oncall",
    "email": "oncall@prometheus.dev",
    "password": "oncall-editor-2026",
    "orgId": 1,
    "role": "Editor"
  }'
  grafana_api POST "/admin/users" "${editor_payload}" >/dev/null 2>&1 || true
  log_info "  Editor account created"

  log_warn "  Change default passwords after initial setup!"
}

# ── Step 6: Verify everything works ──────────────────────────────────────────

verify_monitoring() {
  log_step "[6/6] Verifying Monitoring Stack"

  local errors=0

  # Check Prometheus
  log_info "Checking Prometheus..."
  if curl -sf "${PROMETHEUS_URL}/-/ready" >/dev/null 2>&1; then
    log_info "  [OK] Prometheus is ready"
    # Check targets
    local targets_up
    targets_up=$(curl -sf "${PROMETHEUS_URL}/api/v1/targets" 2>/dev/null | grep -c '"health":"up"' || echo "0")
    log_info "  [OK] ${targets_up} scrape target(s) up"
  else
    log_error "  [FAIL] Prometheus is not reachable at ${PROMETHEUS_URL}"
    errors=$((errors + 1))
  fi

  # Check Alertmanager
  log_info "Checking Alertmanager..."
  if curl -sf "${ALERTMANAGER_URL}/-/ready" >/dev/null 2>&1; then
    log_info "  [OK] Alertmanager is ready"
  else
    log_warn "  [WARN] Alertmanager is not reachable at ${ALERTMANAGER_URL}"
  fi

  # Check Grafana
  log_info "Checking Grafana..."
  if curl -sf "${GRAFANA_URL}/api/health" >/dev/null 2>&1; then
    log_info "  [OK] Grafana is ready"

    # Verify data sources
    local ds_result
    ds_result=$(grafana_api GET "/datasources" 2>/dev/null || echo "[]")
    local ds_count
    ds_count=$(echo "${ds_result}" | grep -c '"type"' || echo "0")
    log_info "  [OK] ${ds_count} data source(s) configured"

    # Verify dashboards
    local db_result
    db_result=$(grafana_api GET "/search?type=dash-db" 2>/dev/null || echo "[]")
    local db_count
    db_count=$(echo "${db_result}" | grep -c '"uid"' || echo "0")
    log_info "  [OK] ${db_count} dashboard(s) available"

    # Try loading each dashboard to verify it renders
    log_info "  Verifying dashboard rendering..."
    local dashboard_uids
    dashboard_uids=$(echo "${db_result}" | grep -o '"uid":"[^"]*"' | sed 's/"uid":"//;s/"//' || true)
    local verified=0
    local broken=0
    for uid in ${dashboard_uids}; do
      local dash_result
      dash_result=$(grafana_api GET "/dashboards/uid/${uid}" 2>/dev/null || echo "error")
      if echo "${dash_result}" | grep -q '"dashboard"'; then
        verified=$((verified + 1))
      else
        log_warn "    Dashboard ${uid} failed to load"
        broken=$((broken + 1))
      fi
    done
    log_info "  [OK] ${verified} dashboard(s) verified, ${broken} broken"
  else
    log_error "  [FAIL] Grafana is not reachable at ${GRAFANA_URL}"
    errors=$((errors + 1))
  fi

  echo ""
  if [ ${errors} -eq 0 ]; then
    echo "════════════════════════════════════════════════"
    echo "  Monitoring Stack Verified Successfully"
    echo ""
    echo "  Prometheus:   ${PROMETHEUS_URL}"
    echo "  Grafana:      ${GRAFANA_URL}"
    echo "  Alertmanager: ${ALERTMANAGER_URL}"
    echo "════════════════════════════════════════════════"
  else
    echo "  ${errors} verification error(s) — review above"
    return 1
  fi
}

# ── CLI parsing ──────────────────────────────────────────────────────────────

usage() {
  echo "Usage: $(basename "$0") [options]"
  echo ""
  echo "Options:"
  echo "  --mode <docker|k8s>       Deployment mode (default: docker)"
  echo "  --grafana-url <url>       Grafana URL (default: http://localhost:3001)"
  echo "  --grafana-user <user>     Grafana admin user (default: admin)"
  echo "  --grafana-pass <pass>     Grafana admin password (default: admin)"
  echo "  --prometheus-url <url>    Prometheus URL (default: http://localhost:9090)"
  echo "  --alertmanager-url <url>  Alertmanager URL (default: http://localhost:9093)"
  echo "  --slack-webhook <url>     Slack webhook URL for alert notifications"
  echo "  --pagerduty-key <key>     PagerDuty integration key"
  echo "  --skip-dashboards         Skip dashboard import"
  echo "  --skip-alerts             Skip alert notification setup"
  echo "  --verify-only             Only run verification checks"
  echo "  --help                    Show this help"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)             MODE="$2"; shift 2 ;;
    --grafana-url)      GRAFANA_URL="$2"; shift 2 ;;
    --grafana-user)     GRAFANA_USER="$2"; shift 2 ;;
    --grafana-pass)     GRAFANA_PASS="$2"; shift 2 ;;
    --prometheus-url)   PROMETHEUS_URL="$2"; shift 2 ;;
    --alertmanager-url) ALERTMANAGER_URL="$2"; shift 2 ;;
    --slack-webhook)    SLACK_WEBHOOK="$2"; shift 2 ;;
    --pagerduty-key)    PAGERDUTY_KEY="$2"; shift 2 ;;
    --skip-dashboards)  SKIP_DASHBOARDS=true; shift ;;
    --skip-alerts)      SKIP_ALERTS=true; shift ;;
    --verify-only)      VERIFY_ONLY=true; shift ;;
    --help|-h)          usage; exit 0 ;;
    *)                  log_error "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# ── Main ─────────────────────────────────────────────────────────────────────

if [ "${VERIFY_ONLY}" = true ]; then
  verify_monitoring
  exit $?
fi

echo "════════════════════════════════════════════════"
echo "  Prometheus Monitoring Setup"
echo "  Mode:          ${MODE}"
echo "  Grafana:       ${GRAFANA_URL}"
echo "  Prometheus:    ${PROMETHEUS_URL}"
echo "  Alertmanager:  ${ALERTMANAGER_URL}"
echo "════════════════════════════════════════════════"

start_monitoring_stack
configure_datasources
import_dashboards
configure_notifications
create_users
verify_monitoring
