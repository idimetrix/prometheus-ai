import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:network:allowlist");

/** Default allowed domains for package registries and common dev services */
const DEFAULT_ALLOWED_DOMAINS = [
  // npm registry
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  // PyPI
  "pypi.org",
  "files.pythonhosted.org",
  // Crates.io (Rust)
  "crates.io",
  "static.crates.io",
  "index.crates.io",
  // Go modules
  "proxy.golang.org",
  "sum.golang.org",
  // GitHub (for git clone, releases)
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  // GitLab
  "gitlab.com",
  // DNS (always needed)
  "dns.google",
];

/** Iptables rule template for Docker containers */
const IPTABLES_ALLOW_TEMPLATE = (domain: string, port: number) =>
  `iptables -A OUTPUT -p tcp -d "${domain}" --dport ${port} -j ACCEPT 2>/dev/null`;

/** Firecracker VM network filter config format */
interface FirecrackerNetworkFilter {
  allowed_hosts: string[];
  default_policy: "deny";
  rules: Array<{
    host: string;
    ports: number[];
    protocol: "tcp";
  }>;
}

interface AllowlistConfig {
  /** Additional domains to allow beyond defaults */
  additionalDomains?: string[];
  /** Override defaults entirely (use only these domains) */
  customDomains?: string[];
  /** Whether to include default domains (true by default) */
  includeDefaults?: boolean;
}

/**
 * Network allowlist for sandbox egress filtering.
 *
 * Controls which external domains sandboxes can reach.
 * By default, allows package registries (npm, PyPI, crates.io) and GitHub.
 *
 * Generates appropriate rules for each sandbox backend:
 * - Docker: iptables OUTPUT chain rules
 * - Firecracker: VM network interface filter config
 * - Per-sandbox customization supported
 */
export class NetworkAllowlist {
  private readonly allowedDomains: Set<string>;

  constructor(config?: AllowlistConfig) {
    this.allowedDomains = new Set<string>();

    const includeDefaults = config?.includeDefaults !== false;

    if (config?.customDomains) {
      // Custom domains override everything
      for (const domain of config.customDomains) {
        this.allowedDomains.add(domain.toLowerCase());
      }
    } else {
      // Start with defaults if enabled
      if (includeDefaults) {
        for (const domain of DEFAULT_ALLOWED_DOMAINS) {
          this.allowedDomains.add(domain);
        }
      }

      // Add any additional domains
      if (config?.additionalDomains) {
        for (const domain of config.additionalDomains) {
          this.allowedDomains.add(domain.toLowerCase());
        }
      }
    }

    logger.info(
      { domainCount: this.allowedDomains.size },
      "Network allowlist initialized"
    );
  }

  /**
   * Check if a hostname is allowed by the allowlist.
   */
  isAllowed(hostname: string): boolean {
    const normalized = hostname.toLowerCase().trim();

    // Direct match
    if (this.allowedDomains.has(normalized)) {
      return true;
    }

    // Check if it's a subdomain of an allowed domain
    for (const allowed of this.allowedDomains) {
      if (normalized.endsWith(`.${allowed}`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Add a domain to the allowlist.
   */
  addDomain(domain: string): void {
    const normalized = domain.toLowerCase().trim();
    this.allowedDomains.add(normalized);
    logger.debug({ domain: normalized }, "Domain added to allowlist");
  }

  /**
   * Remove a domain from the allowlist.
   */
  removeDomain(domain: string): void {
    const normalized = domain.toLowerCase().trim();
    this.allowedDomains.delete(normalized);
    logger.debug({ domain: normalized }, "Domain removed from allowlist");
  }

  /**
   * Get all allowed domains.
   */
  getDomains(): string[] {
    return Array.from(this.allowedDomains).sort();
  }

  /**
   * Generate iptables rules for Docker container network filtering.
   * Returns a shell script string that can be executed inside the container.
   */
  generateIptablesRules(): string {
    const rules: string[] = [
      "# Prometheus sandbox network allowlist (iptables)",
      "# Set default DROP policy for outbound traffic",
      "iptables -P OUTPUT DROP 2>/dev/null",
      "",
      "# Allow loopback",
      "iptables -A OUTPUT -o lo -j ACCEPT 2>/dev/null",
      "",
      "# Allow established/related connections",
      "iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null",
      "",
      "# Allow DNS (required to resolve allowed domains)",
      "iptables -A OUTPUT -p udp --dport 53 -j ACCEPT 2>/dev/null",
      "iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT 2>/dev/null",
      "",
      "# Allowed domains:",
    ];

    for (const domain of this.allowedDomains) {
      rules.push(`# ${domain}`);
      rules.push(IPTABLES_ALLOW_TEMPLATE(domain, 443));
      rules.push(IPTABLES_ALLOW_TEMPLATE(domain, 80));
    }

    return rules.join("\n");
  }

  /**
   * Generate Firecracker VM network interface filtering configuration.
   * Returns a config object for the Firecracker network filter.
   */
  generateFirecrackerConfig(): FirecrackerNetworkFilter {
    const rules: FirecrackerNetworkFilter["rules"] = [];

    for (const domain of this.allowedDomains) {
      rules.push({
        host: domain,
        ports: [80, 443],
        protocol: "tcp",
      });
    }

    // Always allow DNS
    rules.push({
      host: "8.8.8.8",
      ports: [53],
      protocol: "tcp",
    });
    rules.push({
      host: "8.8.4.4",
      ports: [53],
      protocol: "tcp",
    });

    return {
      default_policy: "deny",
      allowed_hosts: Array.from(this.allowedDomains),
      rules,
    };
  }

  /**
   * Create a per-sandbox customized allowlist.
   * Starts with the base allowlist and adds sandbox-specific domains.
   */
  createSandboxAllowlist(additionalDomains: string[]): NetworkAllowlist {
    const sandboxList = new NetworkAllowlist({
      customDomains: [...this.getDomains(), ...additionalDomains],
    });

    logger.debug(
      {
        baseDomains: this.allowedDomains.size,
        additionalDomains: additionalDomains.length,
        totalDomains: sandboxList.getDomains().length,
      },
      "Created per-sandbox allowlist"
    );

    return sandboxList;
  }
}
