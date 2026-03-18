import type { SessionStatus, AgentMode, SessionEventType, AgentRole } from "./enums";

export interface Session {
  id: string;
  projectId: string;
  userId: string;
  status: SessionStatus;
  mode: AgentMode;
  startedAt: Date;
  endedAt: Date | null;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  data: Record<string, unknown>;
  agentRole: AgentRole | null;
  timestamp: Date;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  modelUsed: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: Date;
}
