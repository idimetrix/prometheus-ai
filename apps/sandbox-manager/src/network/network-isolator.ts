/**
 * Network Isolator for sandbox environments.
 *
 * Manages network namespaces, egress rules, metadata endpoint blocking,
 * and bandwidth rate limiting for isolated sandbox containers/VMs.
 *
 * In production, this calls the management API to configure Linux network
 * namespaces. In development mode it tracks rules in-memory only.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:network-isolator");

const DEFAULT_API_BASE = "http://localhost:8080";

/** An egress rule allowing outbound traffic to a specific CIDR/port */
export interface EgressRule {
  cidr: string;
  createdAt: Date;
  port: number;
  protocol: "tcp" | "udp";
  sandboxId: string;
}

/** Rate limit configuration for a sandbox */
interface RateLimitConfig {
  appliedAt: Date;
  bytesPerSecond: number;
  sandboxId: string;
}

/** Full network state for a sandbox */
interface SandboxNetworkState {
  createdAt: Date;
  egressRules: EgressRule[];
  metadataBlocked: boolean;
  namespaceCreated: boolean;
  rateLimit: RateLimitConfig | null;
  sandboxId: string;
}

/** Cloud provider metadata endpoint CIDRs to block */
const METADATA_CIDRS = [
  "169.254.169.254/32", // AWS, GCP, Azure IMDS
  "169.254.170.2/32", // AWS ECS task metadata
  "fd00:ec2::254/128", // AWS IPv6 IMDS
];

export class NetworkIsolator {
  private readonly sandboxes = new Map<string, SandboxNetworkState>();
  private readonly isDev: boolean;
  private readonly apiBase: string;

  constructor(options?: { devMode?: boolean; apiBase?: string }) {
    this.isDev = options?.devMode ?? process.env.NODE_ENV !== "production";
    this.apiBase =
      options?.apiBase ?? process.env.FIRECRACKER_API_BASE ?? DEFAULT_API_BASE;
  }

  /**
   * Create an isolated network namespace for a sandbox.
   * Sets up a veth pair and configures basic connectivity.
   */
  async createIsolatedNetwork(sandboxId: string): Promise<void> {
    if (this.sandboxes.has(sandboxId)) {
      logger.warn({ sandboxId }, "Network namespace already exists");
      return;
    }

    logger.info({ sandboxId }, "Creating isolated network namespace");

    const state: SandboxNetworkState = {
      sandboxId,
      namespaceCreated: true,
      metadataBlocked: false,
      egressRules: [],
      rateLimit: null,
      createdAt: new Date(),
    };

    this.sandboxes.set(sandboxId, state);

    if (!this.isDev) {
      await this.execNetworkCommand(["ip", "netns", "add", `sbx-${sandboxId}`]);
      await this.execNetworkCommand([
        "ip",
        "link",
        "add",
        `veth-${sandboxId}`,
        "type",
        "veth",
        "peer",
        "name",
        `vpeer-${sandboxId}`,
      ]);
      await this.execNetworkCommand([
        "ip",
        "link",
        "set",
        `vpeer-${sandboxId}`,
        "netns",
        `sbx-${sandboxId}`,
      ]);
    }

    // Block metadata endpoints by default
    await this.blockMetadataEndpoints(sandboxId);

    logger.info({ sandboxId }, "Isolated network created");
  }

  /**
   * Add an egress rule allowing outbound traffic to a specific CIDR and port.
   */
  async addEgressRule(
    sandboxId: string,
    cidr: string,
    port: number,
    protocol: "tcp" | "udp" = "tcp"
  ): Promise<void> {
    const state = this.requireState(sandboxId);

    const rule: EgressRule = {
      sandboxId,
      cidr,
      port,
      protocol,
      createdAt: new Date(),
    };

    state.egressRules.push(rule);

    if (!this.isDev) {
      await this.execNetworkCommand([
        "ip",
        "netns",
        "exec",
        `sbx-${sandboxId}`,
        "iptables",
        "-A",
        "OUTPUT",
        "-d",
        cidr,
        "-p",
        protocol,
        "--dport",
        String(port),
        "-j",
        "ACCEPT",
      ]);
    }

    logger.info({ sandboxId, cidr, port, protocol }, "Egress rule added");
  }

  /**
   * Block cloud metadata endpoints (169.254.x.x) to prevent SSRF and
   * credential theft from within sandboxes.
   */
  async blockMetadataEndpoints(sandboxId: string): Promise<void> {
    const state = this.requireState(sandboxId);

    if (state.metadataBlocked) {
      return;
    }

    for (const cidr of METADATA_CIDRS) {
      if (!this.isDev) {
        await this.execNetworkCommand([
          "ip",
          "netns",
          "exec",
          `sbx-${sandboxId}`,
          "iptables",
          "-A",
          "OUTPUT",
          "-d",
          cidr,
          "-j",
          "DROP",
        ]);
      }
    }

    state.metadataBlocked = true;

    logger.info(
      { sandboxId, blockedCidrs: METADATA_CIDRS.length },
      "Metadata endpoints blocked"
    );
  }

  /**
   * Set a bandwidth rate limit for a sandbox using Linux tc (traffic control).
   */
  async setRateLimit(sandboxId: string, bytesPerSecond: number): Promise<void> {
    const state = this.requireState(sandboxId);

    state.rateLimit = {
      sandboxId,
      bytesPerSecond,
      appliedAt: new Date(),
    };

    if (!this.isDev) {
      const kbitPerSecond = Math.max(
        1,
        Math.floor((bytesPerSecond * 8) / 1000)
      );
      await this.execNetworkCommand([
        "ip",
        "netns",
        "exec",
        `sbx-${sandboxId}`,
        "tc",
        "qdisc",
        "replace",
        "dev",
        `vpeer-${sandboxId}`,
        "root",
        "tbf",
        "rate",
        `${kbitPerSecond}kbit`,
        "burst",
        "32kbit",
        "latency",
        "400ms",
      ]);
    }

    logger.info({ sandboxId, bytesPerSecond }, "Rate limit applied");
  }

  /**
   * Tear down all network configuration for a sandbox.
   * Removes the namespace, veth pair, and all rules.
   */
  async teardown(sandboxId: string): Promise<void> {
    const state = this.sandboxes.get(sandboxId);
    if (!state) {
      logger.debug({ sandboxId }, "No network state to tear down");
      return;
    }

    logger.info({ sandboxId }, "Tearing down sandbox network");

    if (!this.isDev) {
      await this.execNetworkCommand([
        "ip",
        "netns",
        "delete",
        `sbx-${sandboxId}`,
      ]).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { sandboxId, error: msg },
          "Failed to delete network namespace"
        );
      });
    }

    this.sandboxes.delete(sandboxId);
    logger.info({ sandboxId }, "Sandbox network torn down");
  }

  /**
   * Get the current network state for a sandbox.
   */
  getState(sandboxId: string): SandboxNetworkState | undefined {
    return this.sandboxes.get(sandboxId);
  }

  /**
   * Get a summary of all managed sandbox networks.
   */
  getSummary(): {
    totalSandboxes: number;
    totalEgressRules: number;
    rateLimitedCount: number;
  } {
    let totalEgressRules = 0;
    let rateLimitedCount = 0;

    for (const state of this.sandboxes.values()) {
      totalEgressRules += state.egressRules.length;
      if (state.rateLimit) {
        rateLimitedCount++;
      }
    }

    return {
      totalSandboxes: this.sandboxes.size,
      totalEgressRules,
      rateLimitedCount,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private requireState(sandboxId: string): SandboxNetworkState {
    const state = this.sandboxes.get(sandboxId);
    if (!state) {
      throw new Error(
        `No network namespace for sandbox ${sandboxId}. Call createIsolatedNetwork first.`
      );
    }
    return state;
  }

  private async execNetworkCommand(args: string[]): Promise<void> {
    logger.debug({ command: args.join(" ") }, "Executing network command");

    try {
      const response = await fetch(`${this.apiBase}/network/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Network command failed (${response.status}): ${body}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(`Network command timed out: ${args.join(" ")}`);
      }
      throw error;
    }
  }
}
