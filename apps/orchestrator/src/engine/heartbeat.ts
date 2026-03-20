/**
 * Phase 20.3: Heartbeat Protocol.
 *
 * Agents send heartbeats every 10 seconds during execution.
 * The monitor detects stale agents that miss 3+ heartbeats.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:heartbeat");

/** Expected heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL_MS = 10_000;

/** Number of missed heartbeats before an agent is considered stale */
const STALE_THRESHOLD = 3;

interface RegisteredAgent {
  agentRole: string;
  heartbeatCount: number;
  lastHeartbeat: number;
  registeredAt: number;
  sessionId: string;
}

export type StaleCallback = (
  sessionId: string,
  agentRole: string,
  missedHeartbeats: number
) => void;

export class HeartbeatMonitor {
  private readonly agents = new Map<string, RegisteredAgent>();
  private readonly staleCallbacks: StaleCallback[] = [];
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Register an agent and start expecting heartbeats.
   */
  registerAgent(sessionId: string, agentRole: string): void {
    const now = Date.now();

    this.agents.set(sessionId, {
      sessionId,
      agentRole,
      registeredAt: now,
      lastHeartbeat: now,
      heartbeatCount: 0,
    });

    // Start periodic checking if not already running
    if (!this.checkInterval) {
      this.startChecking();
    }

    logger.debug(
      { sessionId, agentRole },
      "Agent registered for heartbeat monitoring"
    );
  }

  /**
   * Record a heartbeat from an agent, resetting its timeout.
   */
  recordHeartbeat(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (!agent) {
      return;
    }

    agent.lastHeartbeat = Date.now();
    agent.heartbeatCount++;
  }

  /**
   * Get all agents that have missed 3+ heartbeats.
   */
  getStaleAgents(): Array<{
    sessionId: string;
    agentRole: string;
    missedHeartbeats: number;
    lastHeartbeatAge: number;
  }> {
    const now = Date.now();
    const stale: Array<{
      sessionId: string;
      agentRole: string;
      missedHeartbeats: number;
      lastHeartbeatAge: number;
    }> = [];

    for (const agent of this.agents.values()) {
      const age = now - agent.lastHeartbeat;
      const missed = Math.floor(age / HEARTBEAT_INTERVAL_MS);

      if (missed >= STALE_THRESHOLD) {
        stale.push({
          sessionId: agent.sessionId,
          agentRole: agent.agentRole,
          missedHeartbeats: missed,
          lastHeartbeatAge: age,
        });
      }
    }

    return stale;
  }

  /**
   * Register a callback that fires when an agent goes stale.
   */
  onStale(callback: StaleCallback): void {
    this.staleCallbacks.push(callback);
  }

  /**
   * Unregister an agent (e.g., when execution completes).
   */
  unregisterAgent(sessionId: string): void {
    this.agents.delete(sessionId);

    // Stop checking if no agents remain
    if (this.agents.size === 0 && this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.debug({ sessionId }, "Agent unregistered from heartbeat monitoring");
  }

  /**
   * Stop all monitoring and clean up.
   */
  shutdown(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.agents.clear();
    this.staleCallbacks.length = 0;
  }

  private startChecking(): void {
    this.checkInterval = setInterval(() => {
      this.checkForStaleAgents();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private checkForStaleAgents(): void {
    const staleAgents = this.getStaleAgents();

    for (const stale of staleAgents) {
      logger.warn(
        {
          sessionId: stale.sessionId,
          agentRole: stale.agentRole,
          missedHeartbeats: stale.missedHeartbeats,
        },
        "Stale agent detected"
      );

      for (const callback of this.staleCallbacks) {
        try {
          callback(stale.sessionId, stale.agentRole, stale.missedHeartbeats);
        } catch (err) {
          logger.error({ error: err }, "Stale callback error");
        }
      }
    }
  }
}
