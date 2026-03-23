#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# verify-health.sh - Production Deployment Health Verification (GAP-002)
#
# Verifies health endpoints for all 9 Prometheus services.
# Designed for post-deployment verification in any environment.
#
# Usage:
#   bash infra/scripts/verify-health.sh                    # localhost (default)
#   bash infra/scripts/verify-health.sh --host 10.0.1.50   # custom host
#   bash infra/scripts/verify-health.sh --k8s staging      # port-forward + check
#   bash infra/scripts/verify-health.sh --timeout 10       # custom timeout (seconds)
#   bash infra/scripts/verify-health.sh --retries 5        # retry unhealthy services
#
# Exit codes:
#   0 - All services healthy (GREEN)
#   1 - One or more services unhealthy (RED)
##############################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

HOST="localhost"
TIMEOUT=5
RETRIES=1
RETRY_DELAY=3
K8S_MODE=""
K8S_NAMESPACE=""

# Service definitions: name:port:health_path
SERVICES=(
  "web:3000:/health"
  "api:4000:/health"
  "socket-server:4001:/health"
  "orchestrator:4002:/health"
  "project-brain:4003:/health"
  "model-router:4004:/health"
  "mcp-gateway:4005:/health"
  "sandbox-manager:4006:/health"
  "queue-worker:4007:/health"
)

TOTAL=0
HEALTHY=0
UNHEALTHY=0
UNHEALTHY_SERVICES=()

usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --host HOST       Base hostname/IP (default: localhost)"
  echo "  --timeout SECS    Connection timeout per request (default: 5)"
  echo "  --retries N       Number of retries for unhealthy services (default: 1)"
  echo "  --retry-delay N   Seconds between retries (default: 3)"
  echo "  --k8s ENV         Use kubectl port-forward (staging|production)"
  echo "  --help            Show this help"
  exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --retries) RETRIES="$2"; shift 2 ;;
    --retry-delay) RETRY_DELAY="$2"; shift 2 ;;
    --k8s) K8S_MODE="1"; K8S_NAMESPACE="${2:-prometheus}"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

# Resolve K8s namespace
if [[ -n "$K8S_MODE" ]]; then
  if [[ "$K8S_NAMESPACE" == "staging" ]]; then
    K8S_NAMESPACE="prometheus-staging"
  elif [[ "$K8S_NAMESPACE" == "production" ]]; then
    K8S_NAMESPACE="prometheus"
  fi
fi

check_service() {
  local name="$1"
  local port="$2"
  local path="$3"
  local attempt=1
  local url="http://${HOST}:${port}${path}"
  local status=""

  TOTAL=$((TOTAL + 1))

  while [[ $attempt -le $RETRIES ]]; do
    status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout "$TIMEOUT" --max-time "$((TIMEOUT + 5))" "$url" 2>/dev/null || echo "000")

    if [[ "$status" -ge 200 ]] && [[ "$status" -lt 400 ]]; then
      printf "  ${GREEN}GREEN${NC}  %-22s %s\n" "$name" "(:${port}${path} -> ${status})"
      HEALTHY=$((HEALTHY + 1))
      return 0
    fi

    if [[ $attempt -lt $RETRIES ]]; then
      sleep "$RETRY_DELAY"
    fi
    attempt=$((attempt + 1))
  done

  # Service is unhealthy after all retries
  if [[ "$status" == "000" ]]; then
    printf "  ${RED}RED  ${NC}  %-22s %s\n" "$name" "(:${port} unreachable)"
  else
    printf "  ${RED}RED  ${NC}  %-22s %s\n" "$name" "(:${port}${path} -> ${status})"
  fi
  UNHEALTHY=$((UNHEALTHY + 1))
  UNHEALTHY_SERVICES+=("$name")
  return 1
}

# Print header
echo ""
echo "======================================================="
echo "  Prometheus Health Verification (GAP-002)"
echo "======================================================="
echo ""
echo "  Host:    ${HOST}"
echo "  Timeout: ${TIMEOUT}s"
echo "  Retries: ${RETRIES}"
if [[ -n "$K8S_MODE" ]]; then
  echo "  K8s:     ${K8S_NAMESPACE}"
fi
echo ""
echo "-------------------------------------------------------"
echo "  Services"
echo "-------------------------------------------------------"

# Check each service
for svc in "${SERVICES[@]}"; do
  IFS=':' read -r name port path <<< "$svc"
  check_service "$name" "$port" "$path" || true
done

# Summary
echo ""
echo "======================================================="
printf "  Total: %d | ${GREEN}Healthy: %d${NC} | ${RED}Unhealthy: %d${NC}\n" "$TOTAL" "$HEALTHY" "$UNHEALTHY"
echo "======================================================="

if [[ ${#UNHEALTHY_SERVICES[@]} -gt 0 ]]; then
  echo ""
  printf "  ${RED}Unhealthy services:${NC} %s\n" "${UNHEALTHY_SERVICES[*]}"
  echo ""
  echo "  Troubleshooting:"
  echo "    - Check service logs:  kubectl logs -n <ns> deploy/<service>"
  echo "    - Check pod status:    kubectl get pods -n <ns>"
  echo "    - Restart service:     kubectl rollout restart deploy/<service> -n <ns>"
  echo ""
  exit 1
fi

echo ""
printf "  ${GREEN}${BOLD}All services healthy. Deployment verified.${NC}\n"
echo ""
exit 0
