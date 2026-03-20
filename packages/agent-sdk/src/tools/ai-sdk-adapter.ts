import type { Tool } from "ai";
import { jsonSchema, zodSchema } from "ai";
import { TOOL_REGISTRY } from "./registry";
import type {
  AgentToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./types";

/**
 * Serialize a ToolResult into a string for AI SDK tool output.
 */
function serializeToolResult(result: ToolResult): string {
  return JSON.stringify({
    success: result.success,
    output: result.output,
    error: result.error,
    metadata: result.metadata,
  });
}

/**
 * AI SDK 6 tool definition with execute that returns a string.
 */
type AISDKToolDef = Tool<Record<string, unknown>, string>;

/**
 * Convert a single AgentToolDefinition into an AI SDK 6 tool object.
 *
 * When a tool definition has a `zodSchema` property, it is used directly
 * via AI SDK 6's `zodSchema()` wrapper for better type inference and
 * validation. Falls back to `jsonSchema()` for tools without Zod schemas.
 */
export function convertSingleTool(
  toolDef: AgentToolDefinition,
  executionContext: ToolExecutionContext
): AISDKToolDef {
  const execute = async (input: Record<string, unknown>) => {
    const result = await toolDef.execute(input, executionContext);
    return serializeToolResult(result);
  };

  // Prefer native Zod schema when available for better AI SDK 6 integration
  if (toolDef.zodSchema) {
    return {
      description: toolDef.description,
      inputSchema: zodSchema(toolDef.zodSchema),
      execute,
    };
  }

  return {
    description: toolDef.description,
    inputSchema: jsonSchema<Record<string, unknown>>(
      toolDef.inputSchema as Parameters<typeof jsonSchema>[0]
    ),
    execute,
  };
}

/**
 * Convert a record of AgentToolDefinitions into a record of AI SDK 6 tools.
 */
export function convertToolsToAISDK(
  tools: Record<string, AgentToolDefinition>,
  executionContext: ToolExecutionContext
): Record<string, AISDKToolDef> {
  const converted: Record<string, AISDKToolDef> = {};

  for (const [name, toolDef] of Object.entries(tools)) {
    converted[name] = convertSingleTool(toolDef, executionContext);
  }

  return converted;
}

/**
 * Convert the entire global TOOL_REGISTRY into AI SDK 6 tools.
 */
export function convertRegistryToAISDK(
  executionContext: ToolExecutionContext
): Record<string, AISDKToolDef> {
  return convertToolsToAISDK(TOOL_REGISTRY, executionContext);
}
