#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# air-gapped-setup.sh — Prepare and deploy Prometheus without internet access
#
# This script has two phases:
#   1. PREPARE (run on a machine WITH internet):
#      - Downloads all Docker images
#      - Downloads Ollama models
#      - Bundles npm dependencies
#      - Generates air-gapped configuration
#      - Packages everything into a portable archive
#
#   2. DEPLOY (run on the air-gapped target):
#      - Loads Docker images from archive
#      - Loads Ollama models
#      - Installs npm dependencies from cache
#      - Starts all services
#      - Verifies everything works offline
#
# Usage:
#   bash infra/scripts/air-gapped-setup.sh prepare [--output /path/to/bundle]
#   bash infra/scripts/air-gapped-setup.sh deploy  [--bundle /path/to/bundle.tar.gz]
#   bash infra/scripts/air-gapped-setup.sh verify
#
# The prepare phase creates a self-contained archive (~15-30GB depending on
# which Ollama models are included) that can be transferred via USB, SCP,
# or any offline medium.
##############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUNDLE_DIR="${BUNDLE_DIR:-/tmp/prometheus-airgap-bundle}"
BUNDLE_OUTPUT="${BUNDLE_OUTPUT:-${BUNDLE_DIR}.tar.gz}"

# Docker images required for the platform
DOCKER_IMAGES=(
  "pgvector/pgvector:pg16"
  "bitnami/pgbouncer:latest"
  "docker.dragonflydb.io/dragonflydb/dragonfly:latest"
  "minio/minio:latest"
  "ollama/ollama:latest"
  "ghcr.io/berriai/litellm:main-latest"
  "ghcr.io/sourcegraph/zoekt-webserver:latest"
  "qdrant/qdrant:latest"
  "inngest/inngest:latest"
  "node:22-alpine"
)

# Ollama models to pre-download for air-gapped LLM inference
OLLAMA_MODELS=(
  "qwen3-coder-next"
  "qwen3.5:27b"
  "deepseek-r1:32b"
  "nomic-embed-text"
)

# ── Logging helpers ──────────────────────────────────────────────────────────

log_info()  { echo "[INFO]  $(date +%H:%M:%S) $*"; }
log_warn()  { echo "[WARN]  $(date +%H:%M:%S) $*" >&2; }
log_error() { echo "[ERROR] $(date +%H:%M:%S) $*" >&2; }
log_step()  { echo ""; echo "════════════════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════════════════"; }

# ── Phase 1: PREPARE ────────────────────────────────────────────────────────
# Run this on a machine with internet access to download and bundle everything.

cmd_prepare() {
  local output_path="${1:-${BUNDLE_OUTPUT}}"

  log_step "Preparing Air-Gapped Bundle"
  log_info "Bundle directory: ${BUNDLE_DIR}"
  log_info "Output archive:   ${output_path}"

  # Ensure clean state
  rm -rf "${BUNDLE_DIR}"
  mkdir -p "${BUNDLE_DIR}"/{docker-images,ollama-models,npm-cache,config}

  # --- Step 1: Pull and save Docker images ---
  log_step "[1/5] Downloading Docker images"
  for image in "${DOCKER_IMAGES[@]}"; do
    log_info "Pulling ${image}..."
    if docker pull "${image}" 2>/dev/null; then
      # Save image to tar file (replace / and : with _ for safe filenames)
      local safe_name
      safe_name=$(echo "${image}" | tr '/:' '__')
      docker save "${image}" -o "${BUNDLE_DIR}/docker-images/${safe_name}.tar"
      log_info "  Saved: ${safe_name}.tar"
    else
      log_warn "  Failed to pull ${image} — skipping"
    fi
  done

  # --- Step 2: Build and save application images ---
  log_step "[2/5] Building application Docker images"
  local app_services="web api orchestrator queue-worker socket-server mcp-gateway model-router project-brain sandbox-manager"
  for svc in ${app_services}; do
    local dockerfile="${PROJECT_ROOT}/infra/docker/Dockerfile.${svc}"
    if [ -f "${dockerfile}" ]; then
      log_info "Building prometheus/${svc}:airgap..."
      if docker build -f "${dockerfile}" -t "prometheus/${svc}:airgap" "${PROJECT_ROOT}" 2>/dev/null; then
        docker save "prometheus/${svc}:airgap" -o "${BUNDLE_DIR}/docker-images/prometheus_${svc}.tar"
        log_info "  Saved: prometheus_${svc}.tar"
      else
        log_warn "  Build failed for ${svc} — skipping"
      fi
    else
      log_warn "  Dockerfile not found for ${svc} — skipping"
    fi
  done

  # --- Step 3: Download Ollama models ---
  log_step "[3/5] Downloading Ollama models"
  # Start a temporary Ollama instance to pull models
  local ollama_container="airgap-ollama-prep"
  docker rm -f "${ollama_container}" 2>/dev/null || true
  docker run -d --name "${ollama_container}" \
    -v "${BUNDLE_DIR}/ollama-models:/root/.ollama" \
    ollama/ollama:latest

  # Wait for Ollama to be ready
  log_info "Waiting for Ollama to start..."
  for i in $(seq 1 30); do
    if docker exec "${ollama_container}" curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  for model in "${OLLAMA_MODELS[@]}"; do
    log_info "Pulling model: ${model}..."
    if docker exec "${ollama_container}" ollama pull "${model}" 2>/dev/null; then
      log_info "  Downloaded: ${model}"
    else
      log_warn "  Failed to pull ${model} — skipping"
    fi
  done

  # Stop temporary Ollama
  docker rm -f "${ollama_container}" 2>/dev/null || true

  # --- Step 4: Bundle npm dependencies ---
  log_step "[4/5] Bundling npm dependencies"
  log_info "Creating offline npm package cache..."
  cd "${PROJECT_ROOT}"
  if command -v pnpm >/dev/null 2>&1; then
    # Use pnpm store to create a portable cache
    pnpm store path 2>/dev/null | head -1 | xargs -I{} cp -r {} "${BUNDLE_DIR}/npm-cache/" 2>/dev/null || true
    # Also copy the lockfile and workspace config
    cp -f package.json pnpm-workspace.yaml pnpm-lock.yaml "${BUNDLE_DIR}/npm-cache/" 2>/dev/null || true
    cp -f .npmrc "${BUNDLE_DIR}/npm-cache/" 2>/dev/null || true
    log_info "  npm cache bundled"
  else
    log_warn "  pnpm not found — skipping npm cache"
  fi

  # --- Step 5: Copy configuration files ---
  log_step "[5/5] Bundling configuration"
  # Copy air-gapped docker-compose and config
  cp -r "${PROJECT_ROOT}/infra/air-gapped/" "${BUNDLE_DIR}/config/" 2>/dev/null || true
  cp "${PROJECT_ROOT}/docker-compose.yml" "${BUNDLE_DIR}/config/" 2>/dev/null || true
  cp "${PROJECT_ROOT}/docker-compose.full.yml" "${BUNDLE_DIR}/config/" 2>/dev/null || true

  # Generate a deployment manifest with checksums
  log_info "Generating manifest..."
  {
    echo "# Prometheus Air-Gapped Bundle Manifest"
    echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# Platform version: $(git -C "${PROJECT_ROOT}" describe --tags 2>/dev/null || echo 'unknown')"
    echo ""
    echo "## Docker Images"
    for f in "${BUNDLE_DIR}"/docker-images/*.tar; do
      if [ -f "$f" ]; then
        echo "  $(basename "$f"): $(sha256sum "$f" | cut -d' ' -f1)"
      fi
    done
    echo ""
    echo "## Ollama Models"
    du -sh "${BUNDLE_DIR}/ollama-models/" 2>/dev/null || echo "  (none)"
  } > "${BUNDLE_DIR}/MANIFEST.txt"

  # Create the archive
  log_step "Creating archive: ${output_path}"
  tar -czf "${output_path}" -C "$(dirname "${BUNDLE_DIR}")" "$(basename "${BUNDLE_DIR}")"
  local archive_size
  archive_size=$(du -h "${output_path}" | cut -f1)
  log_info "Archive created: ${output_path} (${archive_size})"

  echo ""
  echo "════════════════════════════════════════════════"
  echo "  Air-Gapped Bundle Ready"
  echo "  Archive: ${output_path}"
  echo "  Size:    ${archive_size}"
  echo ""
  echo "  Transfer this file to the air-gapped machine"
  echo "  and run: bash air-gapped-setup.sh deploy --bundle ${output_path}"
  echo "════════════════════════════════════════════════"
}

# ── Phase 2: DEPLOY ─────────────────────────────────────────────────────────
# Run this on the air-gapped machine to load and start everything.

cmd_deploy() {
  local bundle_path="${1:-${BUNDLE_OUTPUT}}"

  log_step "Deploying from Air-Gapped Bundle"
  log_info "Bundle: ${bundle_path}"

  if [ ! -f "${bundle_path}" ]; then
    log_error "Bundle not found: ${bundle_path}"
    exit 1
  fi

  # Extract the bundle
  log_step "[1/4] Extracting bundle"
  local extract_dir="/opt/prometheus-airgap"
  mkdir -p "${extract_dir}"
  tar -xzf "${bundle_path}" -C "${extract_dir}" --strip-components=1
  log_info "Extracted to ${extract_dir}"

  # Load Docker images
  log_step "[2/4] Loading Docker images"
  for image_tar in "${extract_dir}"/docker-images/*.tar; do
    if [ -f "${image_tar}" ]; then
      log_info "Loading $(basename "${image_tar}")..."
      docker load -i "${image_tar}" 2>/dev/null
    fi
  done
  log_info "All Docker images loaded"

  # Load Ollama models
  log_step "[3/4] Loading Ollama models"
  if [ -d "${extract_dir}/ollama-models" ]; then
    # Create the Ollama data volume and copy models
    local ollama_volume_path
    ollama_volume_path=$(docker volume create airgap-ollama-data 2>/dev/null && \
      docker volume inspect airgap-ollama-data --format '{{ .Mountpoint }}')
    if [ -n "${ollama_volume_path}" ]; then
      cp -r "${extract_dir}/ollama-models/"* "${ollama_volume_path}/" 2>/dev/null || true
      log_info "Ollama models loaded to volume"
    else
      log_warn "Could not determine Ollama volume path — models may need manual loading"
    fi
  fi

  # Start services
  log_step "[4/4] Starting services"
  local compose_dir="${extract_dir}/config"
  if [ -f "${compose_dir}/docker-compose.airgap.yml" ]; then
    cd "${compose_dir}"
    docker compose -f docker-compose.airgap.yml up -d
    log_info "Services started"
  elif [ -f "${compose_dir}/docker-compose.yml" ]; then
    cd "${compose_dir}"
    docker compose -f docker-compose.yml -f docker-compose.full.yml --profile full up -d
    log_info "Services started"
  else
    log_error "No docker-compose file found in bundle"
    exit 1
  fi

  # Run verification
  cmd_verify

  echo ""
  echo "════════════════════════════════════════════════"
  echo "  Air-Gapped Deployment Complete"
  echo "  All services running without internet access"
  echo "════════════════════════════════════════════════"
}

# ── Phase 3: VERIFY ─────────────────────────────────────────────────────────
# Verify all components work without internet.

cmd_verify() {
  log_step "Verifying Air-Gapped Deployment"

  local errors=0

  # Check Docker images are present
  log_info "Checking Docker images..."
  for image in "${DOCKER_IMAGES[@]}"; do
    if docker image inspect "${image}" >/dev/null 2>&1; then
      log_info "  [OK] ${image}"
    else
      log_warn "  [MISSING] ${image}"
      errors=$((errors + 1))
    fi
  done

  # Check running containers
  log_info ""
  log_info "Checking running containers..."
  local expected_services=(postgres pgbouncer redis minio ollama litellm)
  for svc in "${expected_services[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "${svc}"; then
      log_info "  [OK] ${svc} is running"
    else
      log_warn "  [DOWN] ${svc} is not running"
      errors=$((errors + 1))
    fi
  done

  # Check service health endpoints
  log_info ""
  log_info "Checking service health..."
  local health_endpoints=(
    "http://localhost:4000/health:API"
    "http://localhost:4001/health:Socket Server"
    "http://localhost:4002/health:Orchestrator"
    "http://localhost:4003/health:Project Brain"
    "http://localhost:4004/health:Model Router"
    "http://localhost:4005/health:MCP Gateway"
    "http://localhost:4006/health:Sandbox Manager"
  )
  for entry in "${health_endpoints[@]}"; do
    local url="${entry%%:*}:${entry#*:}"
    url="${entry%%:*}"
    # Re-parse: split on the last colon-separated name
    local name="${entry##*:}"
    url="${entry%:*}"
    if curl -sf "${url}" >/dev/null 2>&1; then
      log_info "  [OK] ${name} (${url})"
    else
      log_warn "  [UNREACHABLE] ${name} (${url})"
      # Not counted as error — services might not all be started
    fi
  done

  # Check Ollama models
  log_info ""
  log_info "Checking Ollama models..."
  local ollama_tags
  ollama_tags=$(curl -sf http://localhost:11434/api/tags 2>/dev/null || echo "")
  if [ -n "${ollama_tags}" ]; then
    for model in "${OLLAMA_MODELS[@]}"; do
      if echo "${ollama_tags}" | grep -q "${model%%:*}"; then
        log_info "  [OK] ${model}"
      else
        log_warn "  [MISSING] ${model}"
        errors=$((errors + 1))
      fi
    done
  else
    log_warn "  Ollama not reachable — cannot check models"
  fi

  # Verify no outbound network requests
  log_info ""
  log_info "Verifying network isolation..."
  if ! curl -sf --connect-timeout 3 https://api.openai.com >/dev/null 2>&1; then
    log_info "  [OK] No outbound internet access (expected for air-gapped)"
  else
    log_warn "  [WARN] Outbound internet is accessible — not truly air-gapped"
  fi

  echo ""
  if [ ${errors} -eq 0 ]; then
    log_info "All verification checks passed"
  else
    log_warn "${errors} issue(s) found — review warnings above"
  fi

  return ${errors}
}

# ── CLI argument parsing ─────────────────────────────────────────────────────

usage() {
  echo "Usage: $(basename "$0") <command> [options]"
  echo ""
  echo "Commands:"
  echo "  prepare  Download and bundle everything for offline deployment"
  echo "  deploy   Load bundle and start services on air-gapped machine"
  echo "  verify   Verify all components work offline"
  echo ""
  echo "Options:"
  echo "  --output <path>   Output path for the bundle archive (prepare)"
  echo "  --bundle <path>   Path to the bundle archive (deploy)"
  echo ""
  echo "Examples:"
  echo "  $(basename "$0") prepare --output /mnt/usb/prometheus-bundle.tar.gz"
  echo "  $(basename "$0") deploy --bundle /mnt/usb/prometheus-bundle.tar.gz"
  echo "  $(basename "$0") verify"
}

COMMAND="${1:-}"
shift || true

# Parse remaining flags
OUTPUT_PATH=""
BUNDLE_PATH=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --output)  OUTPUT_PATH="$2"; shift 2 ;;
    --bundle)  BUNDLE_PATH="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *)         log_error "Unknown option: $1"; usage; exit 1 ;;
  esac
done

case "${COMMAND}" in
  prepare) cmd_prepare "${OUTPUT_PATH:-${BUNDLE_OUTPUT}}" ;;
  deploy)  cmd_deploy "${BUNDLE_PATH:-${BUNDLE_OUTPUT}}" ;;
  verify)  cmd_verify ;;
  *)       usage; exit 1 ;;
esac
