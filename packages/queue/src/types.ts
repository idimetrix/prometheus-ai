import type { AgentMode, AgentRole, PlanTier } from "@prometheus/types";

export interface AgentTaskData {
  taskId: string;
  sessionId: string;
  projectId: string;
  orgId: string;
  userId: string;
  title: string;
  description: string | null;
  mode: AgentMode;
  agentRole: AgentRole | null;
  planTier: PlanTier;
  creditsReserved: number;
}

export interface IndexingJobData {
  projectId: string;
  filePaths: string[];
  fullReindex: boolean;
}

export interface NotificationJobData {
  type: "task_complete" | "task_failed" | "queue_ready" | "credits_low" | "weekly_summary";
  userId: string;
  orgId: string;
  data: Record<string, unknown>;
}

export interface BillingEventData {
  type: "credits_consumed" | "credits_purchased" | "subscription_changed";
  orgId: string;
  amount: number;
  metadata: Record<string, unknown>;
}
