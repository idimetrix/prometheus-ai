import { createLogger } from "@prometheus/logger";

const logger = createLogger("mcp-gateway:registry");

export interface MCPToolDefinition {
  adapter: string;
  category?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
  requiresAuth: boolean;
}

export interface MCPToolResult {
  data?: unknown;
  error?: string;
  success: boolean;
}

export type MCPToolHandler = (
  input: Record<string, unknown>,
  credentials?: Record<string, string>
) => Promise<MCPToolResult>;

export interface MCPAdapter {
  execute(
    toolName: string,
    params: Record<string, unknown>,
    credentials: string
  ): Promise<unknown>;
  name: string;
  tools: MCPToolDefinition[];
}

interface RegisteredTool {
  definition: MCPToolDefinition;
  handler: MCPToolHandler;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface AuditLogEntry {
  adapter: string;
  durationMs: number;
  error?: string;
  orgId: string | null;
  success: boolean;
  timestamp: string;
  toolName: string;
}

export interface AdapterHealthStatus {
  adapter: string;
  error?: string;
  healthy: boolean;
  lastCheck: string;
  latencyMs: number;
}

export interface ProjectToolConfig {
  config?: Record<string, unknown>;
  enabled: boolean;
  toolName: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly rateLimits = new Map<string, RateLimitEntry>();
  private auditLog: AuditLogEntry[] = [];
  private readonly maxAuditLogSize = 10_000;
  private readonly rateLimitWindow = 60 * 60 * 1000; // 1 hour
  private readonly defaultRateLimit = 1000; // requests per hour per org

  /** Per-project tool configuration: projectId -> toolName -> config */
  private readonly projectToolConfigs = new Map<
    string,
    Map<string, ProjectToolConfig>
  >();

  /** Adapter health statuses */
  private readonly healthStatuses = new Map<string, AdapterHealthStatus>();

  /** Health check interval handle */
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Register a tool with its definition and handler.
   */
  register(definition: MCPToolDefinition, handler: MCPToolHandler): void {
    if (this.tools.has(definition.name)) {
      logger.warn(
        { tool: definition.name },
        "Overwriting existing tool registration"
      );
    }

    this.tools.set(definition.name, { definition, handler });
    logger.debug(
      { tool: definition.name, adapter: definition.adapter },
      "Tool registered"
    );
  }

  /**
   * Unregister a tool by name.
   */
  unregister(toolName: string): boolean {
    const existed = this.tools.delete(toolName);
    if (existed) {
      logger.info({ tool: toolName }, "Tool unregistered");
    }
    return existed;
  }

  /**
   * Unregister all tools belonging to an adapter.
   */
  unregisterAdapter(adapterName: string): number {
    let count = 0;
    for (const [name, tool] of this.tools) {
      if (tool.definition.adapter === adapterName) {
        this.tools.delete(name);
        count++;
      }
    }
    this.healthStatuses.delete(adapterName);
    if (count > 0) {
      logger.info(
        { adapter: adapterName, removedTools: count },
        "Adapter unregistered"
      );
    }
    return count;
  }

  /**
   * Register an adapter (convenience method that registers all its tools).
   */
  registerAdapter(adapter: MCPAdapter): void {
    for (const toolDef of adapter.tools) {
      this.register(toolDef, async (input, credentials) => {
        const token = credentials?.[`${adapter.name}_token`] ?? "";
        const result = await adapter.execute(toolDef.name, input, token);
        return { success: true, data: result };
      });
    }
    logger.info(
      { adapter: adapter.name, toolCount: adapter.tools.length },
      "Adapter registered"
    );
  }

  /**
   * Discover available tools, optionally filtered by category.
   */
  discover(category?: string): MCPToolDefinition[] {
    const all = Array.from(this.tools.values()).map((t) => t.definition);
    if (!category) {
      return all;
    }
    return all.filter((t) => t.category === category || t.adapter === category);
  }

  /**
   * Get all tools grouped by adapter/provider.
   */
  discoverGrouped(): Record<string, MCPToolDefinition[]> {
    const grouped: Record<string, MCPToolDefinition[]> = {};
    for (const [, tool] of this.tools) {
      const adapter = tool.definition.adapter;
      if (!grouped[adapter]) {
        grouped[adapter] = [];
      }
      grouped[adapter]?.push(tool.definition);
    }
    return grouped;
  }

  /**
   * Get a specific tool definition by name.
   */
  getTool(toolName: string): MCPToolDefinition | undefined {
    return this.tools.get(toolName)?.definition;
  }

  /**
   * Execute a tool with authentication context and rate limiting.
   */
  async execute(
    toolName: string,
    params: Record<string, unknown>,
    ctx: {
      credentials?: Record<string, string>;
      orgId?: string;
      projectId?: string;
    }
  ): Promise<MCPToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolName}` };
    }

    // Per-project tool config check
    if (ctx.projectId) {
      const projectConfigs = this.projectToolConfigs.get(ctx.projectId);
      if (projectConfigs) {
        const toolConfig = projectConfigs.get(toolName);
        if (toolConfig && !toolConfig.enabled) {
          return {
            success: false,
            error: `Tool ${toolName} is disabled for this project`,
          };
        }
      }
    }

    // Auth check
    if (tool.definition.requiresAuth && !ctx.credentials) {
      return {
        success: false,
        error: `Tool ${toolName} requires authentication credentials`,
      };
    }

    // Rate limit check
    if (ctx.orgId) {
      const rateLimitKey = `${ctx.orgId}:${tool.definition.adapter}`;
      if (!this.checkRateLimit(rateLimitKey)) {
        logger.warn(
          { orgId: ctx.orgId, tool: toolName },
          "Rate limit exceeded"
        );
        return {
          success: false,
          error: "Rate limit exceeded. Please try again later.",
        };
      }
    }

    // Execute the tool
    const startTime = Date.now();
    let result: MCPToolResult;

    try {
      logger.info(
        { tool: toolName, adapter: tool.definition.adapter },
        "Executing tool"
      );
      result = await tool.handler(params, ctx.credentials);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result = { success: false, error: msg };
    }

    const durationMs = Date.now() - startTime;

    // Audit log
    this.addAuditEntry({
      timestamp: new Date().toISOString(),
      toolName,
      adapter: tool.definition.adapter,
      orgId: ctx.orgId ?? null,
      success: result.success,
      durationMs,
      error: result.error,
    });

    return result;
  }

  /**
   * Legacy method -- delegates to execute.
   */
  async executeTool(
    name: string,
    input: Record<string, unknown>,
    credentials?: Record<string, string>
  ): Promise<MCPToolResult> {
    return await this.execute(name, input, { credentials });
  }

  /**
   * List all registered tool definitions.
   */
  listTools(): MCPToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * List tools filtered by adapter name.
   */
  listToolsByAdapter(adapter: string): MCPToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.definition.adapter === adapter)
      .map((t) => t.definition);
  }

  /**
   * Get total number of registered tools.
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Get list of unique adapter names.
   */
  getAdapters(): string[] {
    const adapters = new Set<string>();
    for (const [, tool] of this.tools) {
      adapters.add(tool.definition.adapter);
    }
    return Array.from(adapters);
  }

  /**
   * Get recent audit log entries.
   */
  getAuditLog(limit = 100): AuditLogEntry[] {
    return this.auditLog.slice(-limit);
  }

  // ---- Per-project tool configuration ----

  /**
   * Set tool configuration for a specific project.
   */
  setProjectToolConfig(
    projectId: string,
    toolName: string,
    enabled: boolean,
    config?: Record<string, unknown>
  ): void {
    let projectConfigs = this.projectToolConfigs.get(projectId);
    if (!projectConfigs) {
      projectConfigs = new Map();
      this.projectToolConfigs.set(projectId, projectConfigs);
    }
    projectConfigs.set(toolName, { toolName, enabled, config });
    logger.info(
      { projectId, toolName, enabled },
      "Project tool config updated"
    );
  }

  /**
   * Get tool configuration for a specific project.
   */
  getProjectToolConfigs(projectId: string): ProjectToolConfig[] {
    const projectConfigs = this.projectToolConfigs.get(projectId);
    if (!projectConfigs) {
      return [];
    }
    return Array.from(projectConfigs.values());
  }

  /**
   * Get tools available for a project (respecting enabled/disabled config).
   */
  getProjectTools(projectId: string): MCPToolDefinition[] {
    const projectConfigs = this.projectToolConfigs.get(projectId);
    const allTools = this.listTools();

    if (!projectConfigs) {
      return allTools;
    }

    return allTools.filter((tool) => {
      const config = projectConfigs.get(tool.name);
      // If no explicit config, tool is enabled by default
      return !config || config.enabled;
    });
  }

  // ---- Connection health monitoring ----

  /**
   * Update health status for an adapter.
   */
  setAdapterHealth(
    adapter: string,
    healthy: boolean,
    latencyMs: number,
    error?: string
  ): void {
    this.healthStatuses.set(adapter, {
      adapter,
      healthy,
      lastCheck: new Date().toISOString(),
      latencyMs,
      error,
    });
  }

  /**
   * Get health status for all adapters.
   */
  getHealthStatuses(): AdapterHealthStatus[] {
    return Array.from(this.healthStatuses.values());
  }

  /**
   * Get health status for a specific adapter.
   */
  getAdapterHealth(adapter: string): AdapterHealthStatus | undefined {
    return this.healthStatuses.get(adapter);
  }

  /**
   * Start periodic health checks for all adapters.
   */
  startHealthChecks(
    intervalMs = 5 * 60 * 1000,
    checkFn?: (
      adapter: string
    ) => Promise<{ healthy: boolean; latencyMs: number; error?: string }>
  ): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    const runChecks = async () => {
      const adapters = this.getAdapters();
      for (const adapter of adapters) {
        try {
          if (checkFn) {
            const result = await checkFn(adapter);
            this.setAdapterHealth(
              adapter,
              result.healthy,
              result.latencyMs,
              result.error
            );
          } else {
            // Default: just mark as healthy since tools are registered
            this.setAdapterHealth(adapter, true, 0);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.setAdapterHealth(adapter, false, 0, msg);
          logger.error({ adapter, error: msg }, "Health check failed");
        }
      }
    };

    // Run immediately, then on interval
    runChecks().catch((err) =>
      logger.error({ error: String(err) }, "Initial health check failed")
    );
    this.healthCheckInterval = setInterval(() => {
      runChecks().catch((err) =>
        logger.error({ error: String(err) }, "Periodic health check failed")
      );
    }, intervalMs);

    logger.info(
      { intervalMs, adapterCount: this.getAdapters().length },
      "Health checks started"
    );
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info("Health checks stopped");
    }
  }

  // ---- Private helpers ----

  private checkRateLimit(key: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(key);

    if (!entry || now - entry.windowStart > this.rateLimitWindow) {
      // Start a new window
      this.rateLimits.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= this.defaultRateLimit) {
      return false;
    }

    entry.count++;
    return true;
  }

  private addAuditEntry(entry: AuditLogEntry): void {
    this.auditLog.push(entry);

    // Trim audit log if too large
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog = this.auditLog.slice(
        -Math.floor(this.maxAuditLogSize / 2)
      );
    }

    // Log the audit entry
    if (entry.success) {
      logger.info(
        {
          tool: entry.toolName,
          adapter: entry.adapter,
          orgId: entry.orgId,
          durationMs: entry.durationMs,
        },
        "Tool execution completed"
      );
    } else {
      logger.warn(
        {
          tool: entry.toolName,
          adapter: entry.adapter,
          orgId: entry.orgId,
          error: entry.error,
        },
        "Tool execution failed"
      );
    }
  }
}
