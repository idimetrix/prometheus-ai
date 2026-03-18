#!/usr/bin/env bash
##############################################################################
# healthcheck.sh - Health check for Prometheus services
# Usage:
#   bash infra/scripts/healthcheck.sh           # Local dev check
#   bash infra/scripts/healthcheck.sh --k8s production  # K8s cluster check
#   bash infra/scripts/healthcheck.sh --k8s staging
##############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TOTAL=0
HEALTHY=0
UNHEALTHY=0

check_http() {
  local name="$1"
  local url="$2"
  TOTAL=$((TOTAL + 1))

  status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "$url" 2>/dev/null || echo "000")

  if [ "$status" -ge 200 ] && [ "$status" -lt 400 ]; then
    printf "  ${GREEN}OK${NC}  %-24s %s\n" "$name" "($status)"
    HEALTHY=$((HEALTHY + 1))
  elif [ "$status" = "000" ]; then
    printf "  ${YELLOW}--${NC}  %-24s %s\n" "$name" "(not running)"
    UNHEALTHY=$((UNHEALTHY + 1))
  else
    printf "  ${RED}!!${NC}  %-24s %s\n" "$name" "($status)"
    UNHEALTHY=$((UNHEALTHY + 1))
  fi
}

check_tcp() {
  local name="$1"
  local host="$2"
  local port="$3"
  TOTAL=$((TOTAL + 1))

  if nc -z "$host" "$port" 2>/dev/null; then
    printf "  ${GREEN}OK${NC}  %-24s %s\n" "$name" "(:${port})"
    HEALTHY=$((HEALTHY + 1))
  else
    printf "  ${RED}!!${NC}  %-24s %s\n" "$name" "(:${port} unreachable)"
    UNHEALTHY=$((UNHEALTHY + 1))
  fi
}

check_k8s() {
  local namespace="$1"
  echo ""
  echo "Kubernetes Deployments (${namespace}):"
  echo "---------------------------------------"

  kubectl get deployments -n "${namespace}" -o custom-columns=\
"NAME:.metadata.name,READY:.status.readyReplicas,DESIRED:.spec.replicas,AVAILABLE:.status.availableReplicas,UP-TO-DATE:.status.updatedReplicas" 2>/dev/null

  echo ""
  echo "Pods:"
  echo "-----"
  kubectl get pods -n "${namespace}" -o custom-columns=\
"NAME:.metadata.name,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount,AGE:.metadata.creationTimestamp" 2>/dev/null

  echo ""
  echo "Services:"
  echo "---------"
  kubectl get svc -n "${namespace}" 2>/dev/null

  # Check for pods not in Running state
  NOT_RUNNING=$(kubectl get pods -n "${namespace}" --field-selector=status.phase!=Running --no-headers 2>/dev/null | wc -l)
  if [ "$NOT_RUNNING" -gt 0 ]; then
    echo ""
    printf "${RED}WARNING: ${NOT_RUNNING} pod(s) not in Running state${NC}\n"
    kubectl get pods -n "${namespace}" --field-selector=status.phase!=Running 2>/dev/null
  fi
}

# Handle --k8s mode
if [ "${1:-}" = "--k8s" ]; then
  ENV="${2:-production}"
  if [ "$ENV" = "staging" ]; then
    NAMESPACE="prometheus-staging"
  else
    NAMESPACE="prometheus"
  fi

  echo "============================================"
  echo "  Prometheus K8s Health Check"
  echo "  Environment: ${ENV}"
  echo "  Namespace:   ${NAMESPACE}"
  echo "============================================"

  check_k8s "$NAMESPACE"
  exit 0
fi

# Local dev health check
echo "============================================"
echo "  Prometheus Health Check (Local Dev)"
echo "============================================"
echo ""

echo "Infrastructure:"
echo "---------------"
check_tcp "PostgreSQL" "localhost" "5432"
check_tcp "Redis" "localhost" "6379"
check_tcp "MinIO" "localhost" "9000"

echo ""
echo "Services:"
echo "---------"
check_http "Web" "http://localhost:3000"
check_http "API" "http://localhost:4000/health"
check_http "Socket Server" "http://localhost:4001"
check_http "Orchestrator" "http://localhost:4002/health"
check_http "Project Brain" "http://localhost:4003/health"
check_http "Model Router" "http://localhost:4004/health"
check_http "MCP Gateway" "http://localhost:4005/health"
check_http "Sandbox Manager" "http://localhost:4006/health"

echo ""
echo "============================================"
printf "  Total: %d  ${GREEN}Healthy: %d${NC}  ${RED}Unhealthy: %d${NC}\n" "$TOTAL" "$HEALTHY" "$UNHEALTHY"
echo "============================================"

if [ "$UNHEALTHY" -gt 0 ]; then
  exit 1
fi
