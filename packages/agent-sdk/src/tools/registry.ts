import { agentMetaTools } from "./agent-tools";
import { astGrepTools } from "./ast-grep";
import { browserTools } from "./browser";
import { browserAutomationTools } from "./browser-automation";
import { docSearchTools } from "./doc-search";
import { envSetupTools } from "./env-setup";
import { fileTools } from "./file";
import { gitTools } from "./git";
import { lspTools } from "./lsp";
import { openhandsEditTools } from "./openhands-edit";
import { sandboxRollbackTools } from "./sandbox-rollback";
import { searchTools } from "./search";
import { semgrepTools } from "./semgrep";
import { terminalTools } from "./terminal";
import type { AgentToolDefinition } from "./types";
import { webFetchTools } from "./web-fetch";
import { webSearchTools } from "./web-search";
import { zoektTools } from "./zoekt";

export const TOOL_REGISTRY: Record<string, AgentToolDefinition> = {};

function registerTools(tools: AgentToolDefinition[]) {
  for (const tool of tools) {
    TOOL_REGISTRY[tool.name] = tool;
  }
}

registerTools(fileTools);
registerTools(terminalTools);
registerTools(gitTools);
registerTools(searchTools);
registerTools(browserTools);
registerTools(browserAutomationTools);
registerTools(agentMetaTools);
registerTools(lspTools);
registerTools(astGrepTools);
registerTools(zoektTools);
registerTools(semgrepTools);
registerTools(openhandsEditTools);
registerTools(sandboxRollbackTools);
registerTools(envSetupTools);
registerTools(webSearchTools);
registerTools(webFetchTools);
registerTools(docSearchTools);

/**
 * ToolRegistry class for programmatic tool management.
 * Provides methods to register, resolve, and execute tools with validation.
 */
export class ToolRegistry {
  private readonly tools: Map<string, AgentToolDefinition> = new Map();

  constructor(initialTools?: AgentToolDefinition[]) {
    if (initialTools) {
      for (const tool of initialTools) {
        this.tools.set(tool.name, tool);
      }
    }
  }

  /**
   * Register a new tool definition.
   */
  register(tool: AgentToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools at once.
   */
  registerAll(tools: AgentToolDefinition[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Resolve a tool by name. Returns undefined if not found.
   */
  resolve(name: string): AgentToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Resolve multiple tools by name. Skips unknown names.
   */
  resolveMany(names: string[]): AgentToolDefinition[] {
    const result: AgentToolDefinition[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) {
        result.push(tool);
      }
    }
    return result;
  }

  /**
   * Execute a tool by name with the given input and context.
   * Validates inputs against both JSON Schema required fields and the Zod schema.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: import("./types").ToolExecutionContext
  ): Promise<import("./types").ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Unknown tool: ${name}. Available tools: ${[...this.tools.keys()].join(", ")}`,
      };
    }

    // Validate required fields from the JSON Schema
    const schema = tool.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    if (schema.required) {
      for (const field of schema.required) {
        if (input[field] === undefined || input[field] === null) {
          return {
            success: false,
            output: "",
            error: `Missing required parameter '${field}' for tool '${name}'`,
          };
        }
      }
    }

    // Validate with Zod schema if available (provides richer type coercion & validation)
    if (tool.zodSchema) {
      const result = tool.zodSchema.safeParse(input);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return {
          success: false,
          output: "",
          error: `Invalid input for tool '${name}': ${issues}`,
        };
      }
    }

    try {
      return await tool.execute(input, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: "",
        error: `Tool '${name}' threw an error: ${message}`,
      };
    }
  }

  /**
   * Get all registered tool names.
   */
  getNames(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Get all registered tool definitions.
   */
  getAll(): AgentToolDefinition[] {
    return [...this.tools.values()];
  }

  /**
   * Get tool definitions formatted for OpenAI function calling.
   */
  getOpenAIToolDefs(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return this.getAll().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Create a scoped registry containing only the specified tools.
   */
  scoped(toolNames: string[]): ToolRegistry {
    return new ToolRegistry(this.resolveMany(toolNames));
  }

  get size(): number {
    return this.tools.size;
  }
}

/**
 * Global default registry pre-populated with all built-in tools.
 */
export const globalRegistry = new ToolRegistry(Object.values(TOOL_REGISTRY));
