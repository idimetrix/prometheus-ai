#!/bin/bash
# Development environment setup script
# Usage: bash infra/scripts/setup-dev.sh

set -e

echo "╔══════════════════════════════════════════╗"
echo "║  PROMETHEUS Development Setup            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check prerequisites
echo "Checking prerequisites..."
command -v node >/dev/null 2>&1 || { echo "Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required. Run: npm install -g pnpm"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install from https://docker.com"; exit 1; }

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "Node.js 22+ required. Current: $(node -v)"
  exit 1
fi

echo "  Node.js $(node -v) ✓"
echo "  pnpm $(pnpm -v) ✓"
echo "  Docker $(docker -v | grep -oP 'version \K[^,]+') ✓"
echo ""

# Start infrastructure
echo "Starting infrastructure services..."
docker compose up -d postgres redis minio
echo "  Waiting for PostgreSQL..."
until docker compose exec -T postgres pg_isready -U prometheus >/dev/null 2>&1; do
  sleep 1
done
echo "  PostgreSQL ready ✓"
echo "  Redis ready ✓"
echo ""

# Setup environment
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env

  # Generate encryption key
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/^ENCRYPTION_KEY=$/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
  echo "  Generated ENCRYPTION_KEY ✓"
fi

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Push database schema
echo "Pushing database schema..."
pnpm db:push

# Seed database
echo "Seeding database..."
pnpm db:seed

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Setup complete!                         ║"
echo "║                                          ║"
echo "║  Start development:                      ║"
echo "║    pnpm dev                              ║"
echo "║                                          ║"
echo "║  Services:                               ║"
echo "║    Web:          http://localhost:3000    ║"
echo "║    API:          http://localhost:4000    ║"
echo "║    Socket.io:    http://localhost:4001    ║"
echo "║                                          ║"
echo "║  Health check:                           ║"
echo "║    bash infra/scripts/healthcheck.sh     ║"
echo "╚══════════════════════════════════════════╝"
