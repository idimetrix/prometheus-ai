#!/usr/bin/env bash
# Validates Grafana dashboard JSON files
# Checks: valid JSON, all panels have datasource, no empty queries

set -euo pipefail

DASHBOARD_DIR="${1:-$(dirname "$0")/../monitoring/grafana/dashboards}"
EXIT_CODE=0
CHECKED=0
ISSUES=0

if [ ! -d "$DASHBOARD_DIR" ]; then
  echo "ERROR: Dashboard directory not found: $DASHBOARD_DIR"
  exit 1
fi

echo "=== Grafana Dashboard Verification ==="
echo "Scanning: $DASHBOARD_DIR"
echo ""

for file in "$DASHBOARD_DIR"/*.json; do
  [ -f "$file" ] || continue
  CHECKED=$((CHECKED + 1))
  basename=$(basename "$file")
  file_issues=0

  # 1. Valid JSON
  if ! jq empty "$file" 2>/dev/null; then
    echo "FAIL  [$basename] Invalid JSON"
    ISSUES=$((ISSUES + 1))
    EXIT_CODE=1
    continue
  fi

  # Extract dashboard title
  title=$(jq -r '.title // "Untitled"' "$file")
  panel_count=$(jq '[.panels // [] | .[] ] | length' "$file")

  # 2. Has panels array
  has_panels=$(jq 'has("panels")' "$file")
  if [ "$has_panels" != "true" ]; then
    echo "WARN  [$basename] ($title) Missing \"panels\" array"
    file_issues=$((file_issues + 1))
  fi

  # 3. Each panel has targets (queries)
  panels_without_targets=$(jq '[.panels // [] | .[] | select(.type != "row") | select((.targets // []) | length == 0)] | length' "$file")
  if [ "$panels_without_targets" -gt 0 ]; then
    echo "WARN  [$basename] ($title) $panels_without_targets panel(s) without targets/queries"
    file_issues=$((file_issues + 1))
  fi

  # 4. No empty query strings in targets
  empty_queries=$(jq '[.panels // [] | .[] | .targets // [] | .[] | select(.expr == "" or .query == "" or .rawSql == "")] | length' "$file")
  if [ "$empty_queries" -gt 0 ]; then
    echo "WARN  [$basename] ($title) $empty_queries target(s) with empty query strings"
    file_issues=$((file_issues + 1))
  fi

  # 5. Each panel with targets has a datasource
  panels_without_ds=$(jq '[.panels // [] | .[] | select(.type != "row") | select((.targets // []) | length > 0) | select(.datasource == null)] | length' "$file")
  if [ "$panels_without_ds" -gt 0 ]; then
    echo "WARN  [$basename] ($title) $panels_without_ds panel(s) missing datasource"
    file_issues=$((file_issues + 1))
  fi

  ISSUES=$((ISSUES + file_issues))
  if [ "$file_issues" -eq 0 ]; then
    echo "OK    [$basename] ($title) - $panel_count panels"
  else
    EXIT_CODE=1
  fi
done

echo ""
echo "=== Summary ==="
echo "Dashboards checked: $CHECKED"
echo "Issues found:       $ISSUES"

exit $EXIT_CODE
