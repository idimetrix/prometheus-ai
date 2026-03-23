#!/usr/bin/env bash
set -euo pipefail

# Canary Deployment Script
# Usage: ./canary-deploy.sh <environment> <version>

ENVIRONMENT="${1:?Usage: canary-deploy.sh <environment> <version>}"
VERSION="${2:?Version required}"
NAMESPACE="prometheus-${ENVIRONMENT}"
STEPS=(5 25 50 100)
ERROR_THRESHOLD=5

echo "=== Canary Deploy: ${ENVIRONMENT} v${VERSION} ==="

for weight in "${STEPS[@]}"; do
  echo ""
  echo "--- Canary step: ${weight}% traffic ---"

  # Update Traefik weighted routing
  kubectl patch ingressroute prometheus-ingress -n "$NAMESPACE" \
    --type=merge -p "{
      \"spec\":{\"routes\":[{
        \"services\":[
          {\"name\":\"api-stable\",\"weight\":$((100 - weight))},
          {\"name\":\"api-canary\",\"weight\":${weight}}
        ]
      }]}
    }" 2>/dev/null || echo "IngressRoute patch skipped"

  echo "Waiting 60s for metrics..."
  sleep 60

  # Check error rate (simplified)
  ERROR_COUNT=$(kubectl logs -n "$NAMESPACE" -l "app=api,version=${VERSION}" --tail=100 2>/dev/null | grep -c "ERROR" || echo "0")

  if [ "$ERROR_COUNT" -gt "$ERROR_THRESHOLD" ]; then
    echo "ERROR: High error rate (${ERROR_COUNT} errors). Rolling back!"
    kubectl patch ingressroute prometheus-ingress -n "$NAMESPACE" \
      --type=merge -p '{"spec":{"routes":[{"services":[{"name":"api-stable","weight":100},{"name":"api-canary","weight":0}]}]}}' 2>/dev/null || true
    exit 1
  fi

  echo "Error rate OK (${ERROR_COUNT} errors). Proceeding."
done

echo ""
echo "=== Canary Deploy Complete: 100% on v${VERSION} ==="
