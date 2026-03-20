import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { CompoundLoop } from "../compound/compound-loop";
import { FleetManager } from "../fleet-manager";
import type { SchedulableTask } from "../parallel/scheduler";
import { ArchitecturePhase } from "../phases/architecture";
import { DiscoveryPhase } from "../phases/discovery";
import { PlanningPhase } from "../phases/planning";
import type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const logger = createLogger("orchestrator:mode:fleet");

/**
 * Fleet Mode: Compound loop execution via PlannerAgent + WorkerPool + JudgeAgent.
 *
 * Flow:
 *   1. PlannerAgent decomposes task into DAG
 *   2. WorkerPool fans out subtasks in parallel
 *   3. JudgeAgent reviews all results
 *   4. Up to 3 revision cycles
 *   5. Falls back to legacy FleetManager if compound loop is not applicable
 */
export class FleetModeHandler implements ModeHandler {
  readonly modeName = "fleet";

  async execute(params: ModeHandlerParams): Promise<ModeResult> {
    logger.info(
      { sessionId: params.sessionId },
      "Fleet mode: compound loop execution"
    );

    // Try compound loop first (Plan → Fan-out → Gather → Judge → Revise)
    const compoundLoop = new CompoundLoop();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];

    try {
      for await (const event of compoundLoop.execute({
        sessionId: params.sessionId,
        projectId: params.projectId,
        orgId: params.orgId,
        userId: params.userId,
        planTier: params.planTier,
        taskDescription: params.taskDescription,
      })) {
        events.push(event);

        logger.debug(
          { sessionId: params.sessionId, eventType: event.type },
          "Compound loop event"
        );
      }

      const completeEvent = events.find((e) => e.type === "complete");
      const success = completeEvent?.data?.success === true;

      return {
        results: [
          {
            success,
            output: `Fleet compound loop: ${success ? "completed" : "failed"} with ${events.length} events`,
            filesChanged: [],
            tokensUsed: { input: 0, output: 0 },
            toolCalls: 0,
            steps: events.length,
            creditsConsumed: 0,
          },
        ],
        totalCreditsConsumed: params.agentLoop.getCreditsConsumed(),
        metadata: { compoundEvents: events },
      };
    } catch (error) {
      logger.warn(
        { sessionId: params.sessionId, error: String(error) },
        "Compound loop failed, falling back to legacy FleetManager"
      );

      return this.executeLegacy(params);
    }
  }

  /**
   * Legacy fleet execution path via FleetManager.
   */
  private async executeLegacy(params: ModeHandlerParams): Promise<ModeResult> {
    const results: AgentExecutionResult[] = [];

    const discovery = new DiscoveryPhase();
    const discoveryResult = await discovery.execute(
      params.agentLoop,
      params.taskDescription
    );

    const architecture = new ArchitecturePhase();
    const archResult = await architecture.execute(
      params.agentLoop,
      discoveryResult.srs
    );

    const planning = new PlanningPhase();
    const sprintPlan = await planning.execute(
      params.agentLoop,
      archResult.blueprint
    );

    const schedulableTasks: SchedulableTask[] = sprintPlan.tasks.map(
      (task, idx) => ({
        id: task.id ?? `task_${idx}`,
        title: task.description,
        agentRole: task.agentRole,
        dependencies: task.dependencies ?? [],
        effort: task.effort ?? "M",
      })
    );

    const fleet = new FleetManager({
      sessionId: params.sessionId,
      projectId: params.projectId,
      orgId: params.orgId,
      userId: params.userId,
      planTier: params.planTier,
    });

    const fleetResults = await fleet.executeTasks(
      schedulableTasks,
      archResult.blueprint
    );
    results.push(...fleetResults);

    return {
      results,
      totalCreditsConsumed: params.agentLoop.getCreditsConsumed(),
      metadata: { discoveryResult, architectureResult: archResult, sprintPlan },
    };
  }
}
