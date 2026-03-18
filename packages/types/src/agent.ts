import type { AgentRole } from "./enums";

export interface AgentConfig {
  role: AgentRole;
  model: string;
  systemPrompt: string;
  tools: string[];
  maxTokens: number;
  temperature: number;
}

export interface AgentInstance {
  id: string;
  sessionId: string;
  role: AgentRole;
  status: "idle" | "working" | "error" | "terminated";
  currentTaskId: string | null;
  startedAt: Date;
  lastActiveAt: Date;
}
