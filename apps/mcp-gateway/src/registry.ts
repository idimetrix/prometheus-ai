import { createLogger } from "@prometheus/logger";

const logger = createLogger("mcp-gateway:registry");

export interface MCPToolDefinition {
  name: string;
  adapter: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresAuth: boolean;
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

interface RegisteredTool {
  definition: MCPToolDefinition;
  handler: MCPToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: MCPToolDefinition, handler: MCPToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
    logger.debug({ tool: definition.name, adapter: definition.adapter }, "Tool registered");
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
    credentials?: Record<string, string>
  ): Promise<MCPToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` };
    }

    if (tool.definition.requiresAuth && !credentials) {
      return { success: false, error: `Tool ${name} requires authentication credentials` };
    }

    logger.info({ tool: name }, "Executing tool");
    return tool.handler(input, credentials);
  }

  listTools(): MCPToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  listToolsByAdapter(adapter: string): MCPToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.definition.adapter === adapter)
      .map((t) => t.definition);
  }

  getToolCount(): number {
    return this.tools.size;
  }
}
