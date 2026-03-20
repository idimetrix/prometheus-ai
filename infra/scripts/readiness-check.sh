#!/usr/bin/env bash
set -euo pipefail

# Production Readiness Checklist Automation
# Verifies all production prerequisites before deployment

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

FAILURES=0
WARNINGS=0
TOTAL=0

check() {
  TOTAL=$((TOTAL + 1))
  local name="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    echo -e "${GREEN}✓${NC} $name"
  else
    echo -e "${RED}✗${NC} $name"
    FAILURES=$((FAILURES + 1))
  fi
}

warn() {
  TOTAL=$((TOTAL + 1))
  local name="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    echo -e "${GREEN}✓${NC} $name"
  else
    echo -e "${YELLOW}⚠${NC} $name"
    WARNINGS=$((WARNINGS + 1))
  fi
}

echo "═══════════════════════════════════════════════════"
echo "  Prometheus Production Readiness Check"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Environment Variables ─────────────────────────────
echo "📋 Environment Variables"
check "DATABASE_URL is set" "$([ -n "${DATABASE_URL:-}" ] && echo 0 || echo 1)"
check "REDIS_URL is set" "$([ -n "${REDIS_URL:-}" ] && echo 0 || echo 1)"
check "CLERK_SECRET_KEY is set" "$([ -n "${CLERK_SECRET_KEY:-}" ] && echo 0 || echo 1)"
check "STRIPE_SECRET_KEY is set" "$([ -n "${STRIPE_SECRET_KEY:-}" ] && echo 0 || echo 1)"
check "STRIPE_WEBHOOK_SECRET is set" "$([ -n "${STRIPE_WEBHOOK_SECRET:-}" ] && echo 0 || echo 1)"
check "ENCRYPTION_KEY is set" "$([ -n "${ENCRYPTION_KEY:-}" ] && echo 0 || echo 1)"
echo ""

# ── Database ──────────────────────────────────────────
echo "🗄️  Database"
if command -v psql &>/dev/null && [ -n "${DATABASE_URL:-}" ]; then
  check "PostgreSQL connectivity" "$(psql "$DATABASE_URL" -c 'SELECT 1' &>/dev/null && echo 0 || echo 1)"
  check "Migrations up to date" "$(pnpm db:check 2>/dev/null && echo 0 || echo 1)"
else
  warn "PostgreSQL check (psql not available)" "1"
fi
echo ""

# ── Redis ─────────────────────────────────────────────
echo "📦 Redis"
if command -v redis-cli &>/dev/null && [ -n "${REDIS_URL:-}" ]; then
  check "Redis connectivity" "$(redis-cli -u "$REDIS_URL" ping 2>/dev/null | grep -q PONG && echo 0 || echo 1)"
else
  warn "Redis check (redis-cli not available)" "1"
fi
echo ""

# ── Kubernetes ────────────────────────────────────────
echo "☸️  Kubernetes"
if command -v kubectl &>/dev/null; then
  check "kubectl configured" "$(kubectl cluster-info &>/dev/null && echo 0 || echo 1)"
  check "Namespace exists" "$(kubectl get namespace prometheus &>/dev/null && echo 0 || echo 1)"
  check "PDBs configured" "$(kubectl get pdb -n prometheus 2>/dev/null | grep -q api && echo 0 || echo 1)"
  check "Network policies exist" "$(kubectl get networkpolicy -n prometheus 2>/dev/null | grep -q default-deny && echo 0 || echo 1)"
  warn "KEDA autoscalers configured" "$(kubectl get scaledobject -n prometheus 2>/dev/null | grep -q . && echo 0 || echo 1)"
else
  warn "Kubernetes check (kubectl not available)" "1"
fi
echo ""

# ── Health Checks ─────────────────────────────────────
echo "🏥 Service Health"
SERVICES=("api:4000" "orchestrator:4002" "project-brain:4003" "model-router:4004" "mcp-gateway:4005" "sandbox-manager:4006" "socket-server:4001")
for svc in "${SERVICES[@]}"; do
  IFS=':' read -r name port <<< "$svc"
  warn "$name health" "$(curl -sf "http://localhost:$port/health" &>/dev/null && echo 0 || echo 1)"
done
echo ""

# ── Code Quality ──────────────────────────────────────
echo "🔍 Code Quality"
check "TypeScript compiles" "$(pnpm typecheck 2>/dev/null && echo 0 || echo 1)"
check "Lint passes" "$(pnpm unsafe 2>/dev/null && echo 0 || echo 1)"
warn "Tests pass" "$(pnpm test 2>/dev/null && echo 0 || echo 1)"
echo ""

# ── Summary ───────────────────────────────────────────
echo "═══════════════════════════════════════════════════"
if [ "$FAILURES" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "${GREEN}All $TOTAL checks passed. Ready for deployment!${NC}"
  exit 0
elif [ "$FAILURES" -eq 0 ]; then
  echo -e "${YELLOW}$TOTAL checks complete: $WARNINGS warnings, 0 failures${NC}"
  echo "Deployment can proceed with caution."
  exit 0
else
  echo -e "${RED}$TOTAL checks complete: $FAILURES failures, $WARNINGS warnings${NC}"
  echo "Fix failures before deploying."
  exit 1
fi
