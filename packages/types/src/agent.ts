import type { AgentRole } from "./enums";

export interface AgentConfig {
  maxTokens: number;
  model: string;
  role: AgentRole;
  systemPrompt: string;
  temperature: number;
  tools: string[];
}

export interface AgentInstance {
  currentTaskId: string | null;
  id: string;
  lastActiveAt: Date;
  role: AgentRole;
  sessionId: string;
  startedAt: Date;
  status: "idle" | "working" | "error" | "terminated";
}
