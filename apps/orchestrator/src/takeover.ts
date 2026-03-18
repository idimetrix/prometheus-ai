import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";

const logger = createLogger("orchestrator:takeover");

export type TakeoverStatus = "agent" | "human" | "transitioning";

interface TakeoverState {
  humanUserId: string | null;
  releasedAt: Date | null;
  sessionId: string;
  status: TakeoverStatus;
  takenOverAt: Date | null;
}

/**
 * TakeoverManager handles human-in-the-loop control transfer.
 * A user can "take over" from the agent, make manual edits, then
 * release control back to the agent which resumes from the new state.
 */
export class TakeoverManager {
  private readonly sessions = new Map<string, TakeoverState>();
  private readonly eventPublisher: EventPublisher;

  constructor() {
    this.eventPublisher = new EventPublisher();
  }

  /**
   * Human takes control from agent.
   */
  async takeover(sessionId: string, userId: string): Promise<void> {
    const state: TakeoverState = {
      sessionId,
      status: "human",
      humanUserId: userId,
      takenOverAt: new Date(),
      releasedAt: null,
    };

    this.sessions.set(sessionId, state);

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: {
        event: "takeover",
        userId,
        status: "human_control",
      },
      timestamp: new Date().toISOString(),
    });

    logger.info({ sessionId, userId }, "Human took over session");
  }

  /**
   * Human releases control back to agent.
   */
  async release(
    sessionId: string,
    userId: string,
    context?: string
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return;
    }

    state.status = "agent";
    state.releasedAt = new Date();

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: {
        event: "release",
        userId,
        status: "agent_control",
        humanContext: context,
      },
      timestamp: new Date().toISOString(),
    });

    this.sessions.delete(sessionId);
    logger.info({ sessionId, userId }, "Control released back to agent");
  }

  /**
   * Check if a session is under human control.
   */
  isHumanControlled(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    return state?.status === "human";
  }

  /**
   * Get takeover state for a session.
   */
  getState(sessionId: string): TakeoverState | null {
    return this.sessions.get(sessionId) ?? null;
  }
}
