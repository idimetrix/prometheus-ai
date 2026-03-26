import { agents, db, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { Session, SessionStatus, TaskPhase } from "@prometheus/types";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { AgentLoop } from "./agent-loop";

interface ActiveSession {
  activeAgents: Map<string, { role: string; startedAt: Date }>;
  agentLoop: AgentLoop;
  session: Session;
  startedAt: Date;
}

/**
 * SessionManager handles the lifecycle of orchestrator sessions.
 * Each session maps to a user interaction and contains one or more
 * agent executions. State is persisted to PostgreSQL via Drizzle and
 * kept in-memory for fast access while active.
 */
export class SessionManager {
  private readonly logger = createLogger("orchestrator:sessions");
  private readonly activeSessions = new Map<string, ActiveSession>();
  private readonly eventPublisher: EventPublisher;

  constructor() {
    this.eventPublisher = new EventPublisher();
  }

  /**
   * Create a new session. Persists to DB and keeps an in-memory reference
   * with an associated AgentLoop.
   */
  async createSession(
    params: {
      projectId: string;
      userId: string;
      orgId: string;
      mode: string;
    },
    existingId?: string
  ): Promise<Session> {
    const sessionId = existingId ?? generateId("ses");

    const session: Session = {
      id: sessionId,
      projectId: params.projectId,
      userId: params.userId,
      status: "active" as SessionStatus,
      mode: params.mode as Session["mode"],
      startedAt: new Date(),
      endedAt: null,
    };

    // Persist to database
    try {
      await db
        .insert(sessions)
        .values({
          id: session.id,
          projectId: session.projectId,
          userId: session.userId,
          status: "active",
          mode: session.mode,
          startedAt: session.startedAt,
        })
        .onConflictDoNothing();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        { error: msg, sessionId: session.id },
        "Failed to persist session to DB (may already exist)"
      );
    }

    const agentLoop = new AgentLoop(
      session.id,
      params.projectId,
      params.orgId,
      params.userId
    );
    this.activeSessions.set(session.id, {
      session,
      agentLoop,
      startedAt: new Date(),
      activeAgents: new Map(),
    });

    this.logger.info(
      { sessionId: session.id, projectId: params.projectId, mode: params.mode },
      "Session created"
    );
    return session;
  }

  /**
   * Load a session from the database into memory if not already active.
   */
  async loadSession(
    sessionId: string,
    orgId: string
  ): Promise<ActiveSession | null> {
    // Check in-memory first
    const existing = this.activeSessions.get(sessionId);
    if (existing) {
      return existing;
    }

    // Load from DB
    try {
      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }

      const session: Session = {
        id: row.id,
        projectId: row.projectId,
        userId: row.userId,
        status: row.status as SessionStatus,
        mode: row.mode as Session["mode"],
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      };

      const agentLoop = new AgentLoop(
        session.id,
        session.projectId,
        orgId,
        session.userId
      );
      const active: ActiveSession = {
        session,
        agentLoop,
        startedAt: session.startedAt,
        activeAgents: new Map(),
      };

      this.activeSessions.set(session.id, active);
      this.logger.info({ sessionId }, "Session loaded from DB");
      return active;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { error: msg, sessionId },
        "Failed to load session from DB"
      );
      return null;
    }
  }

  /**
   * Pause a running session. Pauses the agent loop and persists status.
   */
  async pauseSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      throw new Error(`Session ${sessionId} not found`);
    }

    active.session.status = "paused" as SessionStatus;
    await active.agentLoop.pause();

    // Persist to DB
    await db
      .update(sessions)
      .set({ status: "paused" })
      .where(eq(sessions.id, sessionId));

    // Update all active agents for this session
    await db
      .update(agents)
      .set({ status: "idle" })
      .where(
        and(eq(agents.sessionId, sessionId), eq(agents.status, "working"))
      );

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { status: "paused" },
      timestamp: new Date().toISOString(),
    });

    this.logger.info({ sessionId }, "Session paused");
  }

  /**
   * Resume a paused session.
   */
  async resumeSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      throw new Error(`Session ${sessionId} not found`);
    }

    active.session.status = "active" as SessionStatus;
    await active.agentLoop.resume();

    // Persist to DB
    await db
      .update(sessions)
      .set({ status: "active" })
      .where(eq(sessions.id, sessionId));

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.SESSION_RESUME,
      data: { status: "active" },
      timestamp: new Date().toISOString(),
    });

    this.logger.info({ sessionId }, "Session resumed");
  }

  /**
   * Cancel a session. Stops the agent loop and cleans up.
   */
  async cancelSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      throw new Error(`Session ${sessionId} not found`);
    }

    active.session.status = "cancelled" as SessionStatus;
    active.session.endedAt = new Date();
    await active.agentLoop.stop();

    // Persist to DB
    await db
      .update(sessions)
      .set({
        status: "cancelled",
        endedAt: active.session.endedAt,
      })
      .where(eq(sessions.id, sessionId));

    // Terminate all agents
    await db
      .update(agents)
      .set({
        status: "terminated",
        terminatedAt: new Date(),
      })
      .where(eq(agents.sessionId, sessionId));

    this.activeSessions.delete(sessionId);

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { status: "cancelled" },
      timestamp: new Date().toISOString(),
    });

    this.logger.info({ sessionId }, "Session cancelled");
  }

  /**
   * Complete a session normally.
   */
  async completeSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      return;
    }

    active.session.status = "completed" as SessionStatus;
    active.session.endedAt = new Date();
    await active.agentLoop.stop();

    await db
      .update(sessions)
      .set({
        status: "completed",
        endedAt: active.session.endedAt,
      })
      .where(eq(sessions.id, sessionId));

    this.activeSessions.delete(sessionId);
    this.logger.info({ sessionId }, "Session completed");
  }

  /**
   * Register an agent as active within a session.
   */
  trackAgent(sessionId: string, agentId: string, role: string): void {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      return;
    }
    active.activeAgents.set(agentId, { role, startedAt: new Date() });
  }

  /**
   * Remove an agent from the active tracking.
   */
  untrackAgent(sessionId: string, agentId: string): void {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      return;
    }
    active.activeAgents.delete(agentId);
  }

  getSession(sessionId: string): ActiveSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get the status summary for a session including agent details.
   */
  getSessionStatus(sessionId: string): {
    session: Session;
    activeAgentCount: number;
    agents: Array<{ id: string; role: string; startedAt: Date }>;
    loopStatus: string;
    creditsConsumed: number;
  } | null {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      return null;
    }

    return {
      session: active.session,
      activeAgentCount: active.activeAgents.size,
      agents: Array.from(active.activeAgents.entries()).map(([id, info]) => ({
        id,
        role: info.role,
        startedAt: info.startedAt,
      })),
      loopStatus: active.agentLoop.getStatus(),
      creditsConsumed: active.agentLoop.getCreditsConsumed(),
    };
  }

  /**
   * Retry a failed session. Reloads the session and restarts the agent loop.
   */
  async retrySession(
    sessionId: string,
    orgId: string,
    fromCheckpoint: boolean
  ): Promise<void> {
    // Remove stale entry if present
    this.activeSessions.delete(sessionId);

    // Reload from DB
    const active = await this.loadSession(sessionId, orgId);
    if (!active) {
      throw new Error(`Session ${sessionId} not found for retry`);
    }

    active.session.status = "active" as SessionStatus;
    active.session.endedAt = null;

    // Persist to DB
    await db
      .update(sessions)
      .set({ status: "active", endedAt: null })
      .where(eq(sessions.id, sessionId));

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.SESSION_RESUME,
      data: { status: "active", retried: true, fromCheckpoint },
      timestamp: new Date().toISOString(),
    });

    this.logger.info({ sessionId, fromCheckpoint }, "Session retried");
  }

  async emitTaskProgress(
    sessionId: string,
    taskId: string,
    phase: TaskPhase,
    progress: number,
    message: string,
    agentRole?: string
  ): Promise<void> {
    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: "task_progress",
      data: { taskId, phase, progress, message, agentRole },
      timestamp: new Date().toISOString(),
    });
    this.logger.debug(
      { sessionId, taskId, phase, progress },
      "Task progress emitted"
    );
  }

  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}
