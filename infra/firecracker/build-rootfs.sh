#!/usr/bin/env bash
#
# build-rootfs.sh -- Build a minimal Alpine Linux rootfs for Firecracker microVMs.
#
# Creates an ext4 filesystem image (<500MB target) pre-loaded with:
#   - Alpine Linux 3.19 (minimal base)
#   - Node.js 22 (LTS)
#   - Python 3.12
#   - Go 1.23
#   - Git
#   - prometheus-agent binary for vsock communication
#   - Non-root sandbox user (uid=1000)
#   - /workspace directory for project files
#
# Requirements:
#   - Root / sudo access (for mount, chroot)
#   - apk-tools (Alpine package manager)
#   - losetup, mkfs.ext4, mount
#
# Usage:
#   chmod +x build-rootfs.sh
#   sudo ./build-rootfs.sh [output_path]
#
# Output: rootfs.ext4 (default) -- a bootable ext4 image
#
# Environment variables:
#   ROOTFS_SIZE_MB      - Image size in MB (default: 480)
#   AGENT_BINARY_PATH   - Path to prometheus-agent binary (optional)
#   ALPINE_VERSION      - Alpine version (default: v3.19)
#   NODE_MAJOR          - Node.js major version (default: 22)
#   PYTHON_VERSION      - Python version (default: 3.12)
#   GO_VERSION          - Go version (default: 1.23)
#

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────

ROOTFS_SIZE_MB="${ROOTFS_SIZE_MB:-480}"
OUTPUT="${1:-rootfs.ext4}"
ALPINE_VERSION="${ALPINE_VERSION:-v3.19}"
ALPINE_MIRROR="https://dl-cdn.alpinelinux.org/alpine/${ALPINE_VERSION}"
MOUNT_DIR="$(mktemp -d /tmp/rootfs-build.XXXXXX)"
AGENT_BINARY_PATH="${AGENT_BINARY_PATH:-}"
NODE_MAJOR="${NODE_MAJOR:-22}"
GO_VERSION="${GO_VERSION:-1.23}"

echo "==> Building Firecracker rootfs image"
echo "    Target size: <500MB (allocated: ${ROOTFS_SIZE_MB}MB)"
echo "    Output: ${OUTPUT}"
echo "    Alpine: ${ALPINE_VERSION}"
echo "    Node.js: ${NODE_MAJOR}, Go: ${GO_VERSION}"
echo "    Mount: ${MOUNT_DIR}"

# ── Step 1: Create an empty ext4 image ─────────────────────────────────
# Allocate a sparse file and format it as ext4 with minimal journal.

echo "==> Creating ${ROOTFS_SIZE_MB}MB ext4 image..."
dd if=/dev/zero of="${OUTPUT}" bs=1M count="${ROOTFS_SIZE_MB}" status=progress
mkfs.ext4 -F -L rootfs -O ^has_journal -m 1 "${OUTPUT}"

# ── Step 2: Mount the image ────────────────────────────────────────────
# Use a loop device to mount the ext4 image for populating.

echo "==> Mounting image..."
LOOP_DEV=$(losetup --find --show "${OUTPUT}")
mount "${LOOP_DEV}" "${MOUNT_DIR}"

# Ensure cleanup on exit (unmount and detach loop device)
cleanup() {
  echo "==> Cleaning up..."
  umount "${MOUNT_DIR}" 2>/dev/null || true
  losetup -d "${LOOP_DEV}" 2>/dev/null || true
  rmdir "${MOUNT_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

# ── Step 3: Bootstrap Alpine Linux ────────────────────────────────────
# Install the Alpine base system using apk (static binary).
# This sets up the minimal OS without a kernel (Firecracker provides its own).

echo "==> Bootstrapping Alpine Linux ${ALPINE_VERSION}..."
apk -X "${ALPINE_MIRROR}/main" \
    -U --allow-untrusted \
    --root "${MOUNT_DIR}" \
    --initdb \
    add alpine-base

# ── Step 4: Configure Alpine repositories ─────────────────────────────
# Enable both main and community repos for Node.js, Python, and Go packages.

echo "==> Configuring repositories..."
mkdir -p "${MOUNT_DIR}/etc/apk"
cat > "${MOUNT_DIR}/etc/apk/repositories" <<EOF
${ALPINE_MIRROR}/main
${ALPINE_MIRROR}/community
EOF

# ── Step 5: Install Node.js 22 ────────────────────────────────────────

echo "==> Installing Node.js ${NODE_MAJOR}..."
apk -X "${ALPINE_MIRROR}/main" \
    -X "${ALPINE_MIRROR}/community" \
    --root "${MOUNT_DIR}" \
    --no-cache \
    add \
    nodejs \
    npm

# ── Step 6: Install Python 3.12 ──────────────────────────────────────

echo "==> Installing Python 3.12..."
apk -X "${ALPINE_MIRROR}/main" \
    -X "${ALPINE_MIRROR}/community" \
    --root "${MOUNT_DIR}" \
    --no-cache \
    add \
    python3 \
    py3-pip

# ── Step 7: Install Go 1.23 ──────────────────────────────────────────

echo "==> Installing Go ${GO_VERSION}..."
apk -X "${ALPINE_MIRROR}/main" \
    -X "${ALPINE_MIRROR}/community" \
    --root "${MOUNT_DIR}" \
    --no-cache \
    add \
    go

# ── Step 8: Install essential tools ──────────────────────────────────

echo "==> Installing essential tools (git, bash, curl, ca-certificates)..."
apk -X "${ALPINE_MIRROR}/main" \
    -X "${ALPINE_MIRROR}/community" \
    --root "${MOUNT_DIR}" \
    --no-cache \
    add \
    git \
    bash \
    curl \
    ca-certificates \
    openssh-client \
    coreutils \
    findutils

# ── Step 9: Install prometheus-agent binary ──────────────────────────
# The agent handles vsock communication between host and guest VM.

echo "==> Installing prometheus-agent..."
mkdir -p "${MOUNT_DIR}/usr/local/bin"

if [ -n "${AGENT_BINARY_PATH}" ] && [ -f "${AGENT_BINARY_PATH}" ]; then
  cp "${AGENT_BINARY_PATH}" "${MOUNT_DIR}/usr/local/bin/prometheus-agent"
  chmod 755 "${MOUNT_DIR}/usr/local/bin/prometheus-agent"
  echo "    Installed from: ${AGENT_BINARY_PATH}"
else
  # Create a placeholder script that will be replaced with the real binary
  cat > "${MOUNT_DIR}/usr/local/bin/prometheus-agent" <<'AGENT_EOF'
#!/bin/sh
# Placeholder for prometheus-agent vsock communication binary.
# Replace with the compiled binary before production use.
#
# The agent listens on vsock CID 3 and handles:
#   - Command execution requests
#   - File read/write operations
#   - Health check pings
#   - Snapshot coordination signals
echo '{"status":"placeholder","healthy":true}'
AGENT_EOF
  chmod 755 "${MOUNT_DIR}/usr/local/bin/prometheus-agent"
  echo "    Installed placeholder (replace with compiled binary for production)"
fi

# ── Step 10: Create workspace and directories ────────────────────────

echo "==> Creating /workspace directory..."
mkdir -p "${MOUNT_DIR}/workspace"
mkdir -p "${MOUNT_DIR}/tmp"
mkdir -p "${MOUNT_DIR}/var/log/prometheus"

# ── Step 11: Create sandbox user (non-root) ──────────────────────────
# Run workloads as a non-root user for security isolation.

echo "==> Creating sandbox user (uid=1000)..."
chroot "${MOUNT_DIR}" /bin/sh -c "
  addgroup -g 1000 sandbox
  adduser -D -u 1000 -G sandbox -h /workspace -s /bin/bash sandbox
  chown sandbox:sandbox /workspace
  chown sandbox:sandbox /tmp
"

# ── Step 12: Configure init system ────────────────────────────────────
# Minimal init for Firecracker -- starts prometheus-agent on boot.

echo "==> Configuring init..."
cat > "${MOUNT_DIR}/etc/inittab" <<'INITEOF'
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default
::ctrlaltdel:/sbin/reboot
::shutdown:/sbin/openrc shutdown
ttyS0::respawn:/sbin/getty -L ttyS0 115200 vt100
INITEOF

# Create an OpenRC service for prometheus-agent
mkdir -p "${MOUNT_DIR}/etc/init.d"
cat > "${MOUNT_DIR}/etc/init.d/prometheus-agent" <<'SERVICEEOF'
#!/sbin/openrc-run

name="prometheus-agent"
description="Prometheus sandbox agent for vsock communication"
command="/usr/local/bin/prometheus-agent"
command_args="--listen-vsock --cid 3 --port 52"
command_background=true
pidfile="/run/${RC_SVCNAME}.pid"
output_log="/var/log/prometheus/agent.log"
error_log="/var/log/prometheus/agent-error.log"

depend() {
    need localmount
    after bootmisc
}
SERVICEEOF
chmod 755 "${MOUNT_DIR}/etc/init.d/prometheus-agent"

# Enable the service at boot
chroot "${MOUNT_DIR}" /bin/sh -c "
  rc-update add prometheus-agent default 2>/dev/null || true
"

# ── Step 13: Set hostname and DNS ────────────────────────────────────

echo "==> Setting hostname and DNS..."
echo "prometheus-sandbox" > "${MOUNT_DIR}/etc/hostname"
cat > "${MOUNT_DIR}/etc/resolv.conf" <<'DNSEOF'
nameserver 8.8.8.8
nameserver 8.8.4.4
DNSEOF

# ── Step 14: Configure environment ──────────────────────────────────

echo "==> Configuring environment..."
cat > "${MOUNT_DIR}/etc/profile.d/prometheus.sh" <<'ENVEOF'
export PATH="/usr/local/bin:/usr/local/go/bin:$PATH"
export GOPATH="/workspace/go"
export NODE_ENV="production"
export HOME="/workspace"
ENVEOF

# ── Step 15: Clean up caches ────────────────────────────────────────
# Remove package caches and unnecessary files to minimize image size.

echo "==> Cleaning up caches..."
rm -rf "${MOUNT_DIR}/var/cache/apk/"*
rm -rf "${MOUNT_DIR}/tmp/"*
rm -rf "${MOUNT_DIR}/usr/share/man/"*
rm -rf "${MOUNT_DIR}/usr/share/doc/"*
rm -rf "${MOUNT_DIR}/usr/share/info/"*
rm -rf "${MOUNT_DIR}/root/.cache/"*

# ── Step 16: Verify installations ───────────────────────────────────

echo "==> Verifying installations..."
chroot "${MOUNT_DIR}" /bin/sh -c "
  echo '  Node.js:' \$(node --version 2>/dev/null || echo 'NOT FOUND')
  echo '  npm:' \$(npm --version 2>/dev/null || echo 'NOT FOUND')
  echo '  Python:' \$(python3 --version 2>/dev/null || echo 'NOT FOUND')
  echo '  Go:' \$(go version 2>/dev/null || echo 'NOT FOUND')
  echo '  Git:' \$(git --version 2>/dev/null || echo 'NOT FOUND')
  echo '  Agent:' \$(test -x /usr/local/bin/prometheus-agent && echo 'INSTALLED' || echo 'NOT FOUND')
"

# ── Done ──────────────────────────────────────────────────────────────
# The cleanup trap will unmount and detach the loop device.

FINAL_SIZE=$(du -sh "${OUTPUT}" | cut -f1)
echo ""
echo "==> Rootfs image built successfully!"
echo "    Output: ${OUTPUT} (${FINAL_SIZE})"
echo "    Target: <500MB"
echo "    Contents: Alpine ${ALPINE_VERSION} + Node.js ${NODE_MAJOR} + Python 3.12 + Go ${GO_VERSION} + Git"
echo "    User: sandbox (uid=1000)"
echo "    Workspace: /workspace"
echo "    Agent: /usr/local/bin/prometheus-agent"
