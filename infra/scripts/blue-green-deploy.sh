#!/usr/bin/env bash
set -euo pipefail

# Blue-Green Deployment Script for Prometheus
# Usage: ./blue-green-deploy.sh <environment> [version]

ENVIRONMENT="${1:?Usage: blue-green-deploy.sh <environment> [version]}"
VERSION="${2:-latest}"
NAMESPACE="prometheus-${ENVIRONMENT}"
ROLLBACK_TIMEOUT=600  # 10 minutes to keep old color for rollback

echo "=== Blue-Green Deploy: ${ENVIRONMENT} (version: ${VERSION}) ==="

# Determine current active color
CURRENT_COLOR=$(kubectl get svc api -n "$NAMESPACE" -o jsonpath='{.spec.selector.color}' 2>/dev/null || echo "blue")
if [ "$CURRENT_COLOR" = "blue" ]; then
  NEW_COLOR="green"
else
  NEW_COLOR="blue"
fi

echo "Current active: ${CURRENT_COLOR} → Deploying to: ${NEW_COLOR}"

# Deploy to inactive color
echo "Deploying version ${VERSION} to ${NEW_COLOR}..."
for deployment in api orchestrator project-brain model-router mcp-gateway queue-worker socket-server sandbox-manager; do
  kubectl set image deployment/${deployment}-${NEW_COLOR} \
    ${deployment}=ghcr.io/prometheus/${deployment}:${VERSION} \
    -n "$NAMESPACE" 2>/dev/null || echo "Deployment ${deployment}-${NEW_COLOR} not found, skipping"
done

# Wait for new deployment to be ready
echo "Waiting for ${NEW_COLOR} deployments to be ready..."
for deployment in api orchestrator project-brain; do
  kubectl rollout status deployment/${deployment}-${NEW_COLOR} \
    -n "$NAMESPACE" --timeout=300s 2>/dev/null || echo "Timeout waiting for ${deployment}-${NEW_COLOR}"
done

# Health check on new color
echo "Running health checks on ${NEW_COLOR}..."
NEW_POD=$(kubectl get pods -n "$NAMESPACE" -l "app=api,color=${NEW_COLOR}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -n "$NEW_POD" ]; then
  HEALTH=$(kubectl exec -n "$NAMESPACE" "$NEW_POD" -- wget -qO- http://localhost:4000/health 2>/dev/null || echo '{"status":"error"}')
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "Health check passed!"
  else
    echo "Health check FAILED. Aborting deployment."
    exit 1
  fi
fi

# Switch service selectors to new color
echo "Switching traffic to ${NEW_COLOR}..."
for svc in api orchestrator project-brain model-router mcp-gateway socket-server; do
  kubectl patch svc ${svc} -n "$NAMESPACE" \
    -p "{\"spec\":{\"selector\":{\"color\":\"${NEW_COLOR}\"}}}" 2>/dev/null || true
done

echo "Traffic switched to ${NEW_COLOR}!"
echo "Old color (${CURRENT_COLOR}) will remain for ${ROLLBACK_TIMEOUT}s for instant rollback."
echo ""
echo "To rollback immediately:"
echo "  kubectl patch svc api -n ${NAMESPACE} -p '{\"spec\":{\"selector\":{\"color\":\"${CURRENT_COLOR}\"}}}'"
echo ""
echo "=== Blue-Green Deploy Complete ==="
