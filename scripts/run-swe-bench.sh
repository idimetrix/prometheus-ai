#!/usr/bin/env bash
# SWE-bench benchmark runner for Prometheus
# Runs SWE-bench Lite and records results
#
# Usage:
#   ./scripts/run-swe-bench.sh
#   ./scripts/run-swe-bench.sh --dataset swe-bench-lite
#   ORCHESTRATOR_URL=http://localhost:4002 ./scripts/run-swe-bench.sh

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:4002}"
API_URL="${API_URL:-http://localhost:4000}"
DATASET="${1:-swe-bench-lite}"
RESULTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/benchmarks/results"
DATE="$(date +%Y-%m-%d)"
RESULTS_FILE="${RESULTS_DIR}/swe-bench-${DATE}.json"
TIMEOUT_PER_TASK="${TIMEOUT_PER_TASK:-300}" # 5 minutes per task
MAX_TASKS="${MAX_TASKS:-0}" # 0 = all tasks

# ─── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Check required tools
for cmd in curl jq node; do
  if ! command -v "$cmd" &> /dev/null; then
    log_error "Required command '${cmd}' not found"
    PREREQS_OK=false
  fi
done

# Check services are running
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

# ─── Run SWE-bench Lite ──────────────────────────────────────────────────────

log_info "Starting SWE-bench Lite benchmark..."
log_info "  Dataset:    ${DATASET}"
log_info "  Results:    ${RESULTS_FILE}"
log_info "  Timeout:    ${TIMEOUT_PER_TASK}s per task"
log_info "  Max tasks:  ${MAX_TASKS:-all}"

START_TIME=$(date +%s)

# Initialize results
PASSED=0
FAILED=0
ERRORED=0
TOTAL_COST=0
TASK_RESULTS="[]"

# Fetch task list from the orchestrator
TASKS_RESPONSE=$(curl -sf "${ORCHESTRATOR_URL}/api/benchmarks/${DATASET}/tasks" 2>/dev/null || echo '{"tasks":[]}')
TASK_COUNT=$(echo "$TASKS_RESPONSE" | jq '.tasks | length')

if [ "$TASK_COUNT" -eq 0 ]; then
  log_warn "No tasks found for dataset '${DATASET}'. Using sample tasks for dry run."
  TASK_COUNT=5
  TASKS_RESPONSE='{"tasks":["django__django-11099","django__django-11179","django__django-11283","django__django-11422","django__django-11620"]}'
fi

if [ "$MAX_TASKS" -gt 0 ] && [ "$MAX_TASKS" -lt "$TASK_COUNT" ]; then
  TASK_COUNT=$MAX_TASKS
fi

log_info "Running ${TASK_COUNT} tasks..."

for i in $(seq 0 $((TASK_COUNT - 1))); do
  TASK_ID=$(echo "$TASKS_RESPONSE" | jq -r ".tasks[$i]")
  TASK_START=$(date +%s)

  log_info "  [$(( i + 1 ))/${TASK_COUNT}] ${TASK_ID}..."

  # Submit task to orchestrator
  TASK_RESULT=$(curl -sf --max-time "$TIMEOUT_PER_TASK" \
    -X POST "${ORCHESTRATOR_URL}/api/benchmarks/run" \
    -H "Content-Type: application/json" \
    -d "{\"taskId\": \"${TASK_ID}\", \"dataset\": \"${DATASET}\"}" \
    2>/dev/null || echo '{"status":"error","error":"timeout or connection failed"}')

  TASK_END=$(date +%s)
  TASK_DURATION=$((TASK_END - TASK_START))

  STATUS=$(echo "$TASK_RESULT" | jq -r '.status // "error"')
  COST=$(echo "$TASK_RESULT" | jq -r '.cost // 0')

  case "$STATUS" in
    passed)
      PASSED=$((PASSED + 1))
      log_ok "    PASSED (${TASK_DURATION}s, \$${COST})"
      ;;
    failed)
      FAILED=$((FAILED + 1))
      log_warn "    FAILED (${TASK_DURATION}s, \$${COST})"
      ;;
    *)
      ERRORED=$((ERRORED + 1))
      log_error "    ERROR (${TASK_DURATION}s)"
      ;;
  esac

  TOTAL_COST=$(echo "$TOTAL_COST + ${COST}" | bc 2>/dev/null || echo "$TOTAL_COST")

  # Append task result
  TASK_RESULTS=$(echo "$TASK_RESULTS" | jq \
    --arg id "$TASK_ID" \
    --arg status "$STATUS" \
    --argjson duration "$TASK_DURATION" \
    --arg cost "$COST" \
    '. + [{"taskId": $id, "status": $status, "durationSeconds": $duration, "cost": $cost}]')
done

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))
TOTAL_TASKS=$((PASSED + FAILED + ERRORED))

# Calculate pass rate
if [ "$TOTAL_TASKS" -gt 0 ]; then
  PASS_RATE=$(echo "scale=2; $PASSED * 100 / $TOTAL_TASKS" | bc 2>/dev/null || echo "0")
  AVG_TIME=$(echo "scale=1; $TOTAL_DURATION / $TOTAL_TASKS" | bc 2>/dev/null || echo "0")
else
  PASS_RATE="0"
  AVG_TIME="0"
fi

# ─── Write Results ────────────────────────────────────────────────────────────

jq -n \
  --arg dataset "$DATASET" \
  --arg date "$DATE" \
  --arg timestamp "$(date -Iseconds)" \
  --argjson totalTasks "$TOTAL_TASKS" \
  --argjson passed "$PASSED" \
  --argjson failed "$FAILED" \
  --argjson errored "$ERRORED" \
  --arg passRate "${PASS_RATE}%" \
  --arg avgTimePerTask "${AVG_TIME}s" \
  --argjson totalDuration "$TOTAL_DURATION" \
  --arg totalCost "\$${TOTAL_COST}" \
  --argjson tasks "$TASK_RESULTS" \
  '{
    benchmark: "swe-bench",
    dataset: $dataset,
    date: $date,
    timestamp: $timestamp,
    summary: {
      totalTasks: $totalTasks,
      passed: $passed,
      failed: $failed,
      errored: $errored,
      passRate: $passRate,
      avgTimePerTask: $avgTimePerTask,
      totalDurationSeconds: $totalDuration,
      totalCost: $totalCost
    },
    tasks: $tasks
  }' > "$RESULTS_FILE"

log_ok "Results written to ${RESULTS_FILE}"

# ─── Print Summary ────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════"
echo "  SWE-bench Lite Benchmark Results"
echo "═══════════════════════════════════════════════"
echo "  Dataset:         ${DATASET}"
echo "  Date:            ${DATE}"
echo "  Total tasks:     ${TOTAL_TASKS}"
echo "  Passed:          ${PASSED}"
echo "  Failed:          ${FAILED}"
echo "  Errored:         ${ERRORED}"
echo "  Pass rate:       ${PASS_RATE}%"
echo "  Avg time/task:   ${AVG_TIME}s"
echo "  Total duration:  ${TOTAL_DURATION}s"
echo "  Total cost:      \$${TOTAL_COST}"
echo "═══════════════════════════════════════════════"
echo ""
