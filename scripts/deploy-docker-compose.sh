#!/usr/bin/env bash
# deploy-docker-compose.sh — Deploy Prometheus via Docker Compose (self-hosted).
#
# Usage:
#   ./scripts/deploy-docker-compose.sh [command]
#
# Commands:
#   up       Start all services (default)
#   down     Stop all services
#   restart  Restart all services
#   build    Build all service images locally
#   pull     Pull latest images from registry
#   logs     Tail logs from all services
#   status   Show running containers
#   migrate  Run database migrations
#   health   Check health of all services
#
# Environment variables:
#   IMAGE_TAG        Container image tag (default: latest)
#   IMAGE_REGISTRY   Container registry (default: ghcr.io/prometheus)
#   COMPOSE_FILE     Override compose file path
#   ENV_FILE         Override .env file path

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/infra/docker/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io/prometheus}"
COMMAND="${1:-up}"

export IMAGE_TAG IMAGE_REGISTRY

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

check_prerequisites() {
  if ! command -v docker &>/dev/null; then
    error "docker not found. Install Docker: https://docs.docker.com/get-docker/"
    exit 1
  fi

  if ! docker compose version &>/dev/null; then
    error "docker compose not found. Install Docker Compose v2."
    exit 1
  fi

  if [ ! -f "${COMPOSE_FILE}" ]; then
    error "Compose file not found: ${COMPOSE_FILE}"
    exit 1
  fi

  if [ ! -f "${ENV_FILE}" ]; then
    error "Environment file not found: ${ENV_FILE}"
    error "Copy .env.example to .env and configure it."
    exit 1
  fi
}

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

cmd_up() {
  log "Starting Prometheus services..."
  log "Compose file: ${COMPOSE_FILE}"
  log "Image tag: ${IMAGE_TAG}"

  compose up -d --remove-orphans

  log "Services started. Waiting for health checks..."
  sleep 5
  cmd_health
}

cmd_down() {
  log "Stopping all Prometheus services..."
  compose down
  log "Services stopped."
}

cmd_restart() {
  log "Restarting all Prometheus services..."
  compose restart
  sleep 5
  cmd_health
}

cmd_build() {
  log "Building all service images locally..."
  compose build --parallel
  log "Build complete."
}

cmd_pull() {
  log "Pulling latest images from ${IMAGE_REGISTRY}..."
  compose pull
  log "Pull complete."
}

cmd_logs() {
  compose logs -f --tail=100
}

cmd_status() {
  compose ps
}

cmd_migrate() {
  log "Running database migrations..."
  compose exec api node -e "
    import('./dist/index.js').catch(() => {});
  " 2>/dev/null || true

  # Run migrations via a one-off container
  compose run --rm --no-deps api sh -c "node dist/migrate.js" 2>/dev/null || {
    log "Running migrations via pnpm..."
    compose run --rm --no-deps api pnpm db:migrate
  }
  log "Migrations complete."
}

cmd_health() {
  log "Checking service health..."
  local services
  services=$(compose ps --format json 2>/dev/null | jq -r '.Name' 2>/dev/null || compose ps --services)

  local all_healthy=true

  declare -A SERVICE_PORTS=(
    ["api"]=4000
    ["web"]=3000
    ["socket-server"]=4001
    ["orchestrator"]=4002
    ["project-brain"]=4003
    ["model-router"]=4004
    ["mcp-gateway"]=4005
    ["sandbox-manager"]=4006
  )

  for service in api web socket-server orchestrator project-brain model-router mcp-gateway sandbox-manager; do
    local port="${SERVICE_PORTS[$service]:-}"
    if [ -n "${port}" ]; then
      if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
        log "  ${service}: healthy"
      elif curl -sf "http://localhost:${port}/" >/dev/null 2>&1; then
        log "  ${service}: responding (no /health endpoint)"
      else
        error "  ${service}: not responding on port ${port}"
        all_healthy=false
      fi
    fi
  done

  # Check infrastructure
  if docker exec prometheus-postgres pg_isready -U prometheus >/dev/null 2>&1; then
    log "  postgres: healthy"
  else
    error "  postgres: not responding"
    all_healthy=false
  fi

  if docker exec prometheus-redis redis-cli ping >/dev/null 2>&1; then
    log "  redis: healthy"
  else
    error "  redis: not responding"
    all_healthy=false
  fi

  if [ "${all_healthy}" = true ]; then
    log "All services healthy."
  else
    error "Some services are unhealthy."
    return 1
  fi
}

main() {
  check_prerequisites

  case "${COMMAND}" in
    up)       cmd_up ;;
    down)     cmd_down ;;
    restart)  cmd_restart ;;
    build)    cmd_build ;;
    pull)     cmd_pull ;;
    logs)     cmd_logs ;;
    status)   cmd_status ;;
    migrate)  cmd_migrate ;;
    health)   cmd_health ;;
    *)
      error "Unknown command: ${COMMAND}"
      echo "Usage: $0 {up|down|restart|build|pull|logs|status|migrate|health}"
      exit 1
      ;;
  esac
}

main "$@"
