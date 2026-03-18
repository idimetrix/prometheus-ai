#!/usr/bin/env bash
##############################################################################
# setup-dev.sh - Set up Prometheus development environment
# Usage: bash infra/scripts/setup-dev.sh [--skip-docker] [--skip-seed]
##############################################################################

set -e

SKIP_DOCKER=false
SKIP_SEED=false

for arg in "$@"; do
  case "$arg" in
    --skip-docker) SKIP_DOCKER=true ;;
    --skip-seed) SKIP_SEED=true ;;
    --help|-h)
      echo "Usage: bash infra/scripts/setup-dev.sh [--skip-docker] [--skip-seed]"
      echo "  --skip-docker  Skip starting Docker infrastructure"
      echo "  --skip-seed    Skip database seeding"
      exit 0
      ;;
  esac
done

echo "============================================"
echo "  Prometheus Development Setup"
echo "============================================"
echo ""

# Check prerequisites
echo "[1/6] Checking prerequisites..."
MISSING=""
command -v node >/dev/null 2>&1 || MISSING="${MISSING} node"
command -v pnpm >/dev/null 2>&1 || MISSING="${MISSING} pnpm"
command -v docker >/dev/null 2>&1 || MISSING="${MISSING} docker"
command -v git >/dev/null 2>&1 || MISSING="${MISSING} git"

if [ -n "$MISSING" ]; then
  echo "ERROR: Missing required tools:${MISSING}"
  echo "  node   - https://nodejs.org (v22+)"
  echo "  pnpm   - npm install -g pnpm"
  echo "  docker - https://docker.com"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required. Current: $(node -v)"
  exit 1
fi

echo "  Node.js $(node -v)"
echo "  pnpm $(pnpm -v)"
echo "  Docker $(docker --version | grep -oP 'version \K[^,]+')"
echo ""

# Start infrastructure
if [ "$SKIP_DOCKER" = false ]; then
  echo "[2/6] Starting infrastructure services..."
  docker compose up -d postgres redis minio

  echo "  Waiting for PostgreSQL..."
  RETRIES=30
  until docker compose exec -T postgres pg_isready -U prometheus >/dev/null 2>&1; do
    RETRIES=$((RETRIES - 1))
    if [ "$RETRIES" -le 0 ]; then
      echo "ERROR: PostgreSQL failed to start within 30 seconds"
      exit 1
    fi
    sleep 1
  done
  echo "  PostgreSQL ready"

  echo "  Waiting for Redis..."
  RETRIES=15
  until docker compose exec -T redis redis-cli ping >/dev/null 2>&1; do
    RETRIES=$((RETRIES - 1))
    if [ "$RETRIES" -le 0 ]; then
      echo "ERROR: Redis failed to start within 15 seconds"
      exit 1
    fi
    sleep 1
  done
  echo "  Redis ready"
else
  echo "[2/6] Skipping Docker infrastructure (--skip-docker)"
fi
echo ""

# Setup environment
echo "[3/6] Configuring environment..."
if [ ! -f .env ]; then
  if [ ! -f .env.example ]; then
    echo "ERROR: .env.example not found"
    exit 1
  fi
  cp .env.example .env

  # Generate encryption key
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/^ENCRYPTION_KEY=$/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
  echo "  Created .env from .env.example"
  echo "  Generated ENCRYPTION_KEY"
else
  echo "  .env already exists (skipping)"
fi
echo ""

# Install dependencies
echo "[4/6] Installing dependencies..."
pnpm install
echo ""

# Push database schema
echo "[5/6] Pushing database schema..."
pnpm db:push
echo ""

# Seed database
if [ "$SKIP_SEED" = false ]; then
  echo "[6/6] Seeding database..."
  pnpm db:seed
else
  echo "[6/6] Skipping database seed (--skip-seed)"
fi
echo ""

echo "============================================"
echo "  Setup complete!"
echo ""
echo "  Start development:"
echo "    pnpm dev"
echo ""
echo "  Services:"
echo "    Web:              http://localhost:3000"
echo "    API:              http://localhost:4000"
echo "    Socket Server:    http://localhost:4001"
echo "    Orchestrator:     http://localhost:4002"
echo "    Project Brain:    http://localhost:4003"
echo "    Model Router:     http://localhost:4004"
echo "    MCP Gateway:      http://localhost:4005"
echo "    Sandbox Manager:  http://localhost:4006"
echo ""
echo "  Health check:"
echo "    bash infra/scripts/healthcheck.sh"
echo "============================================"
