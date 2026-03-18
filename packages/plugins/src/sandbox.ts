import { createLogger } from "@prometheus/logger";

const logger = createLogger("plugins:sandbox");

export interface PluginPermission {
  actions: string[];
  scope: string;
}

export interface SandboxConfig {
  allowedHosts?: string[];
  allowNetwork: boolean;
  memoryLimitMb: number;
  permissions: PluginPermission[];
  timeoutMs: number;
}

const DEFAULT_CONFIG: SandboxConfig = {
  permissions: [],
  memoryLimitMb: 128,
  timeoutMs: 30_000,
  allowNetwork: false,
};

export type PermissionScope =
  | "filesystem:read"
  | "filesystem:write"
  | "network:outbound"
  | "mcp:tool:register"
  | "mcp:tool:execute"
  | "database:read"
  | "database:write"
  | "secrets:read"
  | "events:publish"
  | "events:subscribe";

/**
 * PluginSandbox provides isolation for plugin execution.
 * Gates capabilities based on declared permissions in the manifest.
 */
export class PluginSandbox {
  private readonly config: SandboxConfig;
  private readonly pluginId: string;
  private readonly grantedPermissions: Set<string>;

  constructor(pluginId: string, config?: Partial<SandboxConfig>) {
    this.pluginId = pluginId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.grantedPermissions = new Set(
      this.config.permissions.flatMap((p) =>
        p.actions.map((a) => `${p.scope}:${a}`)
      )
    );
  }

  /**
   * Check if a permission is granted to this plugin.
   */
  hasPermission(scope: PermissionScope): boolean {
    // Check exact match
    if (this.grantedPermissions.has(scope)) {
      return true;
    }

    // Check wildcard (e.g., "filesystem:*" matches "filesystem:read")
    const [category] = scope.split(":");
    if (this.grantedPermissions.has(`${category}:*`)) {
      return true;
    }

    return false;
  }

  /**
   * Execute a function within the sandbox constraints.
   * Enforces timeout and permission checks.
   */
  async execute<T>(
    fn: () => Promise<T>,
    requiredPermissions: PermissionScope[] = []
  ): Promise<{ result: T | null; error: string | null; duration: number }> {
    const start = Date.now();

    // Check permissions
    for (const perm of requiredPermissions) {
      if (!this.hasPermission(perm)) {
        logger.warn(
          { pluginId: this.pluginId, permission: perm },
          "Plugin permission denied"
        );
        return {
          result: null,
          error: `Permission denied: ${perm}. Plugin "${this.pluginId}" does not have this permission.`,
          duration: Date.now() - start,
        };
      }
    }

    // Execute with timeout
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Plugin execution timed out after ${this.config.timeoutMs}ms`
                )
              ),
            this.config.timeoutMs
          )
        ),
      ]);

      return { result, error: null, duration: Date.now() - start };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { pluginId: this.pluginId, error: message },
        "Plugin execution failed"
      );
      return { result: null, error: message, duration: Date.now() - start };
    }
  }

  /**
   * Validate a network request against allowed hosts.
   */
  canAccessHost(hostname: string): boolean {
    if (!this.config.allowNetwork) {
      return false;
    }
    if (!this.config.allowedHosts || this.config.allowedHosts.length === 0) {
      return true;
    }
    return this.config.allowedHosts.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`)
    );
  }

  /**
   * Get the sandbox configuration for inspection.
   */
  getConfig(): Readonly<SandboxConfig> {
    return { ...this.config };
  }

  /**
   * Get all granted permissions.
   */
  getPermissions(): string[] {
    return Array.from(this.grantedPermissions);
  }
}
