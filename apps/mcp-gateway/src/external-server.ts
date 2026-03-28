/**
 * GAP-076: MCP Server for External Tools
 *
 * Exposes Prometheus as an MCP server so external agents can call
 * Prometheus tools. Authenticates via API keys.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("mcp-gateway:external-server");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MCPTool {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
}

export interface MCPRequest {
  apiKey: string;
  method: string;
  params: Record<string, unknown>;
}

export interface MCPResponse {
  error?: string;
  result: unknown;
}

// ─── External MCP Server ─────────────────────────────────────────────────────

export class ExternalMCPServer {
  private readonly tools = new Map<string, MCPTool>();
  private readonly handlers = new Map<
    string,
    (params: Record<string, unknown>) => Promise<unknown>
  >();
  private readonly validApiKeys = new Set<string>();

  constructor() {
    this.registerDefaultTools();
  }

  /**
   * Register an API key for authentication.
   */
  addApiKey(key: string): void {
    this.validApiKeys.add(key);
  }

  /**
   * Register a tool that external agents can call.
   */
  registerTool(
    tool: MCPTool,
    handler: (params: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
    logger.info({ toolName: tool.name }, "External MCP tool registered");
  }

  /**
   * Handle an incoming MCP request from an external agent.
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    // Authenticate
    if (!this.validApiKeys.has(request.apiKey)) {
      return { result: null, error: "Invalid API key" };
    }

    if (request.method === "tools/list") {
      return { result: [...this.tools.values()] };
    }

    if (request.method === "tools/call") {
      const toolName = request.params.name as string;
      const handler = this.handlers.get(toolName);

      if (!handler) {
        return { result: null, error: `Tool "${toolName}" not found` };
      }

      try {
        const result = await handler(
          (request.params.arguments as Record<string, unknown>) ?? {}
        );
        logger.info({ toolName }, "External MCP tool executed");
        return { result };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn({ toolName, error: msg }, "External MCP tool failed");
        return { result: null, error: msg };
      }
    }

    return { result: null, error: `Unknown method: ${request.method}` };
  }

  /**
   * List available tools.
   */
  listTools(): MCPTool[] {
    return [...this.tools.values()];
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private registerDefaultTools(): void {
    this.registerTool(
      {
        name: "prometheus.createTask",
        description: "Submit a new task to Prometheus",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            description: { type: "string" },
          },
          required: ["projectId", "description"],
        },
      },
      async (params) => ({
        taskId: `task_${Date.now()}`,
        status: "submitted",
        description: params.description,
      })
    );

    this.registerTool(
      {
        name: "prometheus.getSession",
        description: "Get session status and results",
        inputSchema: {
          type: "object",
          properties: { sessionId: { type: "string" } },
          required: ["sessionId"],
        },
      },
      async (params) => ({
        sessionId: params.sessionId,
        status: "running",
      })
    );

    this.registerTool(
      {
        name: "prometheus.listProjects",
        description: "List available projects",
        inputSchema: { type: "object", properties: {} },
      },
      async () => ({ projects: [] })
    );
  }
}
