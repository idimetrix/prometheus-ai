import type { z } from "zod";

export interface ToolExecutionContext {
  orgId?: string;
  projectId: string;
  sandboxId: string;
  sessionId: string;
  userId?: string;
  workDir: string;
}

export interface ToolResult {
  error?: string;
  metadata?: Record<string, unknown>;
  output: string;
  success: boolean;
}

export interface AgentToolDefinition {
  creditCost: number;
  description: string;
  execute: (
    input: Record<string, unknown>,
    ctx: ToolExecutionContext
  ) => Promise<ToolResult>;
  /** JSON Schema for LLM function calling (OpenAI tool format). */
  inputSchema: Record<string, unknown>;
  name: string;
  permissionLevel: "read" | "write" | "execute" | "admin";
  /** Zod schema for runtime input validation. */
  zodSchema: z.ZodType<Record<string, unknown>>;
}

/**
 * Helper to create a tool definition with both Zod and JSON Schema.
 * The zodSchema is used for runtime validation while inputSchema
 * is sent to LLMs for function calling.
 */
export function defineTool(def: AgentToolDefinition): AgentToolDefinition {
  return def;
}
