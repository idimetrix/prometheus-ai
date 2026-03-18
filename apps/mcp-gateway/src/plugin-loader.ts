import { createLogger } from "@prometheus/logger";
import type {
  PluginContext,
  PluginLifecycle,
  PluginManifest,
  PluginTool,
} from "@prometheus/plugins";
import { PluginManager } from "@prometheus/plugins";
import type { ToolRegistry } from "./registry";

const logger = createLogger("mcp-gateway:plugin-loader");

// ---------------------------------------------------------------------------
// MCP Plugin Loader
// ---------------------------------------------------------------------------

/**
 * Extends the MCP gateway to load adapters as plugins. Each adapter plugin
 * registers its tools through the PluginManager, which delegates to the
 * gateway's ToolRegistry.
 *
 * This bridges the plugin system with the existing adapter/registry pattern,
 * allowing new MCP adapters to be loaded dynamically at runtime.
 */
export class MCPPluginLoader {
  private readonly pluginManager: PluginManager;
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
    this.pluginManager = new PluginManager();

    // Wire plugin tool registration to the MCP ToolRegistry
    this.pluginManager.setToolCallbacks(
      (pluginId: string, tool: PluginTool) => {
        this.registry.register(
          {
            name: tool.name,
            adapter: pluginId,
            description: tool.description,
            inputSchema: tool.inputSchema,
            requiresAuth: tool.requiresAuth,
            category: pluginId,
          },
          tool.handler
        );
        logger.info(
          { pluginId, tool: tool.name },
          "Plugin tool registered with MCP gateway"
        );
      },
      (toolName: string) => {
        this.registry.unregister(toolName);
        logger.info(
          { tool: toolName },
          "Plugin tool unregistered from MCP gateway"
        );
      }
    );
  }

  /**
   * Get the underlying plugin manager for event subscriptions and queries.
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  /**
   * Load an adapter as a plugin. The adapter provides a manifest and lifecycle
   * hooks. On activation, the adapter's tools are registered with the gateway.
   */
  async loadAdapterPlugin(
    manifest: PluginManifest,
    lifecycle: PluginLifecycle,
    config?: Record<string, unknown>
  ): Promise<void> {
    await this.pluginManager.registerAndActivate(manifest, lifecycle, config);
    logger.info(
      { pluginId: manifest.id, toolCount: this.registry.getToolCount() },
      "Adapter plugin loaded"
    );
  }

  /**
   * Unload an adapter plugin. Deactivates it and removes all its tools.
   */
  async unloadAdapterPlugin(pluginId: string): Promise<void> {
    await this.pluginManager.deactivate(pluginId);
    logger.info({ pluginId }, "Adapter plugin unloaded");
  }

  /**
   * Create a standard adapter plugin from a registration function.
   * This wraps the existing registerXxxAdapter() pattern into the plugin system.
   *
   * Example:
   * ```ts
   * pluginLoader.wrapExistingAdapter(
   *   { id: "github", name: "GitHub", ... },
   *   (registry) => registerGitHubAdapter(registry),
   * );
   * ```
   */
  async wrapExistingAdapter(
    manifest: PluginManifest,
    registerFn: (registry: ToolRegistry) => void
  ): Promise<void> {
    const registry = this.registry;
    const lifecycle: PluginLifecycle = {
      async activate(_context: PluginContext): Promise<void> {
        registerFn(registry);
      },
      async deactivate(_context: PluginContext): Promise<void> {
        registry.unregisterAdapter(manifest.id);
      },
      async healthCheck(_context: PluginContext): Promise<boolean> {
        const health = registry.getAdapterHealth(manifest.id);
        return health?.healthy ?? true;
      },
    };

    this.pluginManager.register(manifest, lifecycle);
    await this.pluginManager.activate(manifest.id);
  }

  /**
   * Get status of all loaded adapter plugins.
   */
  getLoadedPlugins() {
    return this.pluginManager.getPluginSummaries();
  }

  /**
   * Run health checks on all loaded adapter plugins.
   */
  async runHealthChecks() {
    return this.pluginManager.runHealthChecks();
  }

  /**
   * Start periodic health monitoring.
   */
  startHealthChecks(intervalMs = 5 * 60 * 1000): void {
    this.pluginManager.startHealthChecks(intervalMs);
  }

  /**
   * Shut down the plugin loader and all loaded plugins.
   */
  async shutdown(): Promise<void> {
    await this.pluginManager.shutdown();
  }
}
