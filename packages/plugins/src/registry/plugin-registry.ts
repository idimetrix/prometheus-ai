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
  readonly _registryUrl: string;

  constructor(_registryUrl = "https://plugins.prometheus.dev/api") {
    this._registryUrl = _registryUrl;
  }

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
        id: "plugin-github",
        name: "GitHub",
        version: "2.1.0",
        description:
          "Full GitHub integration: repository management, pull request automation, issue triage, CI/CD workflow triggers",
        author: "Prometheus",
        category: "integration",
        downloadUrl: "",
        manifestUrl: "",
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
        downloadUrl: "",
        manifestUrl: "",
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
        downloadUrl: "",
        manifestUrl: "",
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
        downloadUrl: "",
        manifestUrl: "",
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
        downloadUrl: "",
        manifestUrl: "",
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
        downloadUrl: "",
        manifestUrl: "",
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
        downloadUrl: "",
        manifestUrl: "",
        tags: ["datadog", "monitoring", "apm", "logs", "metrics"],
        downloads: 4700,
        rating: 4.3,
        verified: true,
      },
    ];
  }
}
