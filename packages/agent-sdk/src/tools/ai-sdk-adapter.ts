import { jsonSchema } from "ai";
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
 * Shape matching AI SDK 6 Tool type for tool definitions with execute.
 */
interface AISDKToolDef {
  description: string;
  execute: (input: Record<string, unknown>) => Promise<string>;
  inputSchema: ReturnType<typeof jsonSchema>;
}

/**
 * Convert a single AgentToolDefinition into an AI SDK 6 tool object.
 */
export function convertSingleTool(
  toolDef: AgentToolDefinition,
  executionContext: ToolExecutionContext
): AISDKToolDef {
  return {
    description: toolDef.description,
    inputSchema: jsonSchema<Record<string, unknown>>(
      toolDef.inputSchema as Parameters<typeof jsonSchema>[0]
    ),
    execute: async (input: Record<string, unknown>) => {
      const result = await toolDef.execute(input, executionContext);
      return serializeToolResult(result);
    },
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
