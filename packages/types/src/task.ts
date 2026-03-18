import type { TaskStatus, AgentRole } from "./enums";

export interface Task {
  id: string;
  sessionId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  agentRole: AgentRole | null;
  creditsReserved: number;
  creditsConsumed: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface TaskStep {
  id: string;
  taskId: string;
  stepNumber: number;
  description: string;
  status: TaskStatus;
  output: string | null;
}
