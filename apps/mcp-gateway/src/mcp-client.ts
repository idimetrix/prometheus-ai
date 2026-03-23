import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("mcp-gateway:mcp-client");

export interface MCPServerConfig {
  /** Optional HTTP headers */
  headers?: Record<string, string>;
  /** Display name for the MCP server */
  name: string;
  /** Transport type — sse or http (MCP over HTTP) */
  transport: "sse" | "http";
  /** URL for the MCP server */
  url: string;
}

interface ConnectedClient {
  client: MCPClient;
  config: MCPServerConfig;
}

export class MCPClientManager {
  private readonly clients = new Map<string, ConnectedClient>();

  /**
   * Connect to an MCP server and store the client instance.
   */
  async connect(config: MCPServerConfig): Promise<void> {
    const { name, transport, url } = config;

    if (this.clients.has(name)) {
      logger.warn(
        { server: name },
        "Server already connected, disconnecting first"
      );
      await this.disconnect(name);
    }

    try {
      const client = await createMCPClient({
        transport: {
          type: transport,
          url,
          headers: config.headers,
        },
      });

      this.clients.set(name, { client, config });
      logger.info({ server: name, transport }, "MCP server connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { server: name, error: message },
        "Failed to connect to MCP server"
      );
    }
  }

  /**
   * Disconnect a specific MCP server by name.
   */
  async disconnect(name: string): Promise<void> {
    const entry = this.clients.get(name);
    if (!entry) {
      return;
    }

    try {
      await entry.client.close();
      logger.info({ server: name }, "MCP server disconnected");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { server: name, error: message },
        "Error disconnecting MCP server"
      );
    } finally {
      this.clients.delete(name);
    }
  }

  /**
   * Disconnect all connected MCP servers.
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.clients.keys());
    for (const name of names) {
      await this.disconnect(name);
    }
  }

  /**
   * Get AI SDK tools from one or all connected servers.
   * `tools()` returns a Promise of tool records.
   */
  async getTools(name?: string): Promise<Record<string, unknown>> {
    if (name) {
      const entry = this.clients.get(name);
      if (!entry) {
        return {};
      }
      try {
        const tools = await entry.client.tools();
        return tools as unknown as Record<string, unknown>;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          { server: name, error: message },
          "Failed to get tools from server"
        );
        return {};
      }
    }

    const allTools: Record<string, unknown> = {};
    for (const [serverName, entry] of this.clients) {
      try {
        const serverTools = await entry.client.tools();
        for (const [toolName, toolDef] of Object.entries(serverTools)) {
          allTools[toolName] = toolDef;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          { server: serverName, error: message },
          "Failed to get tools from server"
        );
      }
    }
    return allTools;
  }

  /**
   * List all connected servers with their status.
   */
  listServers(): Array<{
    name: string;
    status: "connected";
  }> {
    return Array.from(this.clients.keys()).map((name) => ({
      name,
      status: "connected" as const,
    }));
  }

  /**
   * Refresh tools from a specific server by closing and reconnecting.
   */
  async refreshTools(name: string): Promise<void> {
    const entry = this.clients.get(name);
    if (!entry) {
      return;
    }
    const { config } = entry;
    await this.disconnect(name);
    await this.connect(config);
  }
}

/** Singleton MCP client manager instance */
export const mcpClientManager = new MCPClientManager();

/**
 * Get AI SDK tools from specified MCP servers, or all servers if none specified.
 */
export async function createMCPToolsForSession(
  serverNames?: string[]
): Promise<Record<string, unknown>> {
  if (!serverNames || serverNames.length === 0) {
    return mcpClientManager.getTools();
  }

  const tools: Record<string, unknown> = {};
  for (const name of serverNames) {
    const serverTools = await mcpClientManager.getTools(name);
    for (const [toolName, toolDef] of Object.entries(serverTools)) {
      tools[toolName] = toolDef;
    }
  }
  return tools;
}
