/**
 * AgentLifecycleManager — Manages agent lifecycle operations including
 * killing stuck workers and reassigning failed subtasks.
 *
 * Timeout detection: kills workers stuck >10 minutes on a single step.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:fleet:agent-lifecycle");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentState {
  /** Current task the agent is working on */
  currentTaskId: string | null;
  /** Unique agent identifier */
  id: string;
  /** When the last step was started */
  lastStepStartedAt: Date | null;
  /** Agent role */
  role: string;
  /** Session this agent belongs to */
  sessionId: string;
  /** When the agent was spawned */
  startedAt: Date;
  /** Current status */
  status: "idle" | "working" | "stuck" | "terminated";
  /** Number of completed steps */
  stepsCompleted: number;
}

export interface KillResult {
  /** ID of the killed agent */
  agentId: string;
  /** When the agent was killed */
  killedAt: Date;
  /** Why the agent was killed */
  reason: string;
  /** Whether the kill was successful */
  success: boolean;
}

export interface ReassignResult {
  /** ID of the original agent */
  fromAgentId: string;
  /** ID of the new agent */
  newAgentId: string;
  /** Whether the reassignment was successful */
  success: boolean;
  /** Reassigned task ID */
  taskId: string;
  /** Role the task was reassigned to */
  toRole: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Kill workers stuck for more than 10 minutes on a single step. */
const STUCK_TIMEOUT_MS = 10 * 60 * 1000;

/** Check interval for stuck agent detection. */
const CHECK_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// AgentLifecycleManager
// ---------------------------------------------------------------------------

export class AgentLifecycleManager {
  private readonly sessionId: string;
  private readonly agents = new Map<string, AgentState>();
  private checkTimer: NodeJS.Timeout | null = null;
  private readonly onAgentKilled: ((result: KillResult) => void) | null;

  constructor(sessionId: string, onAgentKilled?: (result: KillResult) => void) {
    this.sessionId = sessionId;
    this.onAgentKilled = onAgentKilled ?? null;
  }

  /**
   * Register an agent with the lifecycle manager.
   */
  registerAgent(agentId: string, role: string): void {
    const state: AgentState = {
      id: agentId,
      role,
      sessionId: this.sessionId,
      status: "idle",
      currentTaskId: null,
      stepsCompleted: 0,
      startedAt: new Date(),
      lastStepStartedAt: null,
    };

    this.agents.set(agentId, state);

    logger.debug(
      { agentId, role, sessionId: this.sessionId },
      "Agent registered with lifecycle manager"
    );
  }

  /**
   * Mark an agent as working on a task.
   */
  startTask(agentId: string, taskId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = "working";
      agent.currentTaskId = taskId;
      agent.lastStepStartedAt = new Date();
    }
  }

  /**
   * Record that an agent completed a step.
   */
  recordStep(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.stepsCompleted++;
      agent.lastStepStartedAt = new Date();
    }
  }

  /**
   * Kill a stuck or misbehaving agent.
   */
  killAgent(agentId: string, reason: string): KillResult {
    const agent = this.agents.get(agentId);

    if (!agent) {
      logger.warn({ agentId }, "Cannot kill unknown agent");
      return {
        agentId,
        success: false,
        reason: "Agent not found",
        killedAt: new Date(),
      };
    }

    // Update agent state
    agent.status = "terminated";

    const result: KillResult = {
      agentId,
      success: true,
      reason,
      killedAt: new Date(),
    };

    logger.warn(
      {
        agentId,
        role: agent.role,
        reason,
        stepsCompleted: agent.stepsCompleted,
        taskId: agent.currentTaskId,
      },
      "Agent killed"
    );

    // Notify callback
    if (this.onAgentKilled) {
      this.onAgentKilled(result);
    }

    return result;
  }

  /**
   * Reassign a task from one agent to another role.
   */
  reassignTask(
    taskId: string,
    fromAgentId: string,
    toRole: string
  ): ReassignResult {
    const fromAgent = this.agents.get(fromAgentId);

    if (!fromAgent) {
      return {
        taskId,
        fromAgentId,
        toRole,
        newAgentId: "",
        success: false,
      };
    }

    // Kill the original agent if still working
    if (fromAgent.status === "working") {
      this.killAgent(fromAgentId, `Reassigning task ${taskId} to ${toRole}`);
    }

    // Create a new agent ID for the reassignment
    const newAgentId = generateId("agent");

    // Register the new agent
    this.registerAgent(newAgentId, toRole);
    this.startTask(newAgentId, taskId);

    logger.info(
      {
        taskId,
        fromAgentId,
        fromRole: fromAgent.role,
        toRole,
        newAgentId,
      },
      "Task reassigned to new agent"
    );

    return {
      taskId,
      fromAgentId,
      toRole,
      newAgentId,
      success: true,
    };
  }

  /**
   * Start monitoring for stuck agents.
   */
  startMonitoring(): void {
    if (this.checkTimer) {
      return;
    }

    this.checkTimer = setInterval(() => {
      this.detectStuckAgents();
    }, CHECK_INTERVAL_MS);

    logger.info(
      { sessionId: this.sessionId, intervalMs: CHECK_INTERVAL_MS },
      "Agent lifecycle monitoring started"
    );
  }

  /**
   * Stop monitoring.
   */
  stopMonitoring(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Get all registered agents and their states.
   */
  getAgentStates(): AgentState[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents that appear stuck.
   */
  getStuckAgents(): AgentState[] {
    const now = Date.now();
    return Array.from(this.agents.values()).filter(
      (agent) =>
        agent.status === "working" &&
        agent.lastStepStartedAt &&
        now - agent.lastStepStartedAt.getTime() > STUCK_TIMEOUT_MS
    );
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this.stopMonitoring();
    this.agents.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Detect and handle stuck agents (those exceeding the step timeout).
   */
  private detectStuckAgents(): void {
    const stuckAgents = this.getStuckAgents();

    for (const agent of stuckAgents) {
      agent.status = "stuck";

      const stuckDuration = agent.lastStepStartedAt
        ? Date.now() - agent.lastStepStartedAt.getTime()
        : 0;

      logger.warn(
        {
          agentId: agent.id,
          role: agent.role,
          taskId: agent.currentTaskId,
          stuckForMs: stuckDuration,
          stepsCompleted: agent.stepsCompleted,
        },
        "Stuck agent detected"
      );

      // Auto-kill stuck agents
      this.killAgent(
        agent.id,
        `Stuck for ${Math.round(stuckDuration / 1000)}s on step ${agent.stepsCompleted + 1}`
      );
    }
  }
}
