/**
 * Phase 12.2: Versioned event schema for the real-time event system.
 * All events carry a monotonic sequence number per session.
 */

export interface BaseEvent {
  agentRole?: string;
  id: string;
  sequence: number;
  sessionId: string;
  timestamp: string;
  version: number;
}

export interface AgentOutputEvent extends BaseEvent {
  content: string;
  streaming: boolean;
  type: "agent_output";
}

export interface ToolCallStartEvent extends BaseEvent {
  args: Record<string, unknown>;
  toolName: string;
  type: "tool_call_start";
}

export interface ToolCallResultEvent extends BaseEvent {
  error?: string;
  output: string;
  success: boolean;
  toolName: string;
  type: "tool_call_result";
}

export interface FileChangeEvent extends BaseEvent {
  filePath: string;
  operation: "create" | "modify" | "delete";
  type: "file_change";
}

export interface TerminalOutputEvent extends BaseEvent {
  command: string;
  exitCode?: number;
  output: string;
  type: "terminal_output";
}

export interface AgentStatusEvent extends BaseEvent {
  confidence?: number;
  iteration?: number;
  status: "running" | "completed" | "failed" | "paused" | "escalated";
  type: "agent_status";
}

export interface CreditUpdateEvent extends BaseEvent {
  creditsConsumed: number;
  totalCreditsConsumed: number;
  type: "credit_update";
}

export interface CheckpointEvent extends BaseEvent {
  affectedFiles: string[];
  checkpointType: string;
  reason: string;
  type: "checkpoint";
}

export interface PlanUpdateEvent extends BaseEvent {
  phase: string;
  status: string;
  type: "plan_update";
}

export interface TaskStatusEvent extends BaseEvent {
  status: string;
  taskId: string;
  type: "task_status";
}

export interface ErrorEvent extends BaseEvent {
  error: string;
  recoverable: boolean;
  type: "error";
}

export type SessionEvent =
  | AgentOutputEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | FileChangeEvent
  | TerminalOutputEvent
  | AgentStatusEvent
  | CreditUpdateEvent
  | CheckpointEvent
  | PlanUpdateEvent
  | TaskStatusEvent
  | ErrorEvent;

/** Current event schema version */
export const EVENT_VERSION = 1;
