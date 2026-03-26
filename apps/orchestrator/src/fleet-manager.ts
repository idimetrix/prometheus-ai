import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { AgentLoop } from "./agent-loop";
import { ConflictDetector } from "./fleet/conflict-detector";
import { FleetMetrics } from "./fleet/fleet-metrics";
import { MergeCoordinator } from "./fleet/merge-coordinator";
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
 *
 * Enhanced with DAG-based wave execution, conflict detection, and result merging.
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

  private async publishFleetStatus(): Promise<void> {
    const status = this.getStatus();
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { fleet: status },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Execute a full project generation pipeline: discovery -> architect -> planner
   * -> coder -> tester -> deploy. Each phase runs sequentially, feeding its
   * output as context into the next phase.
   */
  async fullProjectPipeline(
    projectDescription: string,
    options?: { skipDeploy?: boolean }
  ): Promise<AgentExecutionResult[]> {
    const phases: Array<{ role: string; title: string }> = [
      { role: "discovery", title: "Discover project requirements" },
      { role: "architect", title: "Design system architecture" },
      { role: "planner", title: "Create implementation plan" },
      { role: "backend_coder", title: "Implement backend code" },
      { role: "frontend_coder", title: "Implement frontend code" },
      { role: "tester", title: "Write and run tests" },
    ];

    if (!options?.skipDeploy) {
      phases.push({ role: "devops", title: "Configure deployment" });
    }

    logger.info(
      {
        sessionId: this.sessionId,
        phases: phases.length,
        description: projectDescription.slice(0, 120),
      },
      "Starting full project pipeline"
    );

    const results: AgentExecutionResult[] = [];
    let previousContext = projectDescription;

    for (const phase of phases) {
      const task: SchedulableTask = {
        id: generateId("fpp"),
        title: `${phase.title}: ${projectDescription.slice(0, 80)}`,
        agentRole: phase.role,
        dependencies: [],
        effort: "medium",
      };

      const enrichedBlueprint = `Project: ${projectDescription}\n\nPrevious phase output:\n${previousContext}`;
      const result = await this.executeFleetTask(task, enrichedBlueprint);
      results.push(result);

      if (!result.success) {
        logger.warn(
          { phase: phase.role, error: result.error },
          "Pipeline phase failed, stopping"
        );
        break;
      }

      previousContext = result.output || previousContext;
      await this.publishFleetStatus();
    }

    logger.info(
      {
        totalPhases: phases.length,
        completed: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
      "Full project pipeline complete"
    );

    return results;
  }

  // ─── DAG-based fleet orchestration (AE05) ──────────────────────────

  /**
   * Build a dependency DAG from a list of tasks.
   * Returns tasks organized into waves where each wave's tasks
   * can execute in parallel, and a wave only starts after all
   * tasks in the previous wave have completed.
   */
  buildDependencyDAG(tasks: SchedulableTask[]): {
    waves: SchedulableTask[][];
    order: string[];
  } {
    const result = this.scheduler.schedule(tasks);
    return {
      waves: result.waves,
      order: result.waves.flat().map((t) => t.id),
    };
  }

  /**
   * Execute tasks in dependency waves. Tasks within a wave run in
   * parallel (up to the tier limit). Waves execute sequentially.
   * Tracks metrics for parallel speedup analysis.
   */
  async executeInWaves(
    dag: { waves: SchedulableTask[][] },
    blueprint: string
  ): Promise<{
    results: AgentExecutionResult[];
    metrics: FleetMetrics;
  }> {
    const maxParallel = TIER_LIMITS[this.planTier] ?? 1;
    const metrics = new FleetMetrics();
    const results: AgentExecutionResult[] = [];
    const conflictDetector = new ConflictDetector();

    metrics.startFleet();

    logger.info(
      {
        sessionId: this.sessionId,
        waves: dag.waves.length,
        totalTasks: dag.waves.reduce((sum, w) => sum + w.length, 0),
        maxParallel,
      },
      "Executing tasks in dependency waves"
    );

    for (let waveIdx = 0; waveIdx < dag.waves.length; waveIdx++) {
      const wave = dag.waves[waveIdx] as SchedulableTask[];
      const waveResult = await this.executeWave(
        wave,
        waveIdx,
        blueprint,
        maxParallel,
        metrics,
        conflictDetector
      );
      for (const r of waveResult) {
        results.push(r);
      }
      await this.publishFleetStatus();
    }

    // Detect conflicts across all agents
    const conflictReport = conflictDetector.detect();
    if (conflictReport.hasConflicts) {
      metrics.recordConflicts({
        totalConflicts: conflictReport.conflicts.length,
        filesAffected: conflictReport.totalFilesModified,
      });
    }

    metrics.endFleet();

    const summary = metrics.getSummary();
    logger.info(
      {
        parallelSpeedupRatio: summary.parallelSpeedupRatio,
        overallSuccessRate: summary.overallSuccessRate,
        totalWallClockMs: summary.totalWallClockMs,
        conflicts: conflictReport.conflicts.length,
      },
      "Wave execution complete"
    );

    return { results, metrics };
  }

  /**
   * Execute a single wave of tasks in parallel chunks.
   */
  private async executeWave(
    wave: SchedulableTask[],
    waveIdx: number,
    blueprint: string,
    maxParallel: number,
    metrics: FleetMetrics,
    conflictDetector: ConflictDetector
  ): Promise<AgentExecutionResult[]> {
    const waveStart = Date.now();
    const results: AgentExecutionResult[] = [];
    let waveSuccessCount = 0;
    let waveFailCount = 0;

    logger.info(
      { wave: waveIdx + 1, tasks: wave.length },
      "Starting dependency wave"
    );

    const chunks = this.chunkArray(wave, maxParallel);

    for (const chunk of chunks) {
      const chunkResults = await this.executeChunk(
        chunk,
        blueprint,
        metrics,
        conflictDetector
      );
      for (const r of chunkResults) {
        results.push(r);
        if (r.success) {
          waveSuccessCount++;
        } else {
          waveFailCount++;
        }
      }
    }

    metrics.recordWave({
      waveIndex: waveIdx,
      durationMs: Date.now() - waveStart,
      agentCount: wave.length,
      successCount: waveSuccessCount,
      failedCount: waveFailCount,
    });

    return results;
  }

  /**
   * Execute a single chunk of tasks concurrently.
   */
  private async executeChunk(
    chunk: SchedulableTask[],
    blueprint: string,
    metrics: FleetMetrics,
    conflictDetector: ConflictDetector
  ): Promise<AgentExecutionResult[]> {
    const results: AgentExecutionResult[] = [];

    const chunkPromises = chunk.map(async (task) => {
      const agentStart = Date.now();
      const result = await this.executeFleetTask(task, blueprint);
      const agentEnd = Date.now();

      metrics.recordAgent({
        agentId: task.id,
        taskId: task.id,
        role: task.agentRole,
        success: result.success,
        durationMs: agentEnd - agentStart,
        startedAt: agentStart,
        completedAt: agentEnd,
        filesChanged: result.filesChanged.length,
        tokensUsed:
          (result.tokensUsed?.input ?? 0) + (result.tokensUsed?.output ?? 0),
      });

      for (const file of result.filesChanged) {
        conflictDetector.recordChange({
          filePath: file,
          agentId: task.id,
          agentRole: task.agentRole,
          changeType: "modify",
          timestamp: agentEnd,
        });
      }

      return result;
    });

    const settled = await Promise.allSettled(chunkPromises);
    for (const settledResult of settled) {
      if (settledResult.status === "fulfilled") {
        results.push(settledResult.value);
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
            settledResult.reason instanceof Error
              ? settledResult.reason.message
              : String(settledResult.reason),
        });
      }
    }

    return results;
  }

  /**
   * Detect conflicting file changes between agent results.
   * Returns a report of files modified by multiple agents.
   */
  detectConflicts(
    agentResults: Array<{
      agentId: string;
      role: string;
      filesChanged: string[];
    }>
  ): {
    hasConflicts: boolean;
    conflicts: Array<{
      filePath: string;
      agents: Array<{ id: string; role: string }>;
    }>;
  } {
    const fileToAgents = new Map<string, Array<{ id: string; role: string }>>();

    for (const result of agentResults) {
      for (const file of result.filesChanged) {
        const existing = fileToAgents.get(file) ?? [];
        existing.push({ id: result.agentId, role: result.role });
        fileToAgents.set(file, existing);
      }
    }

    const conflicts: Array<{
      filePath: string;
      agents: Array<{ id: string; role: string }>;
    }> = [];

    for (const [filePath, agents] of fileToAgents) {
      if (agents.length > 1) {
        conflicts.push({ filePath, agents });
      }
    }

    if (conflicts.length > 0) {
      logger.warn(
        {
          conflictCount: conflicts.length,
          files: conflicts.map((c) => c.filePath),
        },
        "File conflicts detected between agents"
      );
    }

    return { hasConflicts: conflicts.length > 0, conflicts };
  }

  /**
   * Merge non-conflicting results and flag conflicts for resolution.
   * Returns the merged file set and any unresolved conflicts.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: merge coordination requires conflict detection, resolution attempts, and fallback logic
  async mergeResults(
    agentResults: Array<{
      agentId: string;
      filesChanged: string[];
      role: string;
      success: boolean;
    }>
  ): Promise<{
    mergedFiles: string[];
    conflictedFiles: string[];
    mergeSuccess: boolean;
  }> {
    const successfulResults = agentResults.filter((r) => r.success);
    const conflictInfo = this.detectConflicts(successfulResults);

    const conflictedFilePaths = new Set(
      conflictInfo.conflicts.map((c) => c.filePath)
    );

    // Collect all non-conflicting files
    const mergedFiles: string[] = [];
    for (const result of successfulResults) {
      for (const file of result.filesChanged) {
        if (!conflictedFilePaths.has(file)) {
          mergedFiles.push(file);
        }
      }
    }

    // Deduplicate
    const uniqueMergedFiles = [...new Set(mergedFiles)];
    const conflictedFiles = [...conflictedFilePaths];

    // Attempt automated conflict resolution via MergeCoordinator
    if (conflictedFiles.length > 0) {
      try {
        const mergeCoordinator = new MergeCoordinator();
        const innerDetector = new ConflictDetector();

        for (const result of successfulResults) {
          for (const file of result.filesChanged) {
            innerDetector.recordChange({
              filePath: file,
              agentId: result.agentId,
              agentRole: result.role,
              changeType: "modify",
              timestamp: Date.now(),
            });
          }
        }

        const report = innerDetector.detect();
        const worktrees = new Map<string, string>();
        for (const result of successfulResults) {
          worktrees.set(result.agentId, result.agentId);
        }

        const mergeResult = await mergeCoordinator.coordinateMerge(
          report,
          worktrees
        );

        if (mergeResult.status === "success") {
          logger.info(
            { resolved: mergeResult.merged.length },
            "All conflicts resolved via merge coordinator"
          );
          return {
            mergedFiles: [...uniqueMergedFiles, ...conflictedFiles],
            conflictedFiles: [],
            mergeSuccess: true,
          };
        }

        if (mergeResult.status === "partial") {
          const resolvedFiles = mergeResult.merged.map((m) => m.filePath);
          const stillConflicted = mergeResult.conflicts.map((c) => c.filePath);
          return {
            mergedFiles: [...uniqueMergedFiles, ...resolvedFiles],
            conflictedFiles: stillConflicted,
            mergeSuccess: stillConflicted.length === 0,
          };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { error: msg },
          "Merge coordinator failed, returning conflicts as-is"
        );
      }
    }

    logger.info(
      {
        mergedFiles: uniqueMergedFiles.length,
        conflictedFiles: conflictedFiles.length,
      },
      "Results merged"
    );

    return {
      mergedFiles: uniqueMergedFiles,
      conflictedFiles,
      mergeSuccess: conflictedFiles.length === 0,
    };
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
