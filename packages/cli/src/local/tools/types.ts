/**
 * Result of a local tool execution.
 */
export interface ToolResult {
  output: string;
  success: boolean;
}

/**
 * JSON Schema for tool parameters.
 */
export interface ToolParameterSchema {
  items?: { type: string };
  properties: Record<
    string,
    { type: string; description: string; items?: { type: string } }
  >;
  required: string[];
  type: "object";
}

/**
 * Definition of a local tool that can be executed by the local engine.
 */
export interface LocalTool {
  /** Human-readable description of what this tool does */
  description: string;
  /** Execute the tool with the given arguments */
  execute: (
    args: Record<string, unknown>,
    projectDir: string
  ) => Promise<ToolResult>;
  /** Unique tool name */
  name: string;
  /** JSON Schema for the tool's parameters */
  parameters: ToolParameterSchema;
  /** Whether this tool requires user approval before execution */
  requiresApproval: boolean;
}
