/**
 * Phase 10.2: PlanSimulator executes 1-2 tasks from a strategy
 * in a throwaway worktree to validate feasibility before committing
 * to a full execution plan.
 */
import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import { WorktreeManager } from "../git/worktree-manager";

const logger = createLogger("orchestrator:planning:simulator");

export interface SimulationResult {
  errors: string[];
  filesChanged: string[];
  success: boolean;
  taskId: string;
  timeMs: number;
}

export class PlanSimulator {
  private readonly worktreeManager: WorktreeManager;

  constructor() {
    this.worktreeManager = new WorktreeManager();
  }

  /**
   * Execute a task in a throwaway worktree to test feasibility.
   * The worktree is always cleaned up afterward.
   */
  async simulate(
    agentLoop: AgentLoop,
    projectId: string,
    task: {
      id: string;
      description: string;
      agentRole: string;
    }
  ): Promise<SimulationResult> {
    const simulationTaskId = `sim-${task.id}`;
    const startTime = Date.now();

    try {
      // Create throwaway worktree
      const worktree = await this.worktreeManager.create(
        projectId,
        simulationTaskId
      );

      logger.info(
        { taskId: task.id, worktreePath: worktree.path },
        "Starting plan simulation"
      );

      // Execute the task with a reduced iteration limit
      const result = await agentLoop.executeTask(
        `[SIMULATION MODE - Limited execution]\n\n${task.description}\n\nIMPORTANT: This is a simulation. Complete the first significant step of this task to validate the approach. Stop after making the first meaningful change.`,
        task.agentRole,
        { maxIterations: 10, workDir: worktree.path }
      );

      const timeMs = Date.now() - startTime;

      return {
        taskId: task.id,
        success: result.success,
        timeMs,
        filesChanged: result.filesChanged,
        errors: result.error ? [result.error] : [],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        taskId: task.id,
        success: false,
        timeMs: Date.now() - startTime,
        filesChanged: [],
        errors: [msg],
      };
    } finally {
      // Always clean up throwaway worktree
      await this.worktreeManager.remove(projectId, simulationTaskId);
    }
  }

  /**
   * Simulate the first N tasks of a strategy to validate feasibility.
   */
  async simulateStrategy(
    agentLoop: AgentLoop,
    projectId: string,
    tasks: Array<{ id: string; description: string; agentRole: string }>,
    maxTasks = 2
  ): Promise<{
    results: SimulationResult[];
    overallSuccess: boolean;
    totalTimeMs: number;
  }> {
    const results: SimulationResult[] = [];
    const startTime = Date.now();

    for (const task of tasks.slice(0, maxTasks)) {
      const result = await this.simulate(agentLoop, projectId, task);
      results.push(result);

      // If first task fails, no point continuing
      if (!result.success) {
        break;
      }
    }

    const overallSuccess = results.every((r) => r.success);
    const totalTimeMs = Date.now() - startTime;

    logger.info(
      {
        tasksSimulated: results.length,
        overallSuccess,
        totalTimeMs,
      },
      "Strategy simulation complete"
    );

    return { results, overallSuccess, totalTimeMs };
  }
}
