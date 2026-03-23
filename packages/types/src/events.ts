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

export interface BlueprintAnalysisEvent extends BaseEvent {
  blueprintId: string;
  componentCount: number;
  phase: string;
  status: "started" | "analyzing" | "completed" | "failed";
  type: "blueprint_analysis";
}

export interface TechStackRecommendationEvent extends BaseEvent {
  confidence: number;
  projectId: string;
  rationale: string;
  recommendations: Array<{
    category: string;
    name: string;
    reason: string;
  }>;
  type: "tech_stack_recommendation";
}

export interface ScaffoldProgressEvent extends BaseEvent {
  currentFile?: string;
  filesGenerated: number;
  phase: string;
  progress: number;
  totalFiles: number;
  type: "scaffold_progress";
}

export interface AgentDecisionEvent extends BaseEvent {
  alternatives: string[];
  decision: string;
  rationale: string;
  type: "agent_decision";
}

export interface AgentConfidenceChangeEvent extends BaseEvent {
  newConfidence: number;
  previousConfidence: number;
  reason: string;
  type: "agent_confidence_change";
}

export interface HumanInputRequestEvent extends BaseEvent {
  context: Record<string, unknown>;
  options?: string[];
  prompt: string;
  required: boolean;
  timeoutMs?: number;
  type: "human_input_request";
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
  | ErrorEvent
  | BlueprintAnalysisEvent
  | TechStackRecommendationEvent
  | ScaffoldProgressEvent
  | AgentDecisionEvent
  | AgentConfidenceChangeEvent
  | HumanInputRequestEvent;

/** Current event schema version */
export const EVENT_VERSION = 1;
