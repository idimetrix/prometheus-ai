#!/usr/bin/env bash
# deploy-k8s.sh — Deploy all Prometheus services to a Kubernetes cluster.
#
# Usage:
#   ./scripts/deploy-k8s.sh [environment]
#
# Environments: staging (default), production
#
# Prerequisites:
#   - kubectl configured with cluster access
#   - kustomize installed (or kubectl >= 1.14 with built-in kustomize)
#   - Container images pushed to registry (see CI workflow)
#   - KEDA operator installed for queue-worker autoscaling

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
K8S_DIR="${ROOT_DIR}/infra/k8s"
AUTOSCALING_DIR="${K8S_DIR}/autoscaling"

ENVIRONMENT="${1:-staging}"
NAMESPACE="prometheus"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io/prometheus}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

SERVICES=(
  api
  web
  socket-server
  orchestrator
  queue-worker
  project-brain
  model-router
  mcp-gateway
  sandbox-manager
)

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

check_prerequisites() {
  log "Checking prerequisites..."

  if ! command -v kubectl &>/dev/null; then
    error "kubectl not found. Install it: https://kubernetes.io/docs/tasks/tools/"
    exit 1
  fi

  if ! kubectl cluster-info &>/dev/null; then
    error "Cannot connect to Kubernetes cluster. Check your kubeconfig."
    exit 1
  fi

  if [ "${ENVIRONMENT}" = "production" ]; then
    local context
    context="$(kubectl config current-context)"
    log "Current context: ${context}"
    read -r -p "Deploy to PRODUCTION using context '${context}'? [y/N] " confirm
    if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
      log "Aborted."
      exit 0
    fi
  fi
}

create_namespace() {
  log "Ensuring namespace '${NAMESPACE}' exists..."
  kubectl apply -f "${K8S_DIR}/base/namespace.yaml"
}

apply_configmaps_and_secrets() {
  log "Applying ConfigMaps..."
  kubectl apply -f "${K8S_DIR}/base/configmap.yaml"

  if [ -f "${K8S_DIR}/overlays/${ENVIRONMENT}/external-secrets.yaml" ]; then
    log "Applying ExternalSecrets for ${ENVIRONMENT}..."
    kubectl apply -f "${K8S_DIR}/overlays/${ENVIRONMENT}/external-secrets.yaml"
  fi
}

deploy_infrastructure() {
  log "Deploying infrastructure services..."

  # PostgreSQL
  if [ -d "${K8S_DIR}/base/postgres" ]; then
    log "  Deploying PostgreSQL..."
    kubectl apply -f "${K8S_DIR}/base/postgres/"
  fi

  # Redis
  if [ -d "${K8S_DIR}/base/redis" ]; then
    log "  Deploying Redis..."
    kubectl apply -f "${K8S_DIR}/base/redis/"
  fi

  # MinIO (if present)
  if [ -d "${K8S_DIR}/base/minio" ]; then
    log "  Deploying MinIO..."
    kubectl apply -f "${K8S_DIR}/base/minio/"
  fi

  # PgBouncer
  if [ -d "${K8S_DIR}/base/pgbouncer" ]; then
    log "  Deploying PgBouncer..."
    kubectl apply -f "${K8S_DIR}/base/pgbouncer/"
  fi

  log "Waiting for infrastructure pods to be ready..."
  kubectl -n "${NAMESPACE}" wait --for=condition=ready pod -l app=postgres --timeout=120s 2>/dev/null || true
  kubectl -n "${NAMESPACE}" wait --for=condition=ready pod -l app=redis --timeout=120s 2>/dev/null || true
}

update_images() {
  local service="$1"
  local image="${IMAGE_REGISTRY}/${service}:${IMAGE_TAG}"
  log "  Setting image for ${service}: ${image}"
  kubectl -n "${NAMESPACE}" set image "deployment/${service}" "${service}=${image}" 2>/dev/null || true
}

deploy_services() {
  log "Deploying application services..."

  for service in "${SERVICES[@]}"; do
    local service_dir="${K8S_DIR}/base/${service}"
    if [ -d "${service_dir}" ]; then
      log "  Deploying ${service}..."
      kubectl apply -f "${service_dir}/"
      update_images "${service}"
    else
      error "  Service directory not found: ${service_dir}"
    fi
  done
}

deploy_networking() {
  log "Deploying networking (Traefik IngressRoutes, network policies)..."

  if [ -d "${K8S_DIR}/base/traefik" ]; then
    kubectl apply -f "${K8S_DIR}/base/traefik/"
  fi

  if [ -d "${K8S_DIR}/base/network-policies" ]; then
    kubectl apply -f "${K8S_DIR}/base/network-policies/"
  fi
}

deploy_autoscaling() {
  log "Deploying autoscaling configurations..."

  # Apply HPA configs from autoscaling directory
  if [ -d "${AUTOSCALING_DIR}" ]; then
    for hpa_file in "${AUTOSCALING_DIR}"/*.yaml; do
      if [ -f "${hpa_file}" ]; then
        log "  Applying $(basename "${hpa_file}")..."
        kubectl apply -f "${hpa_file}"
      fi
    done
  fi

  # Apply KEDA ScaledObjects if KEDA is installed
  if kubectl get crd scaledobjects.keda.sh &>/dev/null; then
    log "  KEDA detected, applying ScaledObjects..."
    if [ -d "${K8S_DIR}/base/keda" ]; then
      kubectl apply -f "${K8S_DIR}/base/keda/"
    fi
  else
    log "  KEDA not installed, skipping ScaledObjects. Install: https://keda.sh/docs/deploy/"
  fi
}

deploy_monitoring() {
  log "Deploying monitoring..."
  if [ -d "${K8S_DIR}/base/monitoring" ]; then
    kubectl apply -f "${K8S_DIR}/base/monitoring/"
  fi
}

apply_overlay() {
  local overlay_dir="${K8S_DIR}/overlays/${ENVIRONMENT}"
  if [ -d "${overlay_dir}" ] && [ -f "${overlay_dir}/kustomization.yaml" ]; then
    log "Applying ${ENVIRONMENT} overlay via kustomize..."
    kubectl apply -k "${overlay_dir}"
  else
    log "No overlay found for ${ENVIRONMENT}, using base manifests only."
  fi
}

wait_for_rollout() {
  log "Waiting for deployments to roll out..."
  for service in "${SERVICES[@]}"; do
    log "  Waiting for ${service}..."
    kubectl -n "${NAMESPACE}" rollout status "deployment/${service}" --timeout=300s 2>/dev/null || {
      error "  ${service} rollout did not complete within timeout"
    }
  done
}

print_status() {
  log "========================================="
  log "Deployment Summary (${ENVIRONMENT})"
  log "========================================="
  kubectl -n "${NAMESPACE}" get deployments
  echo ""
  kubectl -n "${NAMESPACE}" get hpa 2>/dev/null || true
  echo ""
  kubectl -n "${NAMESPACE}" get scaledobjects 2>/dev/null || true
  echo ""
  log "========================================="
  log "Deployment to ${ENVIRONMENT} complete."
  log "========================================="
}

main() {
  log "Starting Prometheus deployment to ${ENVIRONMENT}..."
  log "Image registry: ${IMAGE_REGISTRY}"
  log "Image tag: ${IMAGE_TAG}"

  check_prerequisites
  create_namespace
  apply_configmaps_and_secrets
  deploy_infrastructure
  deploy_services
  deploy_networking
  deploy_autoscaling
  deploy_monitoring
  apply_overlay
  wait_for_rollout
  print_status
}

main "$@"
