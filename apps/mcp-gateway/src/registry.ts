import { createLogger } from "@prometheus/logger";

const logger = createLogger("mcp-gateway:registry");

export interface MCPToolDefinition {
  name: string;
  adapter: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresAuth: boolean;
  category?: string;
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type MCPToolHandler = (
  input: Record<string, unknown>,
  credentials?: Record<string, string>
) => Promise<MCPToolResult>;

export interface MCPAdapter {
  name: string;
  tools: MCPToolDefinition[];
  execute(toolName: string, params: Record<string, unknown>, credentials: string): Promise<unknown>;
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
  timestamp: string;
  toolName: string;
  adapter: string;
  orgId: string | null;
  success: boolean;
  durationMs: number;
  error?: string;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private rateLimits = new Map<string, RateLimitEntry>();
  private auditLog: AuditLogEntry[] = [];
  private readonly maxAuditLogSize = 10_000;
  private readonly rateLimitWindow = 60 * 60 * 1000; // 1 hour
  private readonly defaultRateLimit = 1000; // requests per hour per org

  /**
   * Register a tool with its definition and handler.
   */
  register(definition: MCPToolDefinition, handler: MCPToolHandler): void {
    if (this.tools.has(definition.name)) {
      logger.warn({ tool: definition.name }, "Overwriting existing tool registration");
    }

    this.tools.set(definition.name, { definition, handler });
    logger.debug({ tool: definition.name, adapter: definition.adapter }, "Tool registered");
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
    logger.info({ adapter: adapter.name, toolCount: adapter.tools.length }, "Adapter registered");
  }

  /**
   * Discover available tools, optionally filtered by category.
   */
  discover(category?: string): MCPToolDefinition[] {
    const all = Array.from(this.tools.values()).map((t) => t.definition);
    if (!category) return all;
    return all.filter((t) => t.category === category || t.adapter === category);
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
    }
  ): Promise<MCPToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolName}` };
    }

    // Auth check
    if (tool.definition.requiresAuth && !ctx.credentials) {
      return { success: false, error: `Tool ${toolName} requires authentication credentials` };
    }

    // Rate limit check
    if (ctx.orgId) {
      const rateLimitKey = `${ctx.orgId}:${tool.definition.adapter}`;
      if (!this.checkRateLimit(rateLimitKey)) {
        logger.warn({ orgId: ctx.orgId, tool: toolName }, "Rate limit exceeded");
        return { success: false, error: "Rate limit exceeded. Please try again later." };
      }
    }

    // Execute the tool
    const startTime = Date.now();
    let result: MCPToolResult;

    try {
      logger.info({ tool: toolName, adapter: tool.definition.adapter }, "Executing tool");
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
    return this.execute(name, input, { credentials });
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
      this.auditLog = this.auditLog.slice(-Math.floor(this.maxAuditLogSize / 2));
    }

    // Log the audit entry
    if (entry.success) {
      logger.info(
        { tool: entry.toolName, adapter: entry.adapter, orgId: entry.orgId, durationMs: entry.durationMs },
        "Tool execution completed"
      );
    } else {
      logger.warn(
        { tool: entry.toolName, adapter: entry.adapter, orgId: entry.orgId, error: entry.error },
        "Tool execution failed"
      );
    }
  }
}
