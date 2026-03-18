import type {
  AgentMode,
  AgentRole,
  SessionEventType,
  SessionStatus,
} from "./enums";

export interface Session {
  endedAt: Date | null;
  id: string;
  mode: AgentMode;
  projectId: string;
  startedAt: Date;
  status: SessionStatus;
  userId: string;
}

// --- Discriminated Union Event Types ---

export interface AgentOutputEvent {
  data: {
    content: string;
    agentRole: string;
    iteration?: number;
    type?:
      | "text"
      | "tool_call"
      | "tool_result"
      | "task_started"
      | "task_completed"
      | "ask_user";
  };
  type: "agent_output";
}

export interface FileChangeEvent {
  data: {
    tool: string;
    filePath: string;
    agentRole: string;
    changeType?: "create" | "edit" | "delete";
  };
  type: "file_change";
}

export interface PlanUpdateEvent {
  data: {
    phase: string;
    status: string;
    details?: Record<string, unknown>;
  };
  type: "plan_update";
}

export interface TaskStatusEvent {
  data: {
    taskId: string;
    status: string;
    mode?: string;
    error?: string;
    creditsConsumed?: number;
  };
  type: "task_status";
}

export interface QueuePositionEvent {
  data: {
    position: number;
    estimatedWait?: number;
  };
  type: "queue_position";
}

export interface CreditUpdateEvent {
  data: {
    creditsConsumed: number;
    totalCreditsConsumed: number;
    tokensUsed?: number;
  };
  type: "credit_update";
}

export interface CheckpointEvent {
  data: {
    event: string;
    message?: string;
    agentRole?: string;
    [key: string]: unknown;
  };
  type: "checkpoint";
}

export interface ErrorEvent {
  data: {
    error?: string;
    message?: string;
    agentRole?: string;
    event?: string;
    [key: string]: unknown;
  };
  type: "error";
}

export interface ReasoningEvent {
  data: {
    content: string;
    step?: number;
  };
  type: "reasoning";
}

export interface TerminalOutputEvent {
  data: {
    command: string;
    output: string;
    success: boolean;
  };
  type: "terminal_output";
}

export interface BrowserScreenshotEvent {
  data: {
    url: string;
    screenshotUrl: string;
    timestamp: string;
  };
  type: "browser_screenshot";
}

export interface PRCreatedEvent {
  data: {
    prUrl: string;
    prNumber: number;
    title: string;
    repository: string;
  };
  type: "pr_created";
}

export type TypedSessionEvent =
  | AgentOutputEvent
  | FileChangeEvent
  | PlanUpdateEvent
  | TaskStatusEvent
  | QueuePositionEvent
  | CreditUpdateEvent
  | CheckpointEvent
  | ErrorEvent
  | ReasoningEvent
  | TerminalOutputEvent
  | BrowserScreenshotEvent
  | PRCreatedEvent;

// Keep backward-compatible generic type
export interface SessionEvent {
  agentRole: AgentRole | null;
  data: Record<string, unknown>;
  id: string;
  sessionId: string;
  timestamp: Date;
  type: SessionEventType;
}

export interface SessionMessage {
  content: string;
  createdAt: Date;
  id: string;
  modelUsed: string | null;
  role: "user" | "assistant" | "system";
  sessionId: string;
  tokensIn: number | null;
  tokensOut: number | null;
}
