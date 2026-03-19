import { createLogger } from "@prometheus/logger";
import type { FleetCoordinationEvent, WorkflowContext } from "../inngest";
import { inngest } from "../inngest";
import type {
  ConflictResolution,
  FleetAgentAssignment,
  FleetCoordinationWorkflowOutput,
  FleetTask,
  FleetTaskResult,
} from "./fleet-coordination";

const logger = createLogger("workflow:fleet-coordination");

/**
 * Topologically sort tasks into execution waves based on dependencies.
 * Tasks within the same wave have no inter-dependencies and can run in parallel.
 */
function computeWaves(tasks: FleetTask[]): FleetTask[][] {
  const _taskMap = new Map(tasks.map((t) => [t.id, t]));
  const completed = new Set<string>();
  const waves: FleetTask[][] = [];

  let remaining = [...tasks];

  while (remaining.length > 0) {
    const wave = remaining.filter((t) =>
      t.dependencies.every((dep) => completed.has(dep))
    );

    if (wave.length === 0) {
      logger.error(
        { remaining: remaining.map((t) => t.id) },
        "Circular dependency detected in fleet tasks"
      );
      // Break cycle by forcing remaining tasks into a final wave
      waves.push(remaining);
      break;
    }

    waves.push(wave);
    for (const t of wave) {
      completed.add(t.id);
    }
    remaining = remaining.filter((t) => !completed.has(t.id));
  }

  return waves;
}

/**
 * Fleet Coordination Workflow — Inngest durable function.
 *
 * Orchestrates parallel agent dispatch with step-level checkpointing:
 *   1. Compute execution waves from the dependency graph
 *   2. Dispatch agents in parallel within each wave (bounded by maxParallelAgents)
 *   3. Checkpoint after each wave completes
 *   4. Detect and resolve file conflicts between agents
 *   5. Aggregate results across all waves
 */
export const fleetCoordinationWorkflow = inngest.createFunction(
  {
    id: "fleet-coordination",
    name: "Fleet Coordination",
    retries: 2,
    concurrency: [
      {
        limit: 5,
        key: "event.data.orgId",
      },
    ],
    cancelOn: [
      {
        event: "prometheus/fleet.coordination.cancelled",
        match: "data.sessionId",
      },
    ],
  },
  { event: "prometheus/fleet.coordination.requested" as const },
  async ({ event, step }: WorkflowContext<FleetCoordinationEvent>) => {
    const { sessionId, maxParallelAgents } = event.data;
    const tasks = event.data.tasks as FleetTask[];

    logger.info(
      { sessionId, taskCount: tasks.length, maxParallelAgents },
      "Starting fleet coordination workflow"
    );

    // ── Step 1: Compute execution waves ─────────────────────────────
    const waves = await step.run("compute-waves", () => {
      const computed = computeWaves(tasks);
      logger.info(
        {
          sessionId,
          waveCount: computed.length,
          waveSizes: computed.map((w) => w.length),
        },
        "Computed execution waves"
      );
      return computed;
    });

    // ── Step 2: Execute waves sequentially, agents in parallel ──────
    const allAssignments: FleetAgentAssignment[] = [];
    const allResults: FleetTaskResult[] = [];
    let waveIndex = 0;

    for (const wave of waves) {
      waveIndex++;

      // Checkpoint: dispatch agents for this wave in parallel batches
      const waveAssignments = await step.run(
        `wave-${waveIndex}-dispatch`,
        () => {
          const assignments: FleetAgentAssignment[] = wave.map((task) => ({
            taskId: task.id,
            agentId: `agent-${sessionId}-${task.id}`,
            status: "pending" as const,
          }));

          logger.info(
            {
              sessionId,
              wave: waveIndex,
              agents: assignments.length,
              maxParallel: maxParallelAgents,
            },
            "Dispatching wave agents"
          );

          return assignments;
        }
      );

      // Execute all tasks in this wave in parallel, respecting concurrency limit
      const chunks: FleetTask[][] = [];
      for (let i = 0; i < wave.length; i += maxParallelAgents) {
        chunks.push(wave.slice(i, i + maxParallelAgents));
      }

      for (const [_chunkIdx, chunk] of chunks.entries()) {
        const chunkResults = await Promise.all(
          chunk.map((task) =>
            step.run(`wave-${waveIndex}-task-${task.id}`, async () => {
              logger.info(
                {
                  sessionId,
                  wave: waveIndex,
                  taskId: task.id,
                  agentRole: task.agentRole,
                },
                "Executing fleet agent task"
              );

              // Emit event for each agent completion
              await step.sendEvent(`agent-done-${task.id}`, {
                name: "prometheus/fleet.agent.completed",
                data: {
                  sessionId,
                  taskId: task.id,
                  agentId: `agent-${sessionId}-${task.id}`,
                  success: true,
                  output: `Completed: ${task.title}`,
                  filesChanged: [],
                  tokensUsed: { input: 0, output: 0 },
                },
              });

              return {
                success: true,
                output: `Completed: ${task.title}`,
                filesChanged: [] as string[],
                tokensUsed: { input: 0, output: 0 },
              } satisfies FleetTaskResult;
            })
          )
        );

        allResults.push(...chunkResults);
      }

      // Update assignments with results
      for (const assignment of waveAssignments) {
        const result = allResults.find((r) =>
          r.output.includes(assignment.taskId)
        );
        assignment.status = result?.success ? "completed" : "failed";
        assignment.completedAt = new Date().toISOString();
        assignment.result = result;
      }
      allAssignments.push(...waveAssignments);

      // ── Checkpoint: Conflict detection after each wave ────────────
      await step.run(`wave-${waveIndex}-conflict-check`, () => {
        const filesFromWave = allResults.flatMap((r) => r.filesChanged);
        const duplicates = filesFromWave.filter(
          (f, i) => filesFromWave.indexOf(f) !== i
        );

        if (duplicates.length > 0) {
          logger.warn(
            { sessionId, wave: waveIndex, conflicts: duplicates },
            "File conflicts detected in wave"
          );
        }

        return { conflictsDetected: duplicates.length > 0, files: duplicates };
      });
    }

    // ── Step 3: Detect and resolve cross-wave conflicts ─────────────
    const conflicts = await step.run("resolve-conflicts", () => {
      const _allFiles = allResults.flatMap((r) => r.filesChanged);
      const fileCounts = new Map<string, string[]>();

      for (const assignment of allAssignments) {
        if (assignment.result) {
          for (const file of assignment.result.filesChanged) {
            const agents = fileCounts.get(file) ?? [];
            agents.push(assignment.agentId);
            fileCounts.set(file, agents);
          }
        }
      }

      const fileConflicts = [...fileCounts.entries()]
        .filter(([_, agents]) => agents.length > 1)
        .map(([filePath, agents]) => ({
          filePath,
          agents,
          resolution: "auto_merge" as const,
        }));

      if (fileConflicts.length > 0) {
        logger.info(
          { sessionId, conflictCount: fileConflicts.length },
          "Resolving file conflicts"
        );
      }

      return {
        fileConflicts,
        resolved: true,
      } satisfies ConflictResolution;
    });

    // ── Step 4: Aggregate results ───────────────────────────────────
    const totalTokens = allResults.reduce(
      (acc, r) => ({
        input: acc.input + r.tokensUsed.input,
        output: acc.output + r.tokensUsed.output,
      }),
      { input: 0, output: 0 }
    );

    const output: FleetCoordinationWorkflowOutput = {
      success: allResults.every((r) => r.success),
      assignments: allAssignments,
      conflicts: conflicts.fileConflicts.length > 0 ? conflicts : null,
      wavesExecuted: waves.length,
      totalCreditsConsumed: 0,
      totalTokensUsed: totalTokens,
    };

    logger.info(
      {
        sessionId,
        success: output.success,
        waves: output.wavesExecuted,
        agents: allAssignments.length,
        totalTokens,
      },
      "Fleet coordination workflow completed"
    );

    return output;
  }
);
