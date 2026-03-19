#!/usr/bin/env bash
#
# build-rootfs.sh — Build a minimal Alpine Linux rootfs for Firecracker microVMs.
#
# This creates an ext4 filesystem image pre-loaded with:
#   - Alpine Linux 3.19 (minimal base)
#   - Node.js 22 (LTS)
#   - Python 3.12
#   - Git
#   - /workspace directory for project files
#
# Requirements:
#   - Root / sudo access (for mount, chroot)
#   - apk-tools (Alpine package manager) or debootstrap alternative
#   - losetup, mkfs.ext4, mount
#
# Usage:
#   chmod +x build-rootfs.sh
#   sudo ./build-rootfs.sh [output_path]
#
# Output: rootfs.ext4 (default) — a bootable ext4 image
#

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────

ROOTFS_SIZE_MB="${ROOTFS_SIZE_MB:-1024}"
OUTPUT="${1:-rootfs.ext4}"
ALPINE_MIRROR="https://dl-cdn.alpinelinux.org/alpine/v3.19"
MOUNT_DIR="$(mktemp -d /tmp/rootfs-build.XXXXXX)"

echo "==> Building Firecracker rootfs image"
echo "    Size: ${ROOTFS_SIZE_MB}MB"
echo "    Output: ${OUTPUT}"
echo "    Mount: ${MOUNT_DIR}"

# ── Step 1: Create an empty ext4 image ─────────────────────────────────
# Allocate a sparse file and format it as ext4.

echo "==> Creating ${ROOTFS_SIZE_MB}MB ext4 image..."
dd if=/dev/zero of="${OUTPUT}" bs=1M count="${ROOTFS_SIZE_MB}" status=progress
mkfs.ext4 -F -L rootfs "${OUTPUT}"

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

echo "==> Bootstrapping Alpine Linux..."
apk -X "${ALPINE_MIRROR}/main" \
    -U --allow-untrusted \
    --root "${MOUNT_DIR}" \
    --initdb \
    add alpine-base

# ── Step 4: Configure Alpine repositories ─────────────────────────────
# Enable both main and community repos for Node.js and Python packages.

echo "==> Configuring repositories..."
mkdir -p "${MOUNT_DIR}/etc/apk"
cat > "${MOUNT_DIR}/etc/apk/repositories" <<EOF
${ALPINE_MIRROR}/main
${ALPINE_MIRROR}/community
EOF

# ── Step 5: Install required packages ─────────────────────────────────
# Node.js 22, Python 3.12, Git, and essential build tools.

echo "==> Installing Node.js 22, Python 3.12, Git..."
apk -X "${ALPINE_MIRROR}/main" \
    -X "${ALPINE_MIRROR}/community" \
    --root "${MOUNT_DIR}" \
    --no-cache \
    add \
    nodejs \
    npm \
    python3 \
    py3-pip \
    git \
    bash \
    curl \
    ca-certificates \
    openssh-client

# ── Step 6: Create workspace directory ─────────────────────────────────
# This is where project files will be mounted/copied at runtime.

echo "==> Creating /workspace directory..."
mkdir -p "${MOUNT_DIR}/workspace"

# ── Step 7: Create sandbox user ────────────────────────────────────────
# Run workloads as a non-root user for security isolation.

echo "==> Creating sandbox user..."
chroot "${MOUNT_DIR}" /bin/sh -c "
  addgroup -g 1000 sandbox
  adduser -D -u 1000 -G sandbox -h /workspace -s /bin/bash sandbox
  chown sandbox:sandbox /workspace
"

# ── Step 8: Configure init system ──────────────────────────────────────
# Set up a minimal init for Firecracker (OpenRC or simple init script).

echo "==> Configuring init..."
cat > "${MOUNT_DIR}/etc/inittab" <<'INITEOF'
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default
::ctrlaltdel:/sbin/reboot
::shutdown:/sbin/openrc shutdown
ttyS0::respawn:/sbin/getty -L ttyS0 115200 vt100
INITEOF

# ── Step 9: Set hostname and DNS ──────────────────────────────────────

echo "==> Setting hostname and DNS..."
echo "prometheus-sandbox" > "${MOUNT_DIR}/etc/hostname"
cat > "${MOUNT_DIR}/etc/resolv.conf" <<'DNSEOF'
nameserver 8.8.8.8
nameserver 8.8.4.4
DNSEOF

# ── Step 10: Clean up caches ──────────────────────────────────────────
# Remove package caches to minimize image size.

echo "==> Cleaning up caches..."
rm -rf "${MOUNT_DIR}/var/cache/apk/"*
rm -rf "${MOUNT_DIR}/tmp/"*

# ── Done ───────────────────────────────────────────────────────────────
# The cleanup trap will unmount and detach the loop device.

FINAL_SIZE=$(du -sh "${OUTPUT}" | cut -f1)
echo "==> Rootfs image built successfully: ${OUTPUT} (${FINAL_SIZE})"
echo "    Contents: Alpine 3.19 + Node.js 22 + Python 3.12 + Git"
echo "    User: sandbox (uid=1000)"
echo "    Workspace: /workspace"
