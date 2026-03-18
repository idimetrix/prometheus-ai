#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-staging}"
IMAGE_TAG="${2:-latest}"

echo "Deploying to ${ENVIRONMENT} with tag ${IMAGE_TAG}..."

# Apply kustomize overlay
kubectl apply -k "infra/k8s/overlays/${ENVIRONMENT}"

# Update image tags
for service in web api queue-worker socket-server; do
  kubectl set image "deployment/${service}" \
    "${service}=prometheus/${service}:${IMAGE_TAG}" \
    -n "prometheus${ENVIRONMENT == 'staging' ? '-staging' : ''}" \
    --record || true
done

# Wait for rollout
for service in web api queue-worker socket-server; do
  echo "Waiting for ${service} rollout..."
  kubectl rollout status "deployment/${service}" \
    -n "prometheus${ENVIRONMENT == 'staging' ? '-staging' : ''}" \
    --timeout=300s || true
done

echo "Deployment complete!"
