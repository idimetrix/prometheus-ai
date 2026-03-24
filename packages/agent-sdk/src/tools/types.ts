import type { z } from "zod";

export interface ToolExecutionContext {
  orgId?: string;
  projectId: string;
  sandboxId: string;
  /** URL of the sandbox-manager service (e.g. http://localhost:4006). Falls back to SANDBOX_MANAGER_URL env var. */
  sandboxManagerUrl?: string;
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
  /** Risk level for this tool. High-risk tools require checkpoint approval. */
  riskLevel?: "low" | "medium" | "high" | "critical";
  /** Zod schema for runtime input validation. When present, AI SDK 6 adapter uses it directly via zodSchema() for better type inference. */
  zodSchema?: z.ZodType<Record<string, unknown>>;
}

/**
 * Helper to create a tool definition with both Zod and JSON Schema.
 * The zodSchema is used for runtime validation while inputSchema
 * is sent to LLMs for function calling.
 */
export function defineTool(def: AgentToolDefinition): AgentToolDefinition {
  return def;
}
