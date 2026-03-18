import { createLogger } from "@prometheus/logger";
import type {
  PluginContext,
  PluginInstance,
  PluginLifecycle,
  PluginManifest,
  PluginStatus,
  PluginTool,
} from "./types";

const logger = createLogger("plugins:loader");

// ---------------------------------------------------------------------------
// In-memory plugin storage
// ---------------------------------------------------------------------------

const pluginStorage = new Map<string, Map<string, string>>();

function getPluginStorage(pluginId: string) {
  return {
    async get(key: string): Promise<string | null> {
      return pluginStorage.get(pluginId)?.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      let store = pluginStorage.get(pluginId);
      if (!store) {
        store = new Map();
        pluginStorage.set(pluginId, store);
      }
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      pluginStorage.get(pluginId)?.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin Loader
// ---------------------------------------------------------------------------

/**
 * Handles registration, activation, deactivation, and uninstallation of plugins.
 * The loader manages plugin instances and their lifecycle transitions.
 */
export class PluginLoader {
  private readonly plugins = new Map<string, PluginInstance>();

  /** Callback to register a tool with the MCP gateway */
  private toolRegistrar: ((pluginId: string, tool: PluginTool) => void) | null =
    null;
  /** Callback to unregister a tool from the MCP gateway */
  private toolUnregistrar: ((toolName: string) => void) | null = null;

  /**
   * Set the external tool registration callbacks. These connect the plugin
   * system to the MCP gateway's ToolRegistry.
   */
  setToolCallbacks(
    register: (pluginId: string, tool: PluginTool) => void,
    unregister: (toolName: string) => void
  ): void {
    this.toolRegistrar = register;
    this.toolUnregistrar = unregister;
  }

  /**
   * Register a plugin. This validates the manifest and stores the plugin
   * in a "registered" state without activating it.
   */
  register(
    manifest: PluginManifest,
    lifecycle: PluginLifecycle
  ): PluginInstance {
    if (this.plugins.has(manifest.id)) {
      logger.warn(
        { pluginId: manifest.id },
        "Plugin already registered, replacing"
      );
    }

    // Validate manifest
    this.validateManifest(manifest);

    const instance: PluginInstance = {
      manifest,
      lifecycle,
      status: "registered",
      config: {},
      activatedAt: null,
      error: null,
      registeredTools: [],
    };

    this.plugins.set(manifest.id, instance);
    logger.info(
      { pluginId: manifest.id, name: manifest.name, version: manifest.version },
      "Plugin registered"
    );

    return instance;
  }

  /**
   * Activate a registered plugin. Calls the plugin's activate() lifecycle
   * hook and transitions it to "active" status.
   */
  async activate(
    pluginId: string,
    config?: Record<string, unknown>
  ): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (instance.status === "active") {
      logger.info({ pluginId }, "Plugin already active");
      return;
    }

    // Check dependencies
    if (instance.manifest.dependencies) {
      for (const depId of instance.manifest.dependencies) {
        const dep = this.plugins.get(depId);
        if (!dep || dep.status !== "active") {
          throw new Error(
            `Plugin ${pluginId} depends on ${depId} which is not active`
          );
        }
      }
    }

    if (config) {
      instance.config = config;
    }

    const context = this.createContext(instance);

    try {
      await instance.lifecycle.activate(context);
      instance.status = "active";
      instance.activatedAt = new Date();
      instance.error = null;
      logger.info(
        { pluginId, name: instance.manifest.name },
        "Plugin activated"
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      instance.status = "error";
      instance.error = msg;
      logger.error({ pluginId, error: msg }, "Plugin activation failed");
      throw error;
    }
  }

  /**
   * Deactivate an active plugin. Calls the plugin's deactivate() lifecycle
   * hook and cleans up registered tools.
   */
  async deactivate(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (instance.status !== "active") {
      logger.info(
        { pluginId, status: instance.status },
        "Plugin not active, skipping deactivation"
      );
      return;
    }

    const context = this.createContext(instance);

    try {
      await instance.lifecycle.deactivate(context);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { pluginId, error: msg },
        "Error during plugin deactivation"
      );
    }

    // Unregister all tools this plugin registered
    for (const toolName of instance.registeredTools) {
      if (this.toolUnregistrar) {
        this.toolUnregistrar(toolName);
      }
    }
    instance.registeredTools = [];

    instance.status = "inactive";
    instance.activatedAt = null;
    logger.info(
      { pluginId, name: instance.manifest.name },
      "Plugin deactivated"
    );
  }

  /**
   * Uninstall a plugin completely. Deactivates it first if active, then
   * removes it from the registry and cleans up storage.
   */
  async uninstall(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (instance.status === "active") {
      await this.deactivate(pluginId);
    }

    // Clean up storage
    pluginStorage.delete(pluginId);

    instance.status = "uninstalled";
    this.plugins.delete(pluginId);
    logger.info({ pluginId }, "Plugin uninstalled");
  }

  /**
   * Run a health check on an active plugin.
   */
  async healthCheck(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance || instance.status !== "active") {
      return false;
    }

    if (!instance.lifecycle.healthCheck) {
      return true; // No health check defined, assume healthy
    }

    const context = this.createContext(instance);

    try {
      return await instance.lifecycle.healthCheck(context);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ pluginId, error: msg }, "Plugin health check failed");
      instance.error = msg;
      return false;
    }
  }

  /**
   * Update plugin configuration and notify the plugin.
   */
  async updateConfig(
    pluginId: string,
    config: Record<string, unknown>
  ): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    instance.config = { ...instance.config, ...config };

    if (instance.status === "active" && instance.lifecycle.onConfigChange) {
      const context = this.createContext(instance);
      await instance.lifecycle.onConfigChange(instance.config, context);
    }
  }

  // ---------------------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------------------

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  getAllPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  getPluginsByCategory(category: string): PluginInstance[] {
    return Array.from(this.plugins.values()).filter(
      (p) => p.manifest.category === category
    );
  }

  getPluginsByStatus(status: PluginStatus): PluginInstance[] {
    return Array.from(this.plugins.values()).filter((p) => p.status === status);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.id || typeof manifest.id !== "string") {
      throw new Error("Plugin manifest must have a valid 'id' string");
    }
    if (!manifest.name || typeof manifest.name !== "string") {
      throw new Error("Plugin manifest must have a valid 'name' string");
    }
    if (!manifest.version || typeof manifest.version !== "string") {
      throw new Error("Plugin manifest must have a valid 'version' string");
    }
    if (!manifest.category) {
      throw new Error("Plugin manifest must have a valid 'category'");
    }
  }

  private createContext(instance: PluginInstance): PluginContext {
    const pluginId = instance.manifest.id;
    const pluginLogger = {
      info: (msg: string, data?: Record<string, unknown>) =>
        logger.info({ pluginId, ...data }, msg),
      warn: (msg: string, data?: Record<string, unknown>) =>
        logger.warn({ pluginId, ...data }, msg),
      error: (msg: string, data?: Record<string, unknown>) =>
        logger.error({ pluginId, ...data }, msg),
      debug: (msg: string, data?: Record<string, unknown>) =>
        logger.debug({ pluginId, ...data }, msg),
    };

    return {
      manifest: instance.manifest,
      config: instance.config,
      logger: pluginLogger,
      registerTool: (tool: PluginTool) => {
        if (this.toolRegistrar) {
          this.toolRegistrar(pluginId, tool);
        }
        if (!instance.registeredTools.includes(tool.name)) {
          instance.registeredTools.push(tool.name);
        }
      },
      unregisterTool: (toolName: string) => {
        if (this.toolUnregistrar) {
          this.toolUnregistrar(toolName);
        }
        instance.registeredTools = instance.registeredTools.filter(
          (n) => n !== toolName
        );
      },
      storage: getPluginStorage(pluginId),
    };
  }
}
