#!/usr/bin/env bash
# HumanEval benchmark runner for Prometheus
# Runs HumanEval (164 problems) and records results
#
# Usage:
#   ./scripts/run-humaneval.sh
#   ORCHESTRATOR_URL=http://localhost:4002 ./scripts/run-humaneval.sh

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:4002}"
API_URL="${API_URL:-http://localhost:4000}"
RESULTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/benchmarks/results"
DATE="$(date +%Y-%m-%d)"
RESULTS_FILE="${RESULTS_DIR}/humaneval-${DATE}.json"
TIMEOUT_PER_PROBLEM="${TIMEOUT_PER_PROBLEM:-120}" # 2 minutes per problem
MAX_PROBLEMS="${MAX_PROBLEMS:-0}" # 0 = all problems

# ─── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Helper Functions ─────────────────────────────────────────────────────────

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_service() {
  local name="$1"
  local url="$2"
  if curl -sf "${url}" > /dev/null 2>&1; then
    log_ok "${name} is reachable at ${url}"
    return 0
  else
    log_error "${name} is not reachable at ${url}"
    return 1
  fi
}

# ─── Prerequisites Check ─────────────────────────────────────────────────────

log_info "Checking prerequisites..."

PREREQS_OK=true

for cmd in curl jq node; do
  if ! command -v "$cmd" &> /dev/null; then
    log_error "Required command '${cmd}' not found"
    PREREQS_OK=false
  fi
done

if ! check_service "Orchestrator" "${ORCHESTRATOR_URL}/health"; then
  PREREQS_OK=false
fi

if ! check_service "API" "${API_URL}/api/trpc/health.check"; then
  PREREQS_OK=false
fi

if [ "$PREREQS_OK" = false ]; then
  log_error "Prerequisites check failed. Ensure all services are running:"
  log_error "  pnpm dev"
  exit 1
fi

log_ok "All prerequisites met"

# ─── Ensure Results Directory ─────────────────────────────────────────────────

mkdir -p "$RESULTS_DIR"

# ─── Run HumanEval ────────────────────────────────────────────────────────────

log_info "Starting HumanEval benchmark..."
log_info "  Results:    ${RESULTS_FILE}"
log_info "  Timeout:    ${TIMEOUT_PER_PROBLEM}s per problem"
log_info "  Max probs:  ${MAX_PROBLEMS:-all}"

START_TIME=$(date +%s)

PASSED=0
FAILED=0
ERRORED=0
TOTAL_COST=0
PROBLEM_RESULTS="[]"

# Fetch problem list from the orchestrator
PROBLEMS_RESPONSE=$(curl -sf "${ORCHESTRATOR_URL}/api/benchmarks/humaneval/problems" 2>/dev/null || echo '{"problems":[]}')
PROBLEM_COUNT=$(echo "$PROBLEMS_RESPONSE" | jq '.problems | length')

if [ "$PROBLEM_COUNT" -eq 0 ]; then
  log_warn "No problems returned from orchestrator. Using sample set for dry run."
  PROBLEM_COUNT=5
  PROBLEMS_RESPONSE='{"problems":["HumanEval/0","HumanEval/1","HumanEval/2","HumanEval/3","HumanEval/4"]}'
fi

if [ "$MAX_PROBLEMS" -gt 0 ] && [ "$MAX_PROBLEMS" -lt "$PROBLEM_COUNT" ]; then
  PROBLEM_COUNT=$MAX_PROBLEMS
fi

log_info "Running ${PROBLEM_COUNT} problems..."

for i in $(seq 0 $((PROBLEM_COUNT - 1))); do
  PROBLEM_ID=$(echo "$PROBLEMS_RESPONSE" | jq -r ".problems[$i]")
  PROBLEM_START=$(date +%s)

  log_info "  [$(( i + 1 ))/${PROBLEM_COUNT}] ${PROBLEM_ID}..."

  # Submit problem to orchestrator
  PROBLEM_RESULT=$(curl -sf --max-time "$TIMEOUT_PER_PROBLEM" \
    -X POST "${ORCHESTRATOR_URL}/api/benchmarks/run" \
    -H "Content-Type: application/json" \
    -d "{\"taskId\": \"${PROBLEM_ID}\", \"dataset\": \"humaneval\"}" \
    2>/dev/null || echo '{"status":"error","error":"timeout or connection failed"}')

  PROBLEM_END=$(date +%s)
  PROBLEM_DURATION=$((PROBLEM_END - PROBLEM_START))

  STATUS=$(echo "$PROBLEM_RESULT" | jq -r '.status // "error"')
  COST=$(echo "$PROBLEM_RESULT" | jq -r '.cost // 0')

  case "$STATUS" in
    passed)
      PASSED=$((PASSED + 1))
      log_ok "    PASSED (${PROBLEM_DURATION}s, \$${COST})"
      ;;
    failed)
      FAILED=$((FAILED + 1))
      log_warn "    FAILED (${PROBLEM_DURATION}s, \$${COST})"
      ;;
    *)
      ERRORED=$((ERRORED + 1))
      log_error "    ERROR (${PROBLEM_DURATION}s)"
      ;;
  esac

  TOTAL_COST=$(echo "$TOTAL_COST + ${COST}" | bc 2>/dev/null || echo "$TOTAL_COST")

  PROBLEM_RESULTS=$(echo "$PROBLEM_RESULTS" | jq \
    --arg id "$PROBLEM_ID" \
    --arg status "$STATUS" \
    --argjson duration "$PROBLEM_DURATION" \
    --arg cost "$COST" \
    '. + [{"problemId": $id, "status": $status, "durationSeconds": $duration, "cost": $cost}]')
done

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))
TOTAL_PROBLEMS=$((PASSED + FAILED + ERRORED))

if [ "$TOTAL_PROBLEMS" -gt 0 ]; then
  PASS_RATE=$(echo "scale=2; $PASSED * 100 / $TOTAL_PROBLEMS" | bc 2>/dev/null || echo "0")
  AVG_TIME=$(echo "scale=1; $TOTAL_DURATION / $TOTAL_PROBLEMS" | bc 2>/dev/null || echo "0")
else
  PASS_RATE="0"
  AVG_TIME="0"
fi

# ─── Write Results ────────────────────────────────────────────────────────────

jq -n \
  --arg date "$DATE" \
  --arg timestamp "$(date -Iseconds)" \
  --argjson totalProblems "$TOTAL_PROBLEMS" \
  --argjson passed "$PASSED" \
  --argjson failed "$FAILED" \
  --argjson errored "$ERRORED" \
  --arg passRate "${PASS_RATE}%" \
  --arg avgTimePerProblem "${AVG_TIME}s" \
  --argjson totalDuration "$TOTAL_DURATION" \
  --arg totalCost "\$${TOTAL_COST}" \
  --argjson problems "$PROBLEM_RESULTS" \
  '{
    benchmark: "humaneval",
    date: $date,
    timestamp: $timestamp,
    summary: {
      totalProblems: $totalProblems,
      passed: $passed,
      failed: $failed,
      errored: $errored,
      passRate: $passRate,
      avgTimePerProblem: $avgTimePerProblem,
      totalDurationSeconds: $totalDuration,
      totalCost: $totalCost
    },
    problems: $problems
  }' > "$RESULTS_FILE"

log_ok "Results written to ${RESULTS_FILE}"

# ─── Print Summary ────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════"
echo "  HumanEval Benchmark Results"
echo "═══════════════════════════════════════════════"
echo "  Date:            ${DATE}"
echo "  Total problems:  ${TOTAL_PROBLEMS}"
echo "  Passed:          ${PASSED}"
echo "  Failed:          ${FAILED}"
echo "  Errored:         ${ERRORED}"
echo "  Pass rate:       ${PASS_RATE}%"
echo "  Avg time/prob:   ${AVG_TIME}s"
echo "  Total duration:  ${TOTAL_DURATION}s"
echo "  Total cost:      \$${TOTAL_COST}"
echo "═══════════════════════════════════════════════"
echo ""
