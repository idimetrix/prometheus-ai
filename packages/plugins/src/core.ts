import { createLogger } from "@prometheus/logger";
import { PluginLoader } from "./loader";
import { PluginSandbox } from "./sandbox";
import type {
  PluginEvent,
  PluginEventHandler,
  PluginInstance,
  PluginLifecycle,
  PluginManifest,
  PluginStatus,
  PluginTool,
} from "./types";

const logger = createLogger("plugins:manager");

// ---------------------------------------------------------------------------
// Plugin Manager
// ---------------------------------------------------------------------------

/**
 * Central plugin manager for the Prometheus platform. Orchestrates plugin
 * registration, lifecycle management, health monitoring, and event dispatch.
 *
 * Usage:
 * ```ts
 * const manager = new PluginManager();
 * manager.register(manifest, lifecycle);
 * await manager.activate("my-plugin", { apiKey: "..." });
 * ```
 */
export class PluginManager {
  private readonly loader = new PluginLoader();
  private readonly eventHandlers: PluginEventHandler[] = [];
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    logger.info("Plugin manager initialized");
  }

  // ---------------------------------------------------------------------------
  // Tool integration
  // ---------------------------------------------------------------------------

  /**
   * Connect the plugin system to the MCP gateway ToolRegistry.
   * This allows plugins to register and unregister MCP tools.
   */
  setToolCallbacks(
    register: (pluginId: string, tool: PluginTool) => void,
    unregister: (toolName: string) => void
  ): void {
    this.loader.setToolCallbacks(register, unregister);
  }

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Register a new plugin with its manifest and lifecycle hooks.
   */
  register(
    manifest: PluginManifest,
    lifecycle: PluginLifecycle
  ): PluginInstance {
    const instance = this.loader.register(manifest, lifecycle);
    this.emitEvent({
      type: "plugin:registered",
      pluginId: manifest.id,
      timestamp: new Date(),
      data: {
        name: manifest.name,
        version: manifest.version,
        category: manifest.category,
      },
    });
    return instance;
  }

  /**
   * Activate a registered plugin with optional configuration.
   */
  async activate(
    pluginId: string,
    config?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.loader.activate(pluginId, config);
      this.emitEvent({
        type: "plugin:activated",
        pluginId,
        timestamp: new Date(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.emitEvent({
        type: "plugin:error",
        pluginId,
        timestamp: new Date(),
        data: { error: msg, phase: "activation" },
      });
      throw error;
    }
  }

  /**
   * Deactivate an active plugin.
   */
  async deactivate(pluginId: string): Promise<void> {
    await this.loader.deactivate(pluginId);
    this.emitEvent({
      type: "plugin:deactivated",
      pluginId,
      timestamp: new Date(),
    });
  }

  /**
   * Uninstall a plugin completely.
   */
  async uninstall(pluginId: string): Promise<void> {
    await this.loader.uninstall(pluginId);
    this.emitEvent({
      type: "plugin:uninstalled",
      pluginId,
      timestamp: new Date(),
    });
  }

  /**
   * Update a plugin's configuration.
   */
  async updateConfig(
    pluginId: string,
    config: Record<string, unknown>
  ): Promise<void> {
    await this.loader.updateConfig(pluginId, config);
    this.emitEvent({
      type: "plugin:config-changed",
      pluginId,
      timestamp: new Date(),
      data: { configKeys: Object.keys(config) },
    });
  }

  // ---------------------------------------------------------------------------
  // Convenience: register and activate in one call
  // ---------------------------------------------------------------------------

  async registerAndActivate(
    manifest: PluginManifest,
    lifecycle: PluginLifecycle,
    config?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instance = this.register(manifest, lifecycle);
    await this.activate(manifest.id, config);
    return this.getPlugin(manifest.id) ?? instance;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.loader.getPlugin(pluginId);
  }

  getAllPlugins(): PluginInstance[] {
    return this.loader.getAllPlugins();
  }

  getPluginsByCategory(category: string): PluginInstance[] {
    return this.loader.getPluginsByCategory(category);
  }

  getPluginsByStatus(status: PluginStatus): PluginInstance[] {
    return this.loader.getPluginsByStatus(status);
  }

  /**
   * Get a summary of all plugins suitable for API responses.
   */
  getPluginSummaries(): Array<{
    id: string;
    name: string;
    description: string;
    version: string;
    category: string;
    status: PluginStatus;
    icon?: string;
    error: string | null;
    toolCount: number;
    activatedAt: string | null;
  }> {
    return this.getAllPlugins().map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      description: p.manifest.description,
      version: p.manifest.version,
      category: p.manifest.category,
      status: p.status,
      icon: p.manifest.icon,
      error: p.error,
      toolCount: p.registeredTools.length,
      activatedAt: p.activatedAt?.toISOString() ?? null,
    }));
  }

  // ---------------------------------------------------------------------------
  // Health monitoring
  // ---------------------------------------------------------------------------

  /**
   * Run health checks on all active plugins.
   */
  async runHealthChecks(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    const activePlugins = this.loader.getPluginsByStatus("active");

    for (const plugin of activePlugins) {
      const healthy = await this.loader.healthCheck(plugin.manifest.id);
      results[plugin.manifest.id] = healthy;

      this.emitEvent({
        type: "plugin:health-check",
        pluginId: plugin.manifest.id,
        timestamp: new Date(),
        data: { healthy },
      });
    }

    return results;
  }

  /**
   * Start periodic health checks for all active plugins.
   */
  startHealthChecks(intervalMs = 5 * 60 * 1000): void {
    this.stopHealthChecks();

    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks().catch((err) => {
        logger.error({ error: String(err) }, "Health check cycle failed");
      });
    }, intervalMs);

    logger.info({ intervalMs }, "Plugin health checks started");
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to plugin events.
   */
  onEvent(handler: PluginEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) {
        this.eventHandlers.splice(idx, 1);
      }
    };
  }

  private emitEvent(event: PluginEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error(
          { error: String(error), eventType: event.type },
          "Event handler error"
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Install & Validate (enhanced lifecycle)
  // ---------------------------------------------------------------------------

  /**
   * Install a plugin: validate manifest, register, and optionally activate.
   * Full lifecycle: install -> validate -> register -> activate.
   */
  async install(
    manifest: PluginManifest,
    lifecycle: PluginLifecycle,
    config?: Record<string, unknown>,
    autoActivate = true
  ): Promise<PluginInstance> {
    // Validate
    this.validateManifest(manifest);

    // Register
    const instance = this.register(manifest, lifecycle);

    this.emitEvent({
      type: "plugin:registered",
      pluginId: manifest.id,
      timestamp: new Date(),
      data: { phase: "installed" },
    });

    // Optionally activate
    if (autoActivate) {
      await this.activate(manifest.id, config);
    }

    return this.getPlugin(manifest.id) ?? instance;
  }

  /**
   * Validate a plugin manifest without registering it.
   */
  validateManifest(manifest: PluginManifest): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!manifest.id || typeof manifest.id !== "string") {
      errors.push("Plugin manifest must have a valid 'id' string");
    }
    if (!manifest.name || typeof manifest.name !== "string") {
      errors.push("Plugin manifest must have a valid 'name' string");
    }
    if (!manifest.version || typeof manifest.version !== "string") {
      errors.push("Plugin manifest must have a valid 'version' string");
    }
    if (!manifest.category) {
      errors.push("Plugin manifest must have a valid 'category'");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Create a sandbox for a plugin with its declared permissions.
   */
  createSandbox(pluginId: string): PluginSandbox {
    const instance = this.getPlugin(pluginId);
    const permissions = instance?.manifest.permissions ?? [];
    return new PluginSandbox(pluginId, {
      permissions: permissions.map((p) => ({
        scope: p,
        actions: ["*"],
      })),
    });
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Gracefully shut down the plugin manager. Deactivates all active plugins
   * and stops health checks.
   */
  async shutdown(): Promise<void> {
    this.stopHealthChecks();

    const activePlugins = this.loader.getPluginsByStatus("active");
    for (const plugin of activePlugins) {
      try {
        await this.loader.deactivate(plugin.manifest.id);
      } catch (error) {
        logger.error(
          { pluginId: plugin.manifest.id, error: String(error) },
          "Error deactivating plugin during shutdown"
        );
      }
    }

    logger.info("Plugin manager shut down");
  }
}
