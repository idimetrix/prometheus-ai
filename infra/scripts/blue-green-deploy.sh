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

# ─── Canary Phase: Shift traffic gradually ────────────────────────────
CANARY_PERCENTAGES="${CANARY_STEPS:-10 25 50 100}"
CANARY_INTERVAL="${CANARY_INTERVAL_SEC:-60}"
ERROR_THRESHOLD="${ERROR_THRESHOLD:-0.05}"

echo "Starting canary rollout with steps: ${CANARY_PERCENTAGES}"

for PERCENT in $CANARY_PERCENTAGES; do
  echo "Shifting ${PERCENT}% traffic to ${NEW_COLOR}..."

  if [ "$PERCENT" -ge 100 ]; then
    # Full cutover: switch service selectors entirely
    for svc in api orchestrator project-brain model-router mcp-gateway socket-server; do
      kubectl patch svc ${svc} -n "$NAMESPACE" \
        -p "{\"spec\":{\"selector\":{\"color\":\"${NEW_COLOR}\"}}}" 2>/dev/null || true
    done
  else
    # Partial traffic: use annotation-based weight for ingress/service mesh
    for svc in api orchestrator project-brain model-router mcp-gateway socket-server; do
      kubectl annotate svc ${svc} -n "$NAMESPACE" \
        "prometheus.dev/canary-weight=${PERCENT}" \
        "prometheus.dev/canary-color=${NEW_COLOR}" \
        --overwrite 2>/dev/null || true
    done
  fi

  # Wait and observe error rates
  echo "Observing error rates for ${CANARY_INTERVAL}s at ${PERCENT}% traffic..."
  sleep "$CANARY_INTERVAL"

  # Auto-rollback check: query error rate from the new deployment
  CANARY_POD=$(kubectl get pods -n "$NAMESPACE" -l "app=api,color=${NEW_COLOR}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [ -n "$CANARY_POD" ]; then
    METRICS=$(kubectl exec -n "$NAMESPACE" "$CANARY_POD" -- wget -qO- http://localhost:4000/metrics 2>/dev/null || echo "")
    ERROR_COUNT=$(echo "$METRICS" | grep -c 'status="5' || echo "0")
    TOTAL_COUNT=$(echo "$METRICS" | grep -c 'http_requests_total' || echo "1")

    if [ "$TOTAL_COUNT" -gt 0 ]; then
      ERROR_RATE=$(awk "BEGIN {printf \"%.4f\", $ERROR_COUNT / $TOTAL_COUNT}")
      echo "Current error rate: ${ERROR_RATE} (threshold: ${ERROR_THRESHOLD})"

      EXCEEDS=$(awk "BEGIN {print ($ERROR_RATE > $ERROR_THRESHOLD) ? 1 : 0}")
      if [ "$EXCEEDS" -eq 1 ]; then
        echo "ERROR: Error rate ${ERROR_RATE} exceeds threshold ${ERROR_THRESHOLD}!"
        echo "AUTO-ROLLBACK: Reverting traffic to ${CURRENT_COLOR}..."

        # Remove canary annotations and revert selectors
        for svc in api orchestrator project-brain model-router mcp-gateway socket-server; do
          kubectl annotate svc ${svc} -n "$NAMESPACE" \
            "prometheus.dev/canary-weight-" \
            "prometheus.dev/canary-color-" \
            --overwrite 2>/dev/null || true
          kubectl patch svc ${svc} -n "$NAMESPACE" \
            -p "{\"spec\":{\"selector\":{\"color\":\"${CURRENT_COLOR}\"}}}" 2>/dev/null || true
        done

        echo "Rollback complete. Traffic restored to ${CURRENT_COLOR}."
        exit 1
      fi
    fi
  fi

  echo "Canary at ${PERCENT}% looks healthy."
done

echo "Traffic fully switched to ${NEW_COLOR}!"

# Clean up canary annotations
for svc in api orchestrator project-brain model-router mcp-gateway socket-server; do
  kubectl annotate svc ${svc} -n "$NAMESPACE" \
    "prometheus.dev/canary-weight-" \
    "prometheus.dev/canary-color-" \
    --overwrite 2>/dev/null || true
done

echo "Old color (${CURRENT_COLOR}) will remain for ${ROLLBACK_TIMEOUT}s for instant rollback."
echo ""
echo "To rollback immediately:"
echo "  kubectl patch svc api -n ${NAMESPACE} -p '{\"spec\":{\"selector\":{\"color\":\"${CURRENT_COLOR}\"}}}'"
echo ""
echo "=== Blue-Green Deploy Complete ==="
