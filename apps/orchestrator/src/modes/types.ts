import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import type { AgentLoop } from "../agent-loop";

export interface ModeHandlerParams {
  agentLoop: AgentLoop;
  orgId: string;
  planTier: string;
  projectId: string;
  sessionId: string;
  taskDescription: string;
  userId: string;
}

export interface ModeResult {
  metadata?: Record<string, unknown>;
  results: AgentExecutionResult[];
  totalCreditsConsumed: number;
}

export interface ModeHandler {
  execute(params: ModeHandlerParams): Promise<ModeResult>;
  readonly modeName: string;
}
