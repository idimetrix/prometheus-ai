import { createLogger } from "@prometheus/logger";
import type { Session, SessionStatus } from "@prometheus/types";
import { generateId } from "@prometheus/utils";
import { AgentLoop } from "./agent-loop";

interface ActiveSession {
  session: Session;
  agentLoop: AgentLoop;
  startedAt: Date;
}

export class SessionManager {
  private readonly logger = createLogger("orchestrator:sessions");
  private readonly activeSessions = new Map<string, ActiveSession>();

  async createSession(params: {
    projectId: string;
    userId: string;
    orgId: string;
    mode: string;
  }): Promise<Session> {
    const session: Session = {
      id: generateId("ses"),
      projectId: params.projectId,
      userId: params.userId,
      status: "active" as SessionStatus,
      mode: params.mode as Session["mode"],
      startedAt: new Date(),
      endedAt: null,
    };

    const agentLoop = new AgentLoop(session.id, params.projectId, params.orgId, params.userId);
    this.activeSessions.set(session.id, {
      session,
      agentLoop,
      startedAt: new Date(),
    });

    this.logger.info({ sessionId: session.id, projectId: params.projectId }, "Session created");
    return session;
  }

  async pauseSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session ${sessionId} not found`);

    active.session.status = "paused" as SessionStatus;
    await active.agentLoop.pause();
    this.logger.info({ sessionId }, "Session paused");
  }

  async resumeSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session ${sessionId} not found`);

    active.session.status = "active" as SessionStatus;
    await active.agentLoop.resume();
    this.logger.info({ sessionId }, "Session resumed");
  }

  async cancelSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) throw new Error(`Session ${sessionId} not found`);

    active.session.status = "cancelled" as SessionStatus;
    active.session.endedAt = new Date();
    await active.agentLoop.stop();
    this.activeSessions.delete(sessionId);
    this.logger.info({ sessionId }, "Session cancelled");
  }

  getSession(sessionId: string): ActiveSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}
