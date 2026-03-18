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
