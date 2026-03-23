/**
 * Plugin system type definitions for Prometheus.
 *
 * Plugins extend the platform with new tools, presets, skill packs, agent roles,
 * and model providers. Each plugin declares a manifest describing its capabilities
 * and implements lifecycle hooks for activation/deactivation.
 */

// ---------------------------------------------------------------------------
// Plugin Manifest
// ---------------------------------------------------------------------------

export type PluginCategory =
  | "mcp-adapter"
  | "tech-stack-preset"
  | "skill-pack"
  | "agent-role"
  | "model-provider"
  | "integration"
  | "theme"
  | "custom";

export interface PluginManifest {
  /** Plugin author or organization */
  author: string;
  /** Plugin category for UI grouping and discovery */
  category: PluginCategory;
  /** Configuration schema (JSON Schema format) for plugin settings */
  configSchema?: Record<string, unknown>;
  /** Other plugin IDs this plugin depends on */
  dependencies?: string[];
  /** Short description of what the plugin does */
  description: string;
  /** URL to the plugin's homepage or documentation */
  homepage?: string;
  /** Icon identifier for the UI (e.g., "github", "database", "code") */
  icon?: string;
  /** Unique plugin identifier (e.g., "prometheus-plugin-github") */
  id: string;
  /** Minimum Prometheus platform version required */
  minPlatformVersion?: string;
  /** Human-readable name */
  name: string;
  /** Permission scopes the plugin requires */
  permissions?: string[];
  /** Tags for search and filtering */
  tags?: string[];
  /** SemVer version string */
  version: string;
}

// ---------------------------------------------------------------------------
// Plugin Lifecycle
// ---------------------------------------------------------------------------

export interface PluginLifecycle {
  /**
   * Called when the plugin is activated. Use this to register tools,
   * presets, skill packs, or any other resources the plugin provides.
   */
  activate(context: PluginContext): Promise<void>;

  /**
   * Called when the plugin is deactivated. Clean up any resources,
   * unregister tools, and release connections.
   */
  deactivate(context: PluginContext): Promise<void>;

  /**
   * Optional health check. Return true if the plugin is functioning
   * correctly. Called periodically by the plugin manager.
   */
  healthCheck?(context: PluginContext): Promise<boolean>;

  /**
   * Optional configuration handler. Called when plugin settings change.
   */
  onConfigChange?(
    config: Record<string, unknown>,
    context: PluginContext
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin Context
// ---------------------------------------------------------------------------

/**
 * Context provided to plugins during lifecycle events. Gives plugins
 * access to platform services without tight coupling.
 */
export interface PluginContext {
  /** Plugin-specific configuration values */
  config: Record<string, unknown>;
  /** Logger scoped to this plugin */
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    debug(msg: string, data?: Record<string, unknown>): void;
  };
  /** The plugin's own manifest */
  manifest: PluginManifest;
  /** Register a tool with the MCP gateway */
  registerTool?(tool: PluginTool): void;
  /** Access to shared key-value storage scoped to this plugin */
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  /** Unregister a tool by name */
  unregisterTool?(toolName: string): void;
}

// ---------------------------------------------------------------------------
// Plugin Tool (simplified MCP tool registration)
// ---------------------------------------------------------------------------

export interface PluginTool {
  description: string;
  handler: (
    input: Record<string, unknown>,
    credentials?: Record<string, string>
  ) => Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }>;
  inputSchema: Record<string, unknown>;
  name: string;
  requiresAuth: boolean;
}

// ---------------------------------------------------------------------------
// Plugin Instance (runtime representation)
// ---------------------------------------------------------------------------

export type PluginStatus =
  | "registered"
  | "active"
  | "inactive"
  | "error"
  | "uninstalled";

export interface PluginInstance {
  activatedAt: Date | null;
  config: Record<string, unknown>;
  error: string | null;
  lifecycle: PluginLifecycle;
  manifest: PluginManifest;
  /** Tools registered by this plugin */
  registeredTools: string[];
  status: PluginStatus;
}

// ---------------------------------------------------------------------------
// Plugin Events
// ---------------------------------------------------------------------------

export type PluginEventType =
  | "plugin:registered"
  | "plugin:activated"
  | "plugin:deactivated"
  | "plugin:error"
  | "plugin:uninstalled"
  | "plugin:config-changed"
  | "plugin:health-check";

export interface PluginEvent {
  data?: Record<string, unknown>;
  pluginId: string;
  timestamp: Date;
  type: PluginEventType;
}

export type PluginEventHandler = (event: PluginEvent) => void;
