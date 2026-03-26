import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { AgentLoop } from "./agent-loop";
import { AgentLifecycleManager } from "./fleet/agent-lifecycle";
import { SwarmCoordinator, type SwarmTask } from "./fleet/swarm-coordinator";
import { ParallelScheduler, type SchedulableTask } from "./parallel/scheduler";

const logger = createLogger("orchestrator:fleet");

/** Max parallel agents per plan tier. */
const TIER_LIMITS: Record<string, number> = {
  hobby: 1,
  starter: 2,
  pro: 5,
  team: 10,
  studio: 25,
  enterprise: 50,
};

/** Map effort size to numeric priority. */
function effortToPriority(effort: string): number {
  if (effort === "XL") {
    return 3;
  }
  if (effort === "L") {
    return 2;
  }
  return 1;
}

export interface FleetAgent {
  completedAt: Date | null;
  id: string;
  loop: AgentLoop;
  result: AgentExecutionResult | null;
  role: string;
  startedAt: Date | null;
  status: "queued" | "running" | "completed" | "failed" | "paused";
  taskId: string;
}

export interface FleetStatus {
  agents: Array<{
    id: string;
    taskId: string;
    role: string;
    status: string;
    creditsConsumed: number;
  }>;
  completed: number;
  failed: number;
  queued: number;
  running: number;
  sessionId: string;
  totalAgents: number;
  totalCreditsConsumed: number;
}

/**
 * FleetManager coordinates multiple agents working in parallel on different tasks.
 * It manages agent lifecycles, enforces parallelism limits per plan tier,
 * and handles coordination between agents.
 */
export class FleetManager {
  private readonly sessionId: string;
  private readonly projectId: string;
  private readonly orgId: string;
  private readonly userId: string;
  private readonly planTier: string;
  private readonly agents = new Map<string, FleetAgent>();
  private readonly eventPublisher: EventPublisher;
  private readonly scheduler = new ParallelScheduler();
  private readonly lifecycleManager: AgentLifecycleManager;
  private readonly swarmCoordinator: SwarmCoordinator;

  constructor(params: {
    sessionId: string;
    projectId: string;
    orgId: string;
    userId: string;
    planTier: string;
  }) {
    this.sessionId = params.sessionId;
    this.projectId = params.projectId;
    this.orgId = params.orgId;
    this.userId = params.userId;
    this.planTier = params.planTier;
    this.eventPublisher = new EventPublisher();

    // Initialize lifecycle manager for stuck-agent detection and kill/reassign
    this.lifecycleManager = new AgentLifecycleManager(
      params.sessionId,
      (killResult) => {
        logger.warn(
          { agentId: killResult.agentId, reason: killResult.reason },
          "Fleet agent killed by lifecycle manager"
        );
      }
    );
    this.lifecycleManager.startMonitoring();

    // Initialize swarm coordinator for dependency-aware task scheduling
    const maxParallel = TIER_LIMITS[params.planTier] ?? 1;
    this.swarmCoordinator = new SwarmCoordinator({
      sessionId: params.sessionId,
      maxConcurrency: maxParallel,
    });
  }

  /**
   * Execute a set of tasks in parallel, respecting dependencies and tier limits.
   */
  async executeTasks(
    tasks: SchedulableTask[],
    blueprint: string
  ): Promise<AgentExecutionResult[]> {
    const maxParallel = TIER_LIMITS[this.planTier] ?? 1;
    const schedule = this.scheduler.schedule(tasks);
    const results: AgentExecutionResult[] = [];

    logger.info(
      {
        sessionId: this.sessionId,
        totalTasks: tasks.length,
        waves: schedule.waves.length,
        maxParallel,
        tier: this.planTier,
      },
      "Fleet execution starting"
    );

    await this.publishFleetStatus();

    for (let waveIdx = 0; waveIdx < schedule.waves.length; waveIdx++) {
      const wave = schedule.waves[waveIdx] as (typeof schedule.waves)[number];
      logger.info({ wave: waveIdx + 1, tasks: wave.length }, "Starting wave");

      // Execute tasks in wave, limited by tier parallelism
      const chunks: SchedulableTask[][] = this.chunkArray(wave, maxParallel);

      for (const chunk of chunks) {
        const chunkPromises = chunk.map((task) =>
          this.executeFleetTask(task, blueprint)
        );

        const settled = await Promise.allSettled(chunkPromises);

        for (const result of settled) {
          if (result.status === "fulfilled") {
            results.push(result.value);
          } else {
            results.push({
              success: false,
              output: "",
              filesChanged: [],
              tokensUsed: { input: 0, output: 0 },
              toolCalls: 0,
              steps: 0,
              creditsConsumed: 0,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            });
          }
        }

        await this.publishFleetStatus();
      }
    }

    logger.info(
      {
        totalResults: results.length,
        successes: results.filter((r) => r.success).length,
        failures: results.filter((r) => !r.success).length,
      },
      "Fleet execution complete"
    );

    return results;
  }

  /**
   * Execute a single task within the fleet.
   */
  private async executeFleetTask(
    task: SchedulableTask,
    blueprint: string
  ): Promise<AgentExecutionResult> {
    const agentId = generateId("fa");
    const loop = new AgentLoop(
      this.sessionId,
      this.projectId,
      this.orgId,
      this.userId
    );

    const fleetAgent: FleetAgent = {
      id: agentId,
      taskId: task.id,
      role: task.agentRole,
      status: "running",
      loop,
      startedAt: new Date(),
      completedAt: null,
      result: null,
    };

    this.agents.set(agentId, fleetAgent);

    // Register with lifecycle manager for stuck-detection
    this.lifecycleManager.registerAgent(agentId, task.agentRole);
    this.lifecycleManager.startTask(agentId, task.id);

    try {
      const enrichedDesc = `${task.title}\n\n${blueprint ? `Blueprint:\n${blueprint}\n\n` : ""}`;
      const result = await loop.executeTask(enrichedDesc, task.agentRole);

      fleetAgent.status = result.success ? "completed" : "failed";
      fleetAgent.completedAt = new Date();
      fleetAgent.result = result;

      return result;
    } catch (error) {
      fleetAgent.status = "failed";
      fleetAgent.completedAt = new Date();

      const errorResult: AgentExecutionResult = {
        success: false,
        output: "",
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        steps: 0,
        creditsConsumed: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      fleetAgent.result = errorResult;
      return errorResult;
    }
  }

  /**
   * Pause a specific agent in the fleet.
   */
  async pauseAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== "running") {
      return;
    }

    await agent.loop.pause();
    agent.status = "paused";
    await this.publishFleetStatus();
  }

  /**
   * Resume a paused agent.
   */
  async resumeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== "paused") {
      return;
    }

    await agent.loop.resume();
    agent.status = "running";
    await this.publishFleetStatus();
  }

  /**
   * Stop a specific agent.
   */
  async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    await agent.loop.stop();
    agent.status = "failed";
    agent.completedAt = new Date();
    await this.publishFleetStatus();
  }

  /**
   * Stop all agents in the fleet.
   */
  async stopAll(): Promise<void> {
    for (const [, agent] of this.agents) {
      if (agent.status === "running" || agent.status === "paused") {
        await agent.loop.stop();
        agent.status = "failed";
        agent.completedAt = new Date();
      }
    }
    await this.publishFleetStatus();
  }

  /**
   * Get fleet status summary.
   */
  getStatus(): FleetStatus {
    const agentList = Array.from(this.agents.values());
    return {
      sessionId: this.sessionId,
      totalAgents: agentList.length,
      running: agentList.filter((a) => a.status === "running").length,
      completed: agentList.filter((a) => a.status === "completed").length,
      failed: agentList.filter((a) => a.status === "failed").length,
      queued: agentList.filter((a) => a.status === "queued").length,
      agents: agentList.map((a) => ({
        id: a.id,
        taskId: a.taskId,
        role: a.role,
        status: a.status,
        creditsConsumed: a.loop.getCreditsConsumed(),
      })),
      totalCreditsConsumed: agentList.reduce(
        (sum, a) => sum + a.loop.getCreditsConsumed(),
        0
      ),
    };
  }

  /**
   * Execute tasks using swarm coordination for dependency-aware scheduling.
   * Converts SchedulableTasks to SwarmTasks and delegates to SwarmCoordinator.
   */
  async executeSwarm(
    tasks: SchedulableTask[],
    blueprint: string
  ): Promise<AgentExecutionResult[]> {
    const swarmTasks: SwarmTask[] = tasks.map((t) => ({
      id: t.id,
      role: t.agentRole,
      description: t.title,
      dependencies: t.dependencies,
      priority: effortToPriority(t.effort),
    }));

    const swarmResults = await this.swarmCoordinator.coordinate(
      swarmTasks,
      (swarmTask) => {
        const matchingTask = tasks.find((t) => t.id === swarmTask.id);
        if (!matchingTask) {
          throw new Error(`Task ${swarmTask.id} not found`);
        }
        return this.executeFleetTask(matchingTask, blueprint);
      }
    );

    return swarmResults.map((sr) => {
      if (sr.status === "completed" && sr.result) {
        return sr.result as AgentExecutionResult;
      }
      return {
        success: false,
        output: "",
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        steps: 0,
        creditsConsumed: 0,
        error: sr.error ?? `Task ${sr.taskId} ${sr.status}`,
      };
    });
  }

  /**
   * Get the lifecycle manager for external monitoring.
   */
  getLifecycleManager(): AgentLifecycleManager {
    return this.lifecycleManager;
  }

  /**
   * Clean up all fleet resources.
   */
  dispose(): void {
    this.lifecycleManager.dispose();
  }

  private async publishFleetStatus(): Promise<void> {
    const status = this.getStatus();
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { fleet: status },
      timestamp: new Date().toISOString(),
    });
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
