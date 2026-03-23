#!/usr/bin/env bash
set -euo pipefail

# Cloud Burst Script - Provision Hetzner CX42 when queue depth > 20
# Usage: ./cloud-burst.sh [check|provision|drain|cleanup]

ACTION="${1:-check}"
HCLOUD_TOKEN="${HCLOUD_TOKEN:?HCLOUD_TOKEN required}"
QUEUE_THRESHOLD=20
IDLE_TIMEOUT=600  # 10 minutes
BURST_LABEL="role=burst-worker"
SERVER_TYPE="cx42"
IMAGE="ubuntu-22.04"
LOCATION="fsn1"
K3S_TOKEN="${K3S_TOKEN:?K3S_TOKEN required}"
K3S_URL="${K3S_URL:?K3S_URL required}"

check_queue_depth() {
  local depth
  depth=$(redis-cli -u "${REDIS_URL:-redis://localhost:6379}" LLEN "bull:tasks:waiting" 2>/dev/null || echo "0")
  echo "$depth"
}

provision_burst_node() {
  local name="burst-$(date +%s)"
  echo "Provisioning burst node: ${name} (${SERVER_TYPE} in ${LOCATION})"

  local cloud_init
  cloud_init=$(cat <<INIT
#!/bin/bash
curl -sfL https://get.k3s.io | K3S_URL=${K3S_URL} K3S_TOKEN=${K3S_TOKEN} sh -s - agent --node-label=${BURST_LABEL}
INIT
  )

  hcloud server create \
    --name "$name" \
    --type "$SERVER_TYPE" \
    --image "$IMAGE" \
    --location "$LOCATION" \
    --label "$BURST_LABEL" \
    --user-data "$cloud_init" \
    --ssh-key prometheus-deploy

  echo "Burst node ${name} provisioned. Will join k3s cluster automatically."
}

drain_burst_nodes() {
  echo "Draining burst nodes..."
  local nodes
  nodes=$(kubectl get nodes -l "$BURST_LABEL" -o name 2>/dev/null || echo "")
  for node in $nodes; do
    kubectl drain "$node" --ignore-daemonsets --delete-emptydir-data --force 2>/dev/null || true
    kubectl delete "$node" 2>/dev/null || true
  done
}

cleanup_burst_servers() {
  echo "Cleaning up Hetzner burst servers..."
  local servers
  servers=$(hcloud server list -l "$BURST_LABEL" -o noheader -o columns=name 2>/dev/null || echo "")
  for server in $servers; do
    echo "Deleting server: ${server}"
    hcloud server delete "$server"
  done
}

case "$ACTION" in
  check)
    depth=$(check_queue_depth)
    echo "Queue depth: ${depth} (threshold: ${QUEUE_THRESHOLD})"
    if [ "$depth" -gt "$QUEUE_THRESHOLD" ]; then
      echo "BURST NEEDED: Queue exceeds threshold"
      exit 1
    fi
    echo "Queue within limits"
    ;;
  provision)
    provision_burst_node
    ;;
  drain)
    drain_burst_nodes
    ;;
  cleanup)
    drain_burst_nodes
    cleanup_burst_servers
    ;;
  auto)
    depth=$(check_queue_depth)
    echo "Queue depth: ${depth}"
    if [ "$depth" -gt "$QUEUE_THRESHOLD" ]; then
      burst_count=$(hcloud server list -l "$BURST_LABEL" -o noheader | wc -l)
      if [ "$burst_count" -lt 3 ]; then
        echo "Provisioning burst node (current: ${burst_count})"
        provision_burst_node
      else
        echo "Max burst nodes reached (${burst_count})"
      fi
    elif [ "$depth" -eq 0 ]; then
      burst_count=$(hcloud server list -l "$BURST_LABEL" -o noheader | wc -l)
      if [ "$burst_count" -gt 0 ]; then
        echo "Queue empty, cleaning up ${burst_count} burst nodes"
        cleanup_burst_servers
      fi
    fi
    ;;
  *)
    echo "Usage: $0 [check|provision|drain|cleanup|auto]"
    exit 1
    ;;
esac
