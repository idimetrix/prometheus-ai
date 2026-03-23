#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# rollback.sh - Roll back Prometheus service deployments
# Usage:
#   bash infra/scripts/rollback.sh <service> [namespace] [revision]
#   bash infra/scripts/rollback.sh all [namespace]
# Examples:
#   bash infra/scripts/rollback.sh api
#   bash infra/scripts/rollback.sh api prometheus-staging
#   bash infra/scripts/rollback.sh api prometheus 3
#   bash infra/scripts/rollback.sh all
##############################################################################

SERVICE="${1:?Usage: rollback.sh <service|all> [namespace] [revision]}"
NAMESPACE="${2:-prometheus}"
REVISION="${3:-}"

ALL_SERVICES="web api queue-worker socket-server orchestrator project-brain model-router mcp-gateway sandbox-manager"

rollback_service() {
  local svc="$1"
  echo "Rolling back ${svc} in ${NAMESPACE}..."

  # Show current and previous revision info
  echo "  Current rollout history:"
  kubectl rollout history "deployment/${svc}" -n "${NAMESPACE}" 2>/dev/null | tail -5

  if [ -n "$REVISION" ]; then
    echo "  Rolling back to revision ${REVISION}..."
    kubectl rollout undo "deployment/${svc}" -n "${NAMESPACE}" --to-revision="${REVISION}"
  else
    echo "  Rolling back to previous revision..."
    kubectl rollout undo "deployment/${svc}" -n "${NAMESPACE}"
  fi

  echo "  Waiting for rollout to complete..."
  if kubectl rollout status "deployment/${svc}" -n "${NAMESPACE}" --timeout=180s; then
    echo "  ${svc}: rollback complete"
  else
    echo "  ERROR: ${svc} rollback did not stabilize within 180s"
    return 1
  fi
}

echo "============================================"
echo "  Prometheus Rollback"
echo "  Service:   ${SERVICE}"
echo "  Namespace: ${NAMESPACE}"
echo "============================================"
echo ""

if [ "$SERVICE" = "all" ]; then
  echo "Rolling back ALL services..."
  FAILED=""
  for svc in $ALL_SERVICES; do
    if ! rollback_service "$svc"; then
      FAILED="${FAILED} ${svc}"
    fi
    echo ""
  done
  if [ -n "$FAILED" ]; then
    echo "WARNING: Failed to roll back:${FAILED}"
    exit 1
  fi
else
  rollback_service "$SERVICE"
fi

echo ""
echo "Rollback complete. Current deployment status:"
kubectl get deployments -n "${NAMESPACE}" -o wide
