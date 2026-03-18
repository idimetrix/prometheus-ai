import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("plugins:registry");

export interface RegistryPlugin {
  author: string;
  category: string;
  description: string;
  downloads: number;
  downloadUrl: string;
  id: string;
  manifestUrl: string;
  name: string;
  rating: number;
  tags: string[];
  verified: boolean;
  version: string;
}

export interface InstalledPlugin {
  config: Record<string, unknown>;
  enabled: boolean;
  id: string;
  installedAt: Date;
  name: string;
  orgId: string;
  pluginId: string;
  version: string;
}

/**
 * PluginRegistry manages remote plugin discovery and installation.
 */
export class PluginRegistry {
  private readonly installed = new Map<string, InstalledPlugin>();

  constructor(readonly _registryUrl = "https://plugins.prometheus.dev/api") {}

  /**
   * Search the plugin marketplace.
   */
  search(query: string, category?: string): Promise<RegistryPlugin[]> {
    logger.info({ query, category }, "Searching plugin registry");

    // In production, this would call the remote registry
    // For now, return built-in plugins
    return Promise.resolve(
      this.getBuiltinPlugins().filter((p) => {
        const matchesQuery =
          !query ||
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.description.toLowerCase().includes(query.toLowerCase()) ||
          p.tags.some((t) => t.includes(query.toLowerCase()));
        const matchesCategory = !category || p.category === category;
        return matchesQuery && matchesCategory;
      })
    );
  }

  /**
   * Install a plugin for an organization.
   */
  install(
    orgId: string,
    pluginId: string,
    config?: Record<string, unknown>
  ): Promise<InstalledPlugin> {
    const plugin = this.getBuiltinPlugins().find((p) => p.id === pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const installed: InstalledPlugin = {
      id: generateId("inst"),
      pluginId: plugin.id,
      orgId,
      name: plugin.name,
      version: plugin.version,
      enabled: true,
      config: config ?? {},
      installedAt: new Date(),
    };

    this.installed.set(`${orgId}:${pluginId}`, installed);
    logger.info({ orgId, pluginId, name: plugin.name }, "Plugin installed");

    return Promise.resolve(installed);
  }

  /**
   * Uninstall a plugin.
   */
  uninstall(orgId: string, pluginId: string): Promise<boolean> {
    const key = `${orgId}:${pluginId}`;
    const existed = this.installed.delete(key);
    if (existed) {
      logger.info({ orgId, pluginId }, "Plugin uninstalled");
    }
    return Promise.resolve(existed);
  }

  /**
   * Get installed plugins for an org.
   */
  getInstalled(orgId: string): InstalledPlugin[] {
    return Array.from(this.installed.values()).filter((p) => p.orgId === orgId);
  }

  /**
   * Enable/disable a plugin.
   */
  setEnabled(orgId: string, pluginId: string, enabled: boolean): boolean {
    const key = `${orgId}:${pluginId}`;
    const plugin = this.installed.get(key);
    if (plugin) {
      plugin.enabled = enabled;
      return true;
    }
    return false;
  }

  private getBuiltinPlugins(): RegistryPlugin[] {
    return [
      {
        id: "plugin_github",
        name: "GitHub",
        version: "1.0.0",
        description: "GitHub integration: repos, PRs, issues, workflows",
        author: "Prometheus",
        category: "vcs",
        downloadUrl: "",
        manifestUrl: "",
        tags: ["github", "git", "vcs", "ci-cd"],
        downloads: 10_000,
        rating: 4.8,
        verified: true,
      },
      {
        id: "plugin_linear",
        name: "Linear",
        version: "1.0.0",
        description: "Linear integration: issues, projects, cycles",
        author: "Prometheus",
        category: "project-management",
        downloadUrl: "",
        manifestUrl: "",
        tags: ["linear", "issues", "project-management"],
        downloads: 5000,
        rating: 4.7,
        verified: true,
      },
      {
        id: "plugin_slack",
        name: "Slack",
        version: "1.0.0",
        description: "Slack integration: messages, channels, notifications",
        author: "Prometheus",
        category: "communication",
        downloadUrl: "",
        manifestUrl: "",
        tags: ["slack", "messaging", "notifications"],
        downloads: 8000,
        rating: 4.6,
        verified: true,
      },
      {
        id: "plugin_sentry",
        name: "Sentry",
        version: "1.0.0",
        description: "Sentry error tracking integration",
        author: "Prometheus",
        category: "monitoring",
        downloadUrl: "",
        manifestUrl: "",
        tags: ["sentry", "errors", "monitoring"],
        downloads: 3000,
        rating: 4.5,
        verified: true,
      },
      {
        id: "plugin_notion",
        name: "Notion",
        version: "1.0.0",
        description: "Notion integration: pages, databases, docs",
        author: "Prometheus",
        category: "documentation",
        downloadUrl: "",
        manifestUrl: "",
        tags: ["notion", "docs", "wiki"],
        downloads: 4000,
        rating: 4.4,
        verified: true,
      },
      {
        id: "plugin_datadog",
        name: "Datadog",
        version: "1.0.0",
        description: "Datadog monitoring and observability",
        author: "Prometheus",
        category: "monitoring",
        downloadUrl: "",
        manifestUrl: "",
        tags: ["datadog", "monitoring", "apm"],
        downloads: 2000,
        rating: 4.3,
        verified: true,
      },
    ];
  }
}
