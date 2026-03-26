/**
 * Phase 20.1: Health Watchdog.
 *
 * Monitors agent execution for stuck states, infinite loops, stale progress,
 * and context bloat. Reports recovery actions when agents stop making progress.
 * Integrates with session heartbeats for cross-process stale detection.
 *
 * Enhanced with:
 * - Stale heartbeat detection (>120s without heartbeat)
 * - Spinning detection (same tool called >5 times with identical args)
 * - Context bloat detection (tokens > 80% of model context limit)
 * - Error rate monitoring (>50% of recent tool calls failing)
 * - Credit burn rate monitoring (>2x expected)
 * - Warning events emitted before taking action
 * - Audit logging for all watchdog actions
 */
import { createLogger } from "@prometheus/logger";
import { CheckpointStateManager } from "../checkpoint-manager";
import { SessionHeartbeat } from "../session-heartbeat";

const logger = createLogger("orchestrator:health-watchdog");

/** Time in ms with no progress before agent is considered stuck */
const STUCK_TIMEOUT_MS = 60_000;

/** Time in ms without heartbeat before session is considered stale */
const STALE_HEARTBEAT_TIMEOUT_MS = 120_000;

/** Number of repeated identical tool calls to detect an infinite loop */
const LOOP_DETECTION_THRESHOLD = 5;

/** Percentage of model context used before context bloat warning */
const CONTEXT_BLOAT_THRESHOLD = 0.8;

/** Default model context limit in tokens */
const DEFAULT_MODEL_CONTEXT_LIMIT = 200_000;

/** Error rate threshold (percentage of recent tool calls failing) */
const ERROR_RATE_THRESHOLD = 0.5;

/** Number of recent tool calls to check for error rate */
const ERROR_RATE_WINDOW = 10;

/** Credit burn rate multiplier threshold */
const CREDIT_BURN_RATE_THRESHOLD = 2.0;

/** Default monitoring interval in ms */
const MONITOR_INTERVAL_MS = 30_000;

export type RecoveryAction =
  | "continue"
  | "reset"
  | "escalate"
  | "abort"
  | "checkpoint_restore"
  | "compress_context"
  | "pause_and_notify"
  | "switch_cheaper_model";

export interface ProgressEvent {
  details: Record<string, unknown>;
  timestamp: number;
  type: "tool_call" | "text_output";
}

export type WatchdogEventType =
  | "warning_stale_heartbeat"
  | "warning_spinning"
  | "warning_context_bloat"
  | "warning_high_error_rate"
  | "warning_credit_burn_rate"
  | "action_checkpoint_restore"
  | "action_break_loop"
  | "action_compress_context"
  | "action_pause_notify"
  | "action_switch_model";

export interface WatchdogEvent {
  data?: Record<string, unknown>;
  message: string;
  sessionId: string;
  timestamp: number;
  type: WatchdogEventType;
}

export type WatchdogEventListener = (event: WatchdogEvent) => void;

interface MonitoredSession {
  /** Total credits consumed so far */
  creditsConsumed: number;
  events: ProgressEvent[];
  /** Expected credits per minute */
  expectedCreditsPerMinute: number;
  lastHeartbeatAt: number;
  lastProgressAt: number;
  modelContextLimit: number;
  /** Monitoring interval timer */
  monitorTimer?: ReturnType<typeof setInterval>;
  orgId: string;
  /** Track recent tool call success/failure */
  recentToolResults: boolean[];
  /** Tracks consecutive identical tool calls */
  recentToolSignatures: string[];
  sessionId: string;
  startedAt: number;
  tokensConsumed: number;
}

export class HealthWatchdog {
  private readonly sessions = new Map<string, MonitoredSession>();
  private readonly eventListeners: WatchdogEventListener[] = [];
  private readonly auditLog: WatchdogEvent[] = [];

  /**
   * Register an event listener for watchdog events.
   */
  onEvent(listener: WatchdogEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * Get the audit log of all watchdog actions.
   */
  getAuditLog(): WatchdogEvent[] {
    return [...this.auditLog];
  }

  /**
   * Begin monitoring an agent session.
   */
  monitor(
    sessionId: string,
    opts?: {
      orgId?: string;
      modelContextLimit?: number;
      expectedCreditsPerMinute?: number;
    }
  ): void {
    // Stop existing monitoring if present
    this.stop(sessionId);

    const now = Date.now();

    const session: MonitoredSession = {
      sessionId,
      orgId: opts?.orgId ?? "",
      startedAt: now,
      lastProgressAt: now,
      lastHeartbeatAt: now,
      events: [],
      recentToolSignatures: [],
      recentToolResults: [],
      tokensConsumed: 0,
      modelContextLimit: opts?.modelContextLimit ?? DEFAULT_MODEL_CONTEXT_LIMIT,
      expectedCreditsPerMinute: opts?.expectedCreditsPerMinute ?? 0.5,
      creditsConsumed: 0,
    };

    // Set up periodic monitoring
    session.monitorTimer = setInterval(() => {
      this.runMonitoringChecks(sessionId);
    }, MONITOR_INTERVAL_MS);

    this.sessions.set(sessionId, session);
    logger.debug({ sessionId }, "Health watchdog monitoring started");
  }

  /**
   * Backward-compatible alias for monitor().
   */
  startMonitoring(
    sessionId: string,
    opts?: { orgId?: string; modelContextLimit?: number }
  ): void {
    this.monitor(sessionId, opts);
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
    session.lastHeartbeatAt = now;

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

      // Track tool call success/failure
      const success = details.success !== false;
      session.recentToolResults.push(success);
      if (session.recentToolResults.length > ERROR_RATE_WINDOW * 2) {
        session.recentToolResults = session.recentToolResults.slice(
          -ERROR_RATE_WINDOW * 2
        );
      }
    }

    // Update token count if provided
    if (typeof details.tokensUsed === "number") {
      session.tokensConsumed += details.tokensUsed;
    }

    // Update credits if provided
    if (typeof details.creditsConsumed === "number") {
      session.creditsConsumed += details.creditsConsumed;
    }

    // Trim event history to prevent unbounded growth
    if (session.events.length > 200) {
      session.events = session.events.slice(-200);
    }
  }

  /**
   * Report a heartbeat for a session (keeps it alive).
   */
  reportHeartbeat(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastHeartbeatAt = Date.now();
    }
  }

  /**
   * Update the total credits consumed for a session.
   */
  updateCredits(sessionId: string, creditsConsumed: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.creditsConsumed = creditsConsumed;
    }
  }

  /**
   * Run all monitoring checks for a session and emit events.
   */
  private runMonitoringChecks(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const now = Date.now();

    // Check stale heartbeat (>120s without heartbeat)
    const timeSinceHeartbeat = now - session.lastHeartbeatAt;
    if (timeSinceHeartbeat > STALE_HEARTBEAT_TIMEOUT_MS) {
      this.emitEvent({
        sessionId,
        type: "warning_stale_heartbeat",
        message: `No heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`,
        data: { timeSinceHeartbeat },
        timestamp: now,
      });
      // Attempt checkpoint restore
      this.emitEvent({
        sessionId,
        type: "action_checkpoint_restore",
        message: "Attempting checkpoint restore due to stale heartbeat",
        timestamp: now,
      });
      if (session.orgId) {
        this.attemptCheckpointRecovery(sessionId, session.orgId).catch(
          (err) => {
            logger.error(
              { sessionId, error: String(err) },
              "Checkpoint recovery failed during stale heartbeat handling"
            );
          }
        );
      }
    }

    // Check for spinning (same tool called >5 times with identical args)
    if (this.detectLoop(session)) {
      this.emitEvent({
        sessionId,
        type: "warning_spinning",
        message: "Agent is spinning - repeated identical tool calls detected",
        data: {
          recentSignatures: session.recentToolSignatures.slice(-5),
        },
        timestamp: now,
      });
      // Break the loop and re-plan
      this.emitEvent({
        sessionId,
        type: "action_break_loop",
        message: "Breaking loop and requesting re-plan",
        timestamp: now,
      });
      // Clear signatures to allow progress after intervention
      session.recentToolSignatures = [];
    }

    // Check for context bloat (tokens > 80% of model context limit)
    if (this.hasContextBloat(sessionId)) {
      this.emitEvent({
        sessionId,
        type: "warning_context_bloat",
        message: `Context usage at ${Math.round((session.tokensConsumed / session.modelContextLimit) * 100)}% of limit`,
        data: {
          tokensConsumed: session.tokensConsumed,
          limit: session.modelContextLimit,
        },
        timestamp: now,
      });
      this.emitEvent({
        sessionId,
        type: "action_compress_context",
        message: "Triggering context compression",
        timestamp: now,
      });
    }

    // Check error rate (>50% of recent tool calls failing)
    if (this.hasHighErrorRate(session)) {
      const recentResults = session.recentToolResults.slice(-ERROR_RATE_WINDOW);
      const failCount = recentResults.filter((r) => !r).length;
      this.emitEvent({
        sessionId,
        type: "warning_high_error_rate",
        message: `High error rate: ${failCount}/${recentResults.length} recent tool calls failed`,
        data: { failCount, total: recentResults.length },
        timestamp: now,
      });
      this.emitEvent({
        sessionId,
        type: "action_pause_notify",
        message: "Pausing session due to high error rate",
        timestamp: now,
      });
    }

    // Check credit burn rate (>2x expected)
    if (this.hasHighCreditBurnRate(session)) {
      const runtimeMinutes = (now - session.startedAt) / 60_000;
      const actualRate =
        runtimeMinutes > 0 ? session.creditsConsumed / runtimeMinutes : 0;
      this.emitEvent({
        sessionId,
        type: "warning_credit_burn_rate",
        message: `Credit burn rate ${actualRate.toFixed(2)}/min exceeds ${CREDIT_BURN_RATE_THRESHOLD}x expected rate`,
        data: {
          actualRate,
          expectedRate: session.expectedCreditsPerMinute,
          threshold: CREDIT_BURN_RATE_THRESHOLD,
        },
        timestamp: now,
      });
      this.emitEvent({
        sessionId,
        type: "action_switch_model",
        message: "Switching to cheaper model due to high credit burn rate",
        timestamp: now,
      });
    }
  }

  /**
   * Emit a watchdog event to all listeners and record in audit log.
   */
  private emitEvent(event: WatchdogEvent): void {
    this.auditLog.push(event);
    // Trim audit log to prevent unbounded growth
    if (this.auditLog.length > 1000) {
      this.auditLog.splice(0, this.auditLog.length - 1000);
    }

    logger.info(
      {
        sessionId: event.sessionId,
        watchdogEvent: event.type,
        message: event.message,
      },
      "Watchdog event"
    );

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ error: String(err) }, "Watchdog event listener error");
      }
    }
  }

  /**
   * Check if the error rate is above threshold.
   */
  private hasHighErrorRate(session: MonitoredSession): boolean {
    const recentResults = session.recentToolResults.slice(-ERROR_RATE_WINDOW);
    if (recentResults.length < ERROR_RATE_WINDOW) {
      return false;
    }
    const failCount = recentResults.filter((r) => !r).length;
    return failCount / recentResults.length > ERROR_RATE_THRESHOLD;
  }

  /**
   * Check if the credit burn rate is above threshold.
   */
  private hasHighCreditBurnRate(session: MonitoredSession): boolean {
    if (session.expectedCreditsPerMinute <= 0) {
      return false;
    }
    const runtimeMinutes = (Date.now() - session.startedAt) / 60_000;
    if (runtimeMinutes < 1) {
      return false; // Wait at least 1 minute before checking
    }
    const actualRate = session.creditsConsumed / runtimeMinutes;
    return (
      actualRate > session.expectedCreditsPerMinute * CREDIT_BURN_RATE_THRESHOLD
    );
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
   * Detect if the agent is spinning -- same tool called >5 times with same args.
   */
  isSpinning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    return this.detectLoop(session);
  }

  /**
   * Detect if context bloat is occurring (tokens > 80% of model limit).
   */
  hasContextBloat(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    return (
      session.tokensConsumed >
      session.modelContextLimit * CONTEXT_BLOAT_THRESHOLD
    );
  }

  /**
   * Update the total tokens consumed for a session.
   */
  updateTokenCount(sessionId: string, tokensConsumed: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.tokensConsumed = tokensConsumed;
    }
  }

  /**
   * Check if a session heartbeat is stale (no heartbeat in Redis).
   */
  async isHeartbeatStale(sessionId: string): Promise<boolean> {
    return !(await SessionHeartbeat.isAlive(sessionId));
  }

  /**
   * Attempt recovery from the last checkpoint for a stale session.
   * Returns true if recovery was initiated, false if it failed.
   */
  async attemptCheckpointRecovery(
    sessionId: string,
    orgId: string
  ): Promise<boolean> {
    try {
      const manager = new CheckpointStateManager(orgId);
      const checkpoint = await manager.restoreCheckpoint(sessionId);

      if (!checkpoint) {
        logger.warn({ sessionId }, "No checkpoint available for recovery");
        return false;
      }

      logger.info(
        {
          sessionId,
          checkpointId: checkpoint.id,
          iteration: checkpoint.iteration,
        },
        "Checkpoint found for recovery"
      );

      return true;
    } catch (error) {
      logger.error(
        { sessionId, error: String(error) },
        "Checkpoint recovery failed"
      );
      return false;
    }
  }

  /**
   * Determine the best recovery action for a stuck agent.
   */
  getRecoveryAction(sessionId: string): RecoveryAction {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return "continue";
    }

    const now = Date.now();
    const timeSinceProgress = now - session.lastProgressAt;
    const isLooping = this.detectLoop(session);
    const totalRuntime = now - session.startedAt;
    const hasBloat = this.hasContextBloat(sessionId);
    const hasHighErrors = this.hasHighErrorRate(session);
    const hasHighBurn = this.hasHighCreditBurnRate(session);

    // Agent has been running too long overall - abort
    if (totalRuntime > 10 * 60 * 1000) {
      logger.warn(
        { sessionId, totalRuntime },
        "Agent exceeded maximum runtime, recommending abort"
      );
      return "abort";
    }

    // High error rate - pause and notify
    if (hasHighErrors) {
      logger.warn(
        { sessionId },
        "High error rate detected, recommending pause and notify"
      );
      return "pause_and_notify";
    }

    // Credit burn rate too high - switch to cheaper model
    if (hasHighBurn) {
      logger.warn(
        { sessionId },
        "High credit burn rate, recommending cheaper model"
      );
      return "switch_cheaper_model";
    }

    // Context bloat - compress context
    if (hasBloat) {
      logger.warn(
        {
          sessionId,
          tokensConsumed: session.tokensConsumed,
          limit: session.modelContextLimit,
        },
        "Context bloat detected, recommending context compression"
      );
      return "compress_context";
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
   * Monitor all tracked sessions for stale heartbeats and attempt recovery.
   * This should be called periodically (e.g., every 60 seconds).
   */
  async monitorStaleHeartbeats(): Promise<void> {
    for (const [sessionId, session] of this.sessions) {
      try {
        const stale = await this.isHeartbeatStale(sessionId);
        if (!stale) {
          continue;
        }

        logger.warn({ sessionId }, "Stale session heartbeat detected");

        if (session.orgId) {
          const recovered = await this.attemptCheckpointRecovery(
            sessionId,
            session.orgId
          );

          if (!recovered) {
            logger.error(
              { sessionId },
              "Session recovery failed, marking as failed"
            );
            // The caller should handle marking the session as failed
          }
        }
      } catch (error) {
        logger.error(
          { sessionId, error: String(error) },
          "Error monitoring stale heartbeat"
        );
      }
    }
  }

  /**
   * Stop monitoring a session and clean up.
   */
  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.monitorTimer) {
      clearInterval(session.monitorTimer);
    }
    this.sessions.delete(sessionId);
    logger.debug({ sessionId }, "Health watchdog monitoring stopped");
  }

  /**
   * Backward-compatible alias for stop().
   */
  stopMonitoring(sessionId: string): void {
    this.stop(sessionId);
  }

  /**
   * Get monitoring status for a session.
   */
  getStatus(sessionId: string): {
    contextBloat: boolean;
    eventCount: number;
    isLooping: boolean;
    monitoring: boolean;
    timeSinceProgress: number;
    tokensConsumed: number;
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
      contextBloat: this.hasContextBloat(sessionId),
      tokensConsumed: session.tokensConsumed,
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
