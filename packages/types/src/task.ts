import type { AgentRole, TaskStatus } from "./enums";

export const TaskPhase = {
  QUEUED: "queued",
  ROUTING: "routing",
  AGENT_ASSIGNED: "agent_assigned",
  EXECUTING: "executing",
  REVIEWING: "reviewing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type TaskPhase = (typeof TaskPhase)[keyof typeof TaskPhase];

export interface TaskProgressEvent {
  agentRole?: AgentRole;
  message: string;
  phase: TaskPhase;
  progress: number;
  sessionId: string;
  taskId: string;
  timestamp: string;
}

export interface Task {
  agentRole: AgentRole | null;
  completedAt: Date | null;
  createdAt: Date;
  creditsConsumed: number;
  creditsReserved: number;
  description: string | null;
  id: string;
  priority: number;
  projectId: string;
  sessionId: string;
  startedAt: Date | null;
  status: TaskStatus;
  title: string;
}

export interface TaskStep {
  description: string;
  id: string;
  output: string | null;
  status: TaskStatus;
  stepNumber: number;
  taskId: string;
}
