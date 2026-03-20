/**
 * SpawnManager — Processes dynamic agent spawn requests from running agents.
 *
 * When an agent emits spawnRequests in its AgentExecutionResult, the
 * SpawnManager validates the request, allocates resources, and starts
 * the new worker.
 */
import { AGENT_ROLES } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:fleet:spawn-manager");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnRequest {
  /** Other task IDs this spawn depends on */
  dependencies: string[];
  /** Execution priority (lower = higher) */
  priority: number;
  /** Agent role to spawn */
  role: string;
  /** Task description for the spawned agent */
  task: string;
}

export interface SpawnedAgent {
  /** Dependencies that must complete before execution */
  dependencies: string[];
  /** Unique ID for the spawned agent */
  id: string;
  /** Priority for scheduling */
  priority: number;
  /** Agent role */
  role: string;
  /** Session this agent belongs to */
  sessionId: string;
  /** Spawned agent status */
  status: "queued" | "running" | "completed" | "failed";
  /** Task description */
  task: string;
}

export interface SpawnManagerConfig {
  /** Maximum number of agents that can be spawned per session */
  maxSpawnsPerSession: number;
  /** Organization ID for resource tracking */
  orgId: string;
  /** Session ID for scoping */
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SPAWNS = 20;

// ---------------------------------------------------------------------------
// SpawnManager
// ---------------------------------------------------------------------------

export class SpawnManager {
  private readonly config: SpawnManagerConfig;
  private readonly spawnedAgents = new Map<string, SpawnedAgent>();

  constructor(
    config: Partial<SpawnManagerConfig> & { sessionId: string; orgId: string }
  ) {
    this.config = {
      maxSpawnsPerSession: config.maxSpawnsPerSession ?? DEFAULT_MAX_SPAWNS,
      orgId: config.orgId,
      sessionId: config.sessionId,
    };
  }

  /**
   * Process a batch of spawn requests from an agent execution result.
   * Validates each request, allocates resources, and queues them for execution.
   */
  processSpawnRequests(requests: SpawnRequest[]): SpawnedAgent[] {
    const spawned: SpawnedAgent[] = [];

    for (const request of requests) {
      // Validate the request
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        logger.warn(
          {
            role: request.role,
            reason: validation.reason,
            sessionId: this.config.sessionId,
          },
          "Spawn request rejected"
        );
        continue;
      }

      // Check spawn limit
      if (this.spawnedAgents.size >= this.config.maxSpawnsPerSession) {
        logger.warn(
          {
            current: this.spawnedAgents.size,
            max: this.config.maxSpawnsPerSession,
            sessionId: this.config.sessionId,
          },
          "Spawn limit reached, rejecting request"
        );
        break;
      }

      // Create the spawned agent
      const agentId = generateId("spawn");
      const agent: SpawnedAgent = {
        id: agentId,
        role: request.role,
        task: request.task,
        dependencies: request.dependencies,
        priority: request.priority,
        sessionId: this.config.sessionId,
        status: "queued",
      };

      this.spawnedAgents.set(agentId, agent);
      spawned.push(agent);

      logger.info(
        {
          agentId,
          role: request.role,
          priority: request.priority,
          dependencies: request.dependencies.length,
          sessionId: this.config.sessionId,
        },
        "Agent spawn queued"
      );
    }

    return spawned;
  }

  /**
   * Update the status of a spawned agent.
   */
  updateStatus(agentId: string, status: SpawnedAgent["status"]): void {
    const agent = this.spawnedAgents.get(agentId);
    if (agent) {
      agent.status = status;
      logger.debug(
        { agentId, role: agent.role, status },
        "Spawned agent status updated"
      );
    }
  }

  /**
   * Get all spawned agents for this session.
   */
  getSpawnedAgents(): SpawnedAgent[] {
    return Array.from(this.spawnedAgents.values());
  }

  /**
   * Get agents that are ready to execute (all dependencies met).
   */
  getReadyAgents(completedTaskIds: Set<string>): SpawnedAgent[] {
    return Array.from(this.spawnedAgents.values())
      .filter(
        (agent) =>
          agent.status === "queued" &&
          agent.dependencies.every((dep) => completedTaskIds.has(dep))
      )
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get spawn statistics.
   */
  getStats(): {
    completed: number;
    failed: number;
    queued: number;
    running: number;
    total: number;
  } {
    const agents = Array.from(this.spawnedAgents.values());
    return {
      total: agents.length,
      queued: agents.filter((a) => a.status === "queued").length,
      running: agents.filter((a) => a.status === "running").length,
      completed: agents.filter((a) => a.status === "completed").length,
      failed: agents.filter((a) => a.status === "failed").length,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateRequest(request: SpawnRequest): {
    valid: boolean;
    reason?: string;
  } {
    // Validate role exists
    if (!AGENT_ROLES[request.role]) {
      return {
        valid: false,
        reason: `Unknown agent role: ${request.role}`,
      };
    }

    // Validate task description
    if (!request.task || request.task.trim().length === 0) {
      return {
        valid: false,
        reason: "Task description is required",
      };
    }

    // Validate priority range
    if (request.priority < 0 || request.priority > 100) {
      return {
        valid: false,
        reason: `Invalid priority: ${request.priority} (must be 0-100)`,
      };
    }

    return { valid: true };
  }
}
