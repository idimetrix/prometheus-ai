import { createLogger } from "@prometheus/logger";
import { NetworkAllowlist } from "./allowlist";

const logger = createLogger("sandbox-manager:network:egress-filter");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BlockedAttempt {
  destination: string;
  port: number;
  protocol: string;
  reason: string;
  sandboxId: string;
  source: string;
  timestamp: string;
}

export interface EgressFilterConfig {
  /** Per-sandbox custom allowlists (sandboxId -> additional domains) */
  customAllowlists?: Map<string, string[]>;
  /** Enable logging of blocked attempts (default: true) */
  enableLogging?: boolean;
  /** Maximum blocked attempt log entries per sandbox (default: 500) */
  maxLogEntries?: number;
}

// ─── Internal network ranges (RFC 1918 + loopback + link-local) ──────────────

interface CidrRange {
  mask: number;
  network: number;
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let result = 0;
  for (const part of parts) {
    const num = Number.parseInt(part, 10);
    if (Number.isNaN(num) || num < 0 || num > 255) {
      return null;
    }
    result = (result << 8) | num;
  }
  return result >>> 0;
}

function parseCidr(cidr: string): CidrRange | null {
  const [ip, bits] = cidr.split("/");
  if (!(ip && bits)) {
    return null;
  }
  const network = ipToNumber(ip);
  if (network === null) {
    return null;
  }
  const prefixLen = Number.parseInt(bits, 10);
  if (Number.isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) {
    return null;
  }
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return { network: (network & mask) >>> 0, mask };
}

function isIpInCidr(ip: string, range: CidrRange): boolean {
  const num = ipToNumber(ip);
  if (num === null) {
    return false;
  }
  return (num & range.mask) >>> 0 === range.network;
}

/** RFC 1918 private networks + loopback + link-local */
const BLOCKED_CIDR_STRINGS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "0.0.0.0/8",
];

const BLOCKED_CIDRS: CidrRange[] = BLOCKED_CIDR_STRINGS.map((c) =>
  parseCidr(c)
).filter((r): r is CidrRange => r !== null);

/** Blocked hostnames that resolve to internal networks */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "169.254.169.254",
]);

// ─── IP address pattern ──────────────────────────────────────────────────────

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpAddress(host: string): boolean {
  return IPV4_PATTERN.test(host);
}

// ─── Egress Filter ───────────────────────────────────────────────────────────

/**
 * Network egress filter for sandbox environments.
 *
 * Implements default-deny outbound policy with allowlisted exceptions.
 * Blocks all access to internal/private networks to prevent SSRF attacks.
 *
 * Default allowed destinations:
 * - npm registry (registry.npmjs.org)
 * - PyPI (pypi.org, files.pythonhosted.org)
 * - crates.io (crates.io, static.crates.io)
 * - GitHub (github.com, api.github.com)
 *
 * Always blocked:
 * - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918)
 * - 127.0.0.0/8 (loopback)
 * - 169.254.0.0/16 (link-local / cloud metadata)
 * - localhost and metadata endpoints
 */
export class EgressFilter {
  private readonly allowlist: NetworkAllowlist;
  private readonly sandboxAllowlists = new Map<string, NetworkAllowlist>();
  private readonly blockedAttempts = new Map<string, BlockedAttempt[]>();
  private readonly enableLogging: boolean;
  private readonly maxLogEntries: number;

  constructor(config?: EgressFilterConfig) {
    this.allowlist = new NetworkAllowlist();
    this.enableLogging = config?.enableLogging !== false;
    this.maxLogEntries = config?.maxLogEntries ?? 500;

    // Initialize per-sandbox custom allowlists
    if (config?.customAllowlists) {
      for (const [sandboxId, domains] of config.customAllowlists) {
        this.sandboxAllowlists.set(
          sandboxId,
          this.allowlist.createSandboxAllowlist(domains)
        );
      }
    }

    logger.info("Egress filter initialized with default-deny policy");
  }

  /**
   * Check if outbound traffic to a destination should be allowed.
   *
   * Returns { allowed: true } if the destination passes all checks,
   * or { allowed: false, reason } with a human-readable block reason.
   */
  check(
    sandboxId: string,
    destination: string,
    port: number,
    protocol = "tcp"
  ): { allowed: boolean; reason?: string } {
    const normalizedHost = destination.toLowerCase().trim();

    // Step 1: Always block internal/private network destinations
    const internalCheck = this.isInternalNetwork(normalizedHost);
    if (internalCheck.blocked) {
      const reason = `Blocked internal network access: ${internalCheck.reason}`;
      this.logBlocked(sandboxId, normalizedHost, port, protocol, reason);
      return { allowed: false, reason };
    }

    // Step 2: Check per-sandbox allowlist first, then global allowlist
    const sandboxList = this.sandboxAllowlists.get(sandboxId);
    if (sandboxList?.isAllowed(normalizedHost)) {
      return { allowed: true };
    }

    if (this.allowlist.isAllowed(normalizedHost)) {
      return { allowed: true };
    }

    // Step 3: Default deny
    const reason = `Domain ${normalizedHost}:${port} is not in the egress allowlist`;
    this.logBlocked(sandboxId, normalizedHost, port, protocol, reason);
    return { allowed: false, reason };
  }

  /**
   * Configure a per-sandbox allowlist with additional domains.
   */
  configureSandboxAllowlist(
    sandboxId: string,
    additionalDomains: string[]
  ): void {
    this.sandboxAllowlists.set(
      sandboxId,
      this.allowlist.createSandboxAllowlist(additionalDomains)
    );
    logger.info(
      { sandboxId, additionalDomains: additionalDomains.length },
      "Configured per-sandbox egress allowlist"
    );
  }

  /**
   * Remove per-sandbox allowlist (e.g., when sandbox is destroyed).
   */
  removeSandboxAllowlist(sandboxId: string): void {
    this.sandboxAllowlists.delete(sandboxId);
    this.blockedAttempts.delete(sandboxId);
  }

  /**
   * Get all blocked attempts for a sandbox.
   */
  getBlockedAttempts(sandboxId: string): BlockedAttempt[] {
    return this.blockedAttempts.get(sandboxId) ?? [];
  }

  /**
   * Get aggregate stats across all sandboxes.
   */
  getStats(): {
    activeSandboxes: number;
    totalBlocked: number;
    topBlockedDestinations: Array<{ count: number; destination: string }>;
  } {
    const destCounts = new Map<string, number>();
    let totalBlocked = 0;

    for (const [, attempts] of this.blockedAttempts) {
      totalBlocked += attempts.length;
      for (const attempt of attempts) {
        const count = destCounts.get(attempt.destination) ?? 0;
        destCounts.set(attempt.destination, count + 1);
      }
    }

    const topBlockedDestinations = Array.from(destCounts.entries())
      .map(([destination, count]) => ({ destination, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      activeSandboxes: this.sandboxAllowlists.size,
      totalBlocked,
      topBlockedDestinations,
    };
  }

  /**
   * Generate iptables rules for a sandbox container.
   * Includes both the base allowlist rules and internal network blocks.
   */
  generateIptablesRules(sandboxId?: string): string {
    const list = sandboxId
      ? (this.sandboxAllowlists.get(sandboxId) ?? this.allowlist)
      : this.allowlist;

    const baseRules = list.generateIptablesRules();

    // Add explicit blocks for internal networks before the domain allows
    const internalBlocks = [
      "",
      "# Block internal/private networks (SSRF prevention)",
      ...BLOCKED_CIDR_STRINGS.map(
        (cidr) => `iptables -I OUTPUT 1 -d ${cidr} -j DROP 2>/dev/null`
      ),
      "# Block cloud metadata endpoints",
      "iptables -I OUTPUT 1 -d 169.254.169.254 -j DROP 2>/dev/null",
    ];

    return `${baseRules}\n${internalBlocks.join("\n")}`;
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  private isInternalNetwork(host: string): {
    blocked: boolean;
    reason?: string;
  } {
    // Check blocked hostnames
    if (BLOCKED_HOSTNAMES.has(host)) {
      return { blocked: true, reason: `hostname '${host}' is blocked` };
    }

    // Check IP addresses against blocked CIDR ranges
    if (isIpAddress(host)) {
      for (let i = 0; i < BLOCKED_CIDRS.length; i++) {
        const range = BLOCKED_CIDRS[i] as CidrRange;
        if (isIpInCidr(host, range)) {
          return {
            blocked: true,
            reason: `IP ${host} is in blocked range ${BLOCKED_CIDR_STRINGS[i]}`,
          };
        }
      }
    }

    return { blocked: false };
  }

  private logBlocked(
    sandboxId: string,
    destination: string,
    port: number,
    protocol: string,
    reason: string
  ): void {
    const attempt: BlockedAttempt = {
      sandboxId,
      source: sandboxId,
      destination,
      port,
      protocol,
      reason,
      timestamp: new Date().toISOString(),
    };

    if (this.enableLogging) {
      logger.warn(
        {
          sandboxId,
          destination,
          port,
          protocol,
          reason,
        },
        "Egress traffic blocked"
      );
    }

    let attempts = this.blockedAttempts.get(sandboxId);
    if (!attempts) {
      attempts = [];
      this.blockedAttempts.set(sandboxId, attempts);
    }

    attempts.push(attempt);

    // Trim log to max entries
    if (attempts.length > this.maxLogEntries) {
      attempts.splice(0, attempts.length - this.maxLogEntries);
    }
  }
}
