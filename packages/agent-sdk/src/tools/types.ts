import { z } from "zod";

export interface ToolExecutionContext {
  sessionId: string;
  projectId: string;
  sandboxId: string;
  workDir: string;
  orgId?: string;
  userId?: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissionLevel: "read" | "write" | "execute" | "admin";
  creditCost: number;
  execute: (input: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>;
}
