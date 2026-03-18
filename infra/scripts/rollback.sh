#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:?Usage: rollback.sh <service>}"
NAMESPACE="${2:-prometheus}"

echo "Rolling back ${SERVICE} in ${NAMESPACE}..."
kubectl rollout undo "deployment/${SERVICE}" -n "${NAMESPACE}"
kubectl rollout status "deployment/${SERVICE}" -n "${NAMESPACE}" --timeout=120s
echo "Rollback complete!"
