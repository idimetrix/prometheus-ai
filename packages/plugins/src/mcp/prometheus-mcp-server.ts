import { createLogger } from "@prometheus/logger";

const logger = createLogger("plugins:mcp-server");

// ---------------------------------------------------------------------------
// MCP Protocol Types
// ---------------------------------------------------------------------------

interface MCPTool {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
}

interface MCPToolCallRequest {
  method: "call_tool";
  params: {
    arguments: Record<string, unknown>;
    name: string;
  };
}

interface MCPListToolsRequest {
  method: "list_tools";
}

type MCPRequest = MCPToolCallRequest | MCPListToolsRequest;

interface MCPToolCallResponse {
  content: Array<{ text: string; type: "text" }>;
  isError?: boolean;
}

interface MCPListToolsResponse {
  tools: MCPTool[];
}

type MCPResponse = MCPToolCallResponse | MCPListToolsResponse;

type ToolHandler = (
  args: Record<string, unknown>
) =>
  | Promise<{ data?: unknown; error?: string; success: boolean }>
  | { data?: unknown; error?: string; success: boolean };

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

/**
 * Exposes Prometheus platform capabilities as MCP (Model Context Protocol) tools.
 * Handles list_tools and call_tool protocol messages.
 */
export class PrometheusMCPServer {
  private readonly tools = new Map<
    string,
    { definition: MCPTool; handler: ToolHandler }
  >();

  constructor() {
    // Register built-in Prometheus tools
    this.registerBuiltinTools();
  }

  /**
   * Handle an incoming MCP protocol message.
   */
  handleMessage(request: MCPRequest): Promise<MCPResponse> | MCPResponse {
    switch (request.method) {
      case "list_tools":
        return this.handleListTools();
      case "call_tool":
        return this.handleCallTool(request);
      default: {
        logger.warn(
          { method: (request as { method: string }).method },
          "Unknown MCP method"
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown method: ${(request as { method: string }).method}`,
            },
          ],
          isError: true,
        };
      }
    }
  }

  /**
   * Register a new MCP tool.
   */
  registerTool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: ToolHandler
  ): void {
    this.tools.set(name, {
      definition: { name, description, inputSchema },
      handler,
    });
    logger.info({ tool: name }, "MCP tool registered");
  }

  /**
   * Unregister an MCP tool.
   */
  unregisterTool(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      logger.info({ tool: name }, "MCP tool unregistered");
    }
    return removed;
  }

  /**
   * Get all registered tool definitions.
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  private handleListTools(): MCPListToolsResponse {
    return {
      tools: Array.from(this.tools.values()).map((t) => t.definition),
    };
  }

  private async handleCallTool(
    request: MCPToolCallRequest
  ): Promise<MCPToolCallResponse> {
    const { name, arguments: args } = request.params;
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool not found: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(args);
      return {
        content: [
          {
            type: "text",
            text: result.success
              ? JSON.stringify(result.data ?? { success: true })
              : (result.error ?? "Unknown error"),
          },
        ],
        isError: !result.success,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ tool: name, error: msg }, "MCP tool call failed");
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
    }
  }

  private registerBuiltinTools(): void {
    this.registerTool(
      "runAgent",
      "Run a Prometheus agent with a task description",
      {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description" },
          agentType: {
            type: "string",
            description: "Agent type (architect, coder, reviewer, etc.)",
          },
        },
        required: ["task"],
      },
      (args) => {
        return Promise.resolve({
          success: true,
          data: {
            message: `Agent task queued: ${args.task}`,
            agentType: args.agentType ?? "auto",
          },
        });
      }
    );

    this.registerTool(
      "searchCode",
      "Search the codebase using natural language",
      {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query",
          },
          maxResults: {
            type: "number",
            description: "Maximum results to return",
          },
        },
        required: ["query"],
      },
      (args) => {
        return Promise.resolve({
          success: true,
          data: {
            query: args.query,
            results: [],
            message: "Search initiated",
          },
        });
      }
    );

    this.registerTool(
      "queryMemory",
      "Query the project memory/knowledge base",
      {
        type: "object",
        properties: {
          query: { type: "string", description: "Memory query" },
          scope: {
            type: "string",
            description: "Scope: project, session, or global",
          },
        },
        required: ["query"],
      },
      (args) => {
        return Promise.resolve({
          success: true,
          data: {
            query: args.query,
            scope: args.scope ?? "project",
            entries: [],
          },
        });
      }
    );

    this.registerTool(
      "getProjectContext",
      "Get context about the current project",
      {
        type: "object",
        properties: {
          aspects: {
            type: "array",
            items: { type: "string" },
            description:
              "Aspects to include: structure, dependencies, config, etc.",
          },
        },
      },
      (args) => {
        return Promise.resolve({
          success: true,
          data: {
            aspects: (args.aspects as string[] | undefined) ?? ["structure"],
            context: {},
          },
        });
      }
    );

    this.registerTool(
      "generateTests",
      "Generate tests for specified code",
      {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Path to the file to generate tests for",
          },
          framework: {
            type: "string",
            description: "Test framework (vitest, jest, etc.)",
          },
        },
        required: ["filePath"],
      },
      (args) => {
        return Promise.resolve({
          success: true,
          data: {
            filePath: args.filePath,
            framework: args.framework ?? "vitest",
            message: "Test generation initiated",
          },
        });
      }
    );
  }
}

export type {
  MCPListToolsRequest,
  MCPListToolsResponse,
  MCPRequest,
  MCPResponse,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResponse,
  ToolHandler,
};
