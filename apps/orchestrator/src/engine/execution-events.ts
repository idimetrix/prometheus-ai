/**
 * Discriminated union of all execution events emitted by the ExecutionEngine.
 * Consumers (AgentLoop, SSE, WebSocket) match on `type` to handle each event.
 */

export interface BaseExecutionEvent {
  agentRole: string;
  sequence: number;
  sessionId: string;
  timestamp: string;
}

export interface TokenEvent extends BaseExecutionEvent {
  content: string;
  type: "token";
}

export interface ToolCallEvent extends BaseExecutionEvent {
  args: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
  type: "tool_call";
}

export interface ToolResultEvent extends BaseExecutionEvent {
  error?: string;
  filePath?: string;
  output: string;
  success: boolean;
  toolCallId: string;
  toolName: string;
  type: "tool_result";
}

export interface ConfidenceEvent extends BaseExecutionEvent {
  action: "continue" | "request_help" | "escalate";
  factors: Array<{ name: string; value: number }>;
  iteration: number;
  score: number;
  type: "confidence";
}

export interface CheckpointEvent extends BaseExecutionEvent {
  affectedFiles: string[];
  checkpointType: "large_change" | "cost_threshold" | "low_confidence";
  reason: string;
  type: "checkpoint";
}

export interface CompleteEvent extends BaseExecutionEvent {
  creditsConsumed: number;
  filesChanged: string[];
  output: string;
  steps: number;
  success: boolean;
  tokensUsed: { input: number; output: number };
  toolCalls: number;
  type: "complete";
}

export interface ErrorEvent extends BaseExecutionEvent {
  error: string;
  recoverable: boolean;
  type: "error";
}

export interface CreditUpdateEvent extends BaseExecutionEvent {
  creditsConsumed: number;
  totalCreditsConsumed: number;
  type: "credit_update";
}

export interface FileChangeEvent extends BaseExecutionEvent {
  filePath: string;
  tool: string;
  type: "file_change";
}

export interface TerminalOutputEvent extends BaseExecutionEvent {
  command: string;
  output: string;
  success: boolean;
  type: "terminal_output";
}

export interface SelfReviewEvent extends BaseExecutionEvent {
  filePath: string;
  type: "self_review";
}

export type ExecutionEvent =
  | TokenEvent
  | ToolCallEvent
  | ToolResultEvent
  | ConfidenceEvent
  | CheckpointEvent
  | CompleteEvent
  | ErrorEvent
  | CreditUpdateEvent
  | FileChangeEvent
  | TerminalOutputEvent
  | SelfReviewEvent;
