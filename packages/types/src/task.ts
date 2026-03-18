import type { AgentRole, TaskStatus } from "./enums";

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
