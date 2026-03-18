#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# deploy.sh - Deploy Prometheus services to Kubernetes
# Usage: bash infra/scripts/deploy.sh <environment> [image-tag]
# Examples:
#   bash infra/scripts/deploy.sh production abc1234
#   bash infra/scripts/deploy.sh staging latest
##############################################################################

ENVIRONMENT="${1:?Usage: deploy.sh <production|staging> [image-tag]}"
IMAGE_TAG="${2:-latest}"
REGISTRY="${REGISTRY:-ghcr.io/prometheus}"

ALL_SERVICES="web api queue-worker socket-server orchestrator project-brain model-router mcp-gateway sandbox-manager"

# Determine namespace based on environment
if [ "$ENVIRONMENT" = "staging" ]; then
  NAMESPACE="prometheus-staging"
else
  NAMESPACE="prometheus"
fi

echo "============================================"
echo "  Prometheus Deploy"
echo "  Environment: ${ENVIRONMENT}"
echo "  Namespace:   ${NAMESPACE}"
echo "  Image tag:   ${IMAGE_TAG}"
echo "  Registry:    ${REGISTRY}"
echo "============================================"
echo ""

# Pre-flight checks
echo "[1/5] Running pre-flight checks..."
if ! kubectl cluster-info &>/dev/null; then
  echo "ERROR: Cannot connect to Kubernetes cluster."
  exit 1
fi
echo "  Cluster connection OK"

if ! kubectl get namespace "${NAMESPACE}" &>/dev/null; then
  echo "  Creating namespace ${NAMESPACE}..."
  kubectl create namespace "${NAMESPACE}"
fi
echo "  Namespace ${NAMESPACE} OK"
echo ""

# Apply kustomize overlay
echo "[2/5] Applying kustomize overlay for ${ENVIRONMENT}..."
kubectl apply -k "infra/k8s/overlays/${ENVIRONMENT}"
echo "  Kustomize applied"
echo ""

# Update image tags for all services
echo "[3/5] Updating image tags to ${IMAGE_TAG}..."
for service in $ALL_SERVICES; do
  echo "  Updating ${service}..."
  kubectl set image "deployment/${service}" \
    "${service}=${REGISTRY}/${service}:${IMAGE_TAG}" \
    -n "${NAMESPACE}" 2>/dev/null || echo "  WARNING: Could not update ${service} (deployment may not exist)"
done
echo ""

# Wait for rollouts
echo "[4/5] Waiting for rollouts to complete..."
FAILED_ROLLOUTS=""
for service in $ALL_SERVICES; do
  echo -n "  ${service}: "
  if kubectl rollout status "deployment/${service}" -n "${NAMESPACE}" --timeout=300s 2>/dev/null; then
    echo "OK"
  else
    echo "FAILED"
    FAILED_ROLLOUTS="${FAILED_ROLLOUTS} ${service}"
  fi
done
echo ""

# Post-deploy verification
echo "[5/5] Post-deploy verification..."
kubectl get deployments -n "${NAMESPACE}" -o wide
echo ""

if [ -n "$FAILED_ROLLOUTS" ]; then
  echo "WARNING: The following services failed to roll out:${FAILED_ROLLOUTS}"
  echo "Run 'bash infra/scripts/rollback.sh <service>' to roll back specific services."
  exit 1
fi

echo "============================================"
echo "  Deployment complete!"
echo "  Environment: ${ENVIRONMENT}"
echo "  Tag: ${IMAGE_TAG}"
echo "============================================"
