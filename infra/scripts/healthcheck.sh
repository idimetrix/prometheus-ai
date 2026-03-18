#!/bin/bash
# Health check script for all PROMETHEUS services
# Usage: bash infra/scripts/healthcheck.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SERVICES=(
  "Web:http://localhost:3000"
  "API:http://localhost:4000/health"
  "Socket:http://localhost:4001"
  "Orchestrator:http://localhost:4002/health"
  "Project Brain:http://localhost:4003/health"
  "Model Router:http://localhost:4004/health"
  "MCP Gateway:http://localhost:4005/health"
  "Sandbox Manager:http://localhost:4006/health"
)

INFRA=(
  "PostgreSQL:localhost:5432"
  "Redis:localhost:6379"
  "MinIO:localhost:9000"
)

echo "╔══════════════════════════════════════════╗"
echo "║     PROMETHEUS Health Check              ║"
echo "╠══════════════════════════════════════════╣"

# Check infrastructure
echo "║ Infrastructure:                          ║"
for entry in "${INFRA[@]}"; do
  name="${entry%%:*}"
  hostport="${entry#*:}"
  host="${hostport%%:*}"
  port="${hostport#*:}"

  if nc -z "$host" "$port" 2>/dev/null; then
    printf "║   ${GREEN}✓${NC} %-36s ║\n" "$name ($port)"
  else
    printf "║   ${RED}✗${NC} %-36s ║\n" "$name ($port)"
  fi
done

echo "║                                          ║"
echo "║ Services:                                ║"

# Check services
for entry in "${SERVICES[@]}"; do
  name="${entry%%:*}"
  url="${entry#*:}"

  status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "$url" 2>/dev/null || echo "000")

  if [ "$status" -ge 200 ] && [ "$status" -lt 400 ]; then
    printf "║   ${GREEN}✓${NC} %-36s ║\n" "$name ($status)"
  elif [ "$status" = "000" ]; then
    printf "║   ${YELLOW}○${NC} %-36s ║\n" "$name (not running)"
  else
    printf "║   ${RED}✗${NC} %-36s ║\n" "$name ($status)"
  fi
done

echo "╚══════════════════════════════════════════╝"
