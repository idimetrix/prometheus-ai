/**
 * Phase 20.1: Health Watchdog.
 *
 * Monitors agent execution for stuck states, infinite loops, and stale progress.
 * Reports recovery actions when agents stop making progress.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:health-watchdog");

/** Time in ms with no progress before agent is considered stuck */
const STUCK_TIMEOUT_MS = 60_000;

/** Number of repeated identical tool calls to detect an infinite loop */
const LOOP_DETECTION_THRESHOLD = 5;

export type RecoveryAction = "continue" | "reset" | "escalate" | "abort";

export interface ProgressEvent {
  details: Record<string, unknown>;
  timestamp: number;
  type: "tool_call" | "text_output";
}

interface MonitoredSession {
  events: ProgressEvent[];
  lastProgressAt: number;
  /** Tracks consecutive identical tool calls */
  recentToolSignatures: string[];
  sessionId: string;
  startedAt: number;
}

export class HealthWatchdog {
  private readonly sessions = new Map<string, MonitoredSession>();

  /**
   * Begin monitoring an agent session.
   */
  startMonitoring(sessionId: string): void {
    const now = Date.now();

    this.sessions.set(sessionId, {
      sessionId,
      startedAt: now,
      lastProgressAt: now,
      events: [],
      recentToolSignatures: [],
    });

    logger.debug({ sessionId }, "Health watchdog monitoring started");
  }

  /**
   * Report a progress event from the agent. Resets the stuck timer.
   */
  reportProgress(
    sessionId: string,
    type: "tool_call" | "text_output",
    details: Record<string, unknown>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const now = Date.now();
    session.lastProgressAt = now;

    const event: ProgressEvent = { type, details, timestamp: now };
    session.events.push(event);

    // Track tool call signatures for loop detection
    if (type === "tool_call") {
      const signature = JSON.stringify({
        tool: details.tool,
        args: details.args,
      });
      session.recentToolSignatures.push(signature);

      // Keep only the last N signatures for loop detection
      if (session.recentToolSignatures.length > LOOP_DETECTION_THRESHOLD * 2) {
        session.recentToolSignatures = session.recentToolSignatures.slice(
          -LOOP_DETECTION_THRESHOLD * 2
        );
      }
    }

    // Trim event history to prevent unbounded growth
    if (session.events.length > 200) {
      session.events = session.events.slice(-200);
    }
  }

  /**
   * Check if the agent is stuck (no progress or in an infinite loop).
   */
  isStuck(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Check for stale state (no progress for STUCK_TIMEOUT_MS)
    const timeSinceProgress = Date.now() - session.lastProgressAt;
    if (timeSinceProgress >= STUCK_TIMEOUT_MS) {
      return true;
    }

    // Check for infinite loop
    return this.detectLoop(session);
  }

  /**
   * Determine the best recovery action for a stuck agent.
   */
  getRecoveryAction(sessionId: string): RecoveryAction {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return "continue";
    }

    const timeSinceProgress = Date.now() - session.lastProgressAt;
    const isLooping = this.detectLoop(session);
    const totalRuntime = Date.now() - session.startedAt;

    // Agent has been running too long overall - abort
    if (totalRuntime > 10 * 60 * 1000) {
      logger.warn(
        { sessionId, totalRuntime },
        "Agent exceeded maximum runtime, recommending abort"
      );
      return "abort";
    }

    // Infinite loop detected - reset context
    if (isLooping) {
      logger.warn(
        { sessionId, recentSignatures: session.recentToolSignatures.length },
        "Infinite loop detected, recommending reset"
      );
      return "reset";
    }

    // Long stale period - escalate to human or stronger model
    if (timeSinceProgress >= STUCK_TIMEOUT_MS * 2) {
      logger.warn(
        { sessionId, timeSinceProgress },
        "Extended stale period, recommending escalate"
      );
      return "escalate";
    }

    // Short stale period - reset
    if (timeSinceProgress >= STUCK_TIMEOUT_MS) {
      return "reset";
    }

    return "continue";
  }

  /**
   * Stop monitoring a session and clean up.
   */
  stopMonitoring(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.debug({ sessionId }, "Health watchdog monitoring stopped");
  }

  /**
   * Get monitoring status for a session.
   */
  getStatus(sessionId: string): {
    monitoring: boolean;
    timeSinceProgress: number;
    eventCount: number;
    isLooping: boolean;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      monitoring: true,
      timeSinceProgress: Date.now() - session.lastProgressAt,
      eventCount: session.events.length,
      isLooping: this.detectLoop(session),
    };
  }

  private detectLoop(session: MonitoredSession): boolean {
    const sigs = session.recentToolSignatures;
    if (sigs.length < LOOP_DETECTION_THRESHOLD) {
      return false;
    }

    // Check if the last N tool calls are identical
    const lastN = sigs.slice(-LOOP_DETECTION_THRESHOLD);
    const first = lastN[0];
    return lastN.every((sig) => sig === first);
  }
}
