import { createLogger } from "@prometheus/logger";

const logger = createLogger("plugins:marketplace");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketplacePlugin {
  author: string;
  category: string;
  description: string;
  downloads: number;
  id: string;
  name: string;
  rating: number;
  tags: string[];
  verified: boolean;
  version: string;
}

interface InstalledPluginInfo {
  id: string;
  installedAt: string;
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Marketplace Client
// ---------------------------------------------------------------------------

/**
 * Client for the Prometheus plugin marketplace. Handles searching,
 * fetching details, installing, and managing local plugin installations.
 */
export class MarketplaceClient {
  readonly registryUrl: string;
  private readonly installed = new Map<string, InstalledPluginInfo>();

  constructor(registryUrl = "https://plugins.prometheus.dev/api") {
    this.registryUrl = registryUrl;
  }

  /**
   * Search for plugins by query string.
   */
  searchPlugins(query: string): MarketplacePlugin[] {
    logger.info(
      { query, registryUrl: this.registryUrl },
      "Searching marketplace"
    );

    // In production this would call the remote registry API.
    // For now, return from the built-in catalog filtered by query.
    const catalog = this.getBuiltinCatalog();
    const lowerQuery = query.toLowerCase();

    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        p.description.toLowerCase().includes(lowerQuery) ||
        p.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get detailed information about a specific plugin.
   */
  getPluginDetails(pluginId: string): MarketplacePlugin | null {
    const catalog = this.getBuiltinCatalog();
    return catalog.find((p) => p.id === pluginId) ?? null;
  }

  /**
   * Install a plugin by ID.
   */
  installPlugin(pluginId: string): InstalledPluginInfo {
    const details = this.getPluginDetails(pluginId);
    if (!details) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const info: InstalledPluginInfo = {
      id: details.id,
      name: details.name,
      version: details.version,
      installedAt: new Date().toISOString(),
    };

    this.installed.set(pluginId, info);
    logger.info({ pluginId, name: details.name }, "Plugin installed");

    return info;
  }

  /**
   * Uninstall a plugin by ID.
   */
  uninstallPlugin(pluginId: string): boolean {
    const removed = this.installed.delete(pluginId);
    if (removed) {
      logger.info({ pluginId }, "Plugin uninstalled");
    }
    return removed;
  }

  /**
   * Get all locally installed plugins.
   */
  getInstalledPlugins(): InstalledPluginInfo[] {
    return Array.from(this.installed.values());
  }

  /**
   * Check if a plugin is installed.
   */
  isInstalled(pluginId: string): boolean {
    return this.installed.has(pluginId);
  }

  private getBuiltinCatalog(): MarketplacePlugin[] {
    return [
      {
        id: "plugin-github",
        name: "GitHub",
        version: "2.1.0",
        description:
          "Full GitHub integration: repository management, pull request automation, issue triage, CI/CD workflow triggers",
        author: "Prometheus",
        category: "integration",
        tags: ["github", "git", "vcs", "ci-cd", "pull-requests"],
        downloads: 14_200,
        rating: 4.8,
        verified: true,
      },
      {
        id: "plugin-slack",
        name: "Slack",
        version: "1.5.0",
        description:
          "Slack integration: real-time notifications, task updates, team collaboration, slash commands",
        author: "Prometheus",
        category: "integration",
        tags: ["slack", "messaging", "notifications", "collaboration"],
        downloads: 11_500,
        rating: 4.6,
        verified: true,
      },
      {
        id: "plugin-jira",
        name: "Jira",
        version: "1.3.0",
        description:
          "Jira integration: bi-directional issue sync, sprint management, workflow automation",
        author: "Prometheus",
        category: "integration",
        tags: ["jira", "issues", "project-management", "agile"],
        downloads: 7800,
        rating: 4.4,
        verified: true,
      },
      {
        id: "plugin-linear",
        name: "Linear",
        version: "1.4.0",
        description:
          "Linear integration: issue synchronization, project tracking, cycle management",
        author: "Prometheus",
        category: "integration",
        tags: ["linear", "issues", "project-management", "cycles"],
        downloads: 9100,
        rating: 4.7,
        verified: true,
      },
      {
        id: "plugin-vercel",
        name: "Vercel",
        version: "1.2.0",
        description:
          "Vercel integration: preview deployments, production releases, environment management",
        author: "Prometheus",
        category: "integration",
        tags: ["vercel", "deployment", "preview", "hosting"],
        downloads: 10_300,
        rating: 4.9,
        verified: true,
      },
      {
        id: "plugin-sentry",
        name: "Sentry",
        version: "1.1.0",
        description:
          "Sentry integration: error tracking, performance monitoring, AI-powered error resolution",
        author: "Prometheus",
        category: "integration",
        tags: ["sentry", "errors", "monitoring", "performance"],
        downloads: 6400,
        rating: 4.5,
        verified: true,
      },
      {
        id: "plugin-datadog",
        name: "Datadog",
        version: "1.0.0",
        description:
          "Datadog integration: application monitoring, log aggregation, APM traces, infrastructure metrics",
        author: "Prometheus",
        category: "integration",
        tags: ["datadog", "monitoring", "apm", "logs", "metrics"],
        downloads: 4700,
        rating: 4.3,
        verified: true,
      },
    ];
  }
}

export type { InstalledPluginInfo, MarketplacePlugin };
