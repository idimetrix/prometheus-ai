#!/usr/bin/env bash
# =============================================================================
# GAP-052: Air-Gapped Deployment Setup Script
#
# Downloads and caches all models and verifies all dependencies are available
# locally for a fully offline deployment.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${SCRIPT_DIR}/models"
IMAGES_DIR="${SCRIPT_DIR}/images"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------------------------------------------------------------------------
# 1. Pre-flight checks
# ---------------------------------------------------------------------------

log_info "Running pre-flight checks..."

check_command() {
  if ! command -v "$1" &>/dev/null; then
    log_error "Required command not found: $1"
    exit 1
  fi
  log_info "  Found: $1"
}

check_command docker
check_command curl

log_info "Pre-flight checks passed."

# ---------------------------------------------------------------------------
# 2. Pull and save Docker images
# ---------------------------------------------------------------------------

DOCKER_IMAGES=(
  "pgvector/pgvector:pg16"
  "bitnami/pgbouncer:latest"
  "docker.dragonflydb.io/dragonflydb/dragonfly:latest"
  "minio/minio:latest"
  "ollama/ollama:latest"
  "ghcr.io/berriai/litellm:main-latest"
  "ghcr.io/sourcegraph/zoekt-webserver:latest"
  "inngest/inngest:latest"
  "node:22-alpine"
)

log_info "Pulling Docker images..."
mkdir -p "${IMAGES_DIR}"

for image in "${DOCKER_IMAGES[@]}"; do
  log_info "  Pulling: ${image}"
  docker pull "${image}" || {
    log_warn "  Failed to pull ${image}, skipping..."
    continue
  }

  # Save image as tar for offline use
  safe_name=$(echo "${image}" | tr '/:' '__')
  tar_path="${IMAGES_DIR}/${safe_name}.tar"
  if [ ! -f "${tar_path}" ]; then
    log_info "  Saving: ${tar_path}"
    docker save "${image}" -o "${tar_path}"
  else
    log_info "  Already saved: ${tar_path}"
  fi
done

log_info "Docker images saved to ${IMAGES_DIR}/"

# ---------------------------------------------------------------------------
# 3. Download Ollama models
# ---------------------------------------------------------------------------

OLLAMA_MODELS=(
  "qwen3-coder-next"
  "qwen3.5:27b"
  "deepseek-r1:32b"
  "nomic-embed-text"
)

log_info "Downloading Ollama models..."
mkdir -p "${MODELS_DIR}"

# Check if Ollama is running locally for model download
if curl -sf http://localhost:11434/api/tags &>/dev/null; then
  OLLAMA_URL="http://localhost:11434"
elif docker ps --format '{{.Names}}' | grep -q "ollama"; then
  OLLAMA_URL="http://localhost:11434"
else
  log_info "Starting temporary Ollama container for model download..."
  docker run -d --name airgap-ollama-temp \
    -p 11434:11434 \
    -v "${MODELS_DIR}:/root/.ollama" \
    ollama/ollama:latest

  # Wait for Ollama to be ready
  for i in $(seq 1 30); do
    if curl -sf http://localhost:11434/api/tags &>/dev/null; then
      break
    fi
    sleep 2
  done
  OLLAMA_URL="http://localhost:11434"
  CLEANUP_OLLAMA=true
fi

for model in "${OLLAMA_MODELS[@]}"; do
  log_info "  Pulling model: ${model}"
  curl -sf "${OLLAMA_URL}/api/pull" -d "{\"name\":\"${model}\"}" || {
    log_warn "  Failed to pull model ${model}, skipping..."
    continue
  }
  log_info "  Model ready: ${model}"
done

# Cleanup temporary container if we started one
if [ "${CLEANUP_OLLAMA:-false}" = "true" ]; then
  log_info "Stopping temporary Ollama container..."
  docker stop airgap-ollama-temp && docker rm airgap-ollama-temp
fi

log_info "Ollama models cached in ${MODELS_DIR}/"

# ---------------------------------------------------------------------------
# 4. Verify all dependencies
# ---------------------------------------------------------------------------

log_info "Verifying all dependencies..."

VERIFY_PASS=true

# Verify Docker images exist
for image in "${DOCKER_IMAGES[@]}"; do
  if docker image inspect "${image}" &>/dev/null; then
    log_info "  [OK] Image: ${image}"
  else
    log_error "  [MISSING] Image: ${image}"
    VERIFY_PASS=false
  fi
done

# Verify saved tars
for image in "${DOCKER_IMAGES[@]}"; do
  safe_name=$(echo "${image}" | tr '/:' '__')
  tar_path="${IMAGES_DIR}/${safe_name}.tar"
  if [ -f "${tar_path}" ]; then
    log_info "  [OK] Tar: ${tar_path}"
  else
    log_warn "  [MISSING] Tar: ${tar_path}"
  fi
done

# Verify docker-compose file exists
if [ -f "${SCRIPT_DIR}/docker-compose.airgap.yml" ]; then
  log_info "  [OK] docker-compose.airgap.yml"
else
  log_error "  [MISSING] docker-compose.airgap.yml"
  VERIFY_PASS=false
fi

# Verify litellm config exists
if [ -f "${SCRIPT_DIR}/litellm-airgap.yaml" ]; then
  log_info "  [OK] litellm-airgap.yaml"
else
  log_warn "  [MISSING] litellm-airgap.yaml"
fi

if [ "${VERIFY_PASS}" = "true" ]; then
  log_info ""
  log_info "============================================"
  log_info "  Air-gapped setup complete!"
  log_info "============================================"
  log_info ""
  log_info "To deploy:"
  log_info "  cd ${SCRIPT_DIR}"
  log_info "  docker compose -f docker-compose.airgap.yml --env-file .env.airgap up -d"
  log_info ""
  log_info "To load saved images on an air-gapped machine:"
  log_info "  for f in ${IMAGES_DIR}/*.tar; do docker load -i \"\$f\"; done"
else
  log_error ""
  log_error "Some dependencies are missing. Check the output above."
  exit 1
fi
