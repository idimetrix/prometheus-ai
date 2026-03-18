import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { FleetManager } from "../fleet-manager";
import type { SchedulableTask } from "../parallel/scheduler";
import { ArchitecturePhase } from "../phases/architecture";
import { DiscoveryPhase } from "../phases/discovery";
import { PlanningPhase } from "../phases/planning";
import type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const logger = createLogger("orchestrator:mode:fleet");

/**
 * Fleet Mode: Full parallel execution via FleetManager.
 * Pro+ plans only. Generates plan then dispatches via fleet.
 */
export class FleetModeHandler implements ModeHandler {
  readonly modeName = "fleet";

  async execute(params: ModeHandlerParams): Promise<ModeResult> {
    logger.info(
      { sessionId: params.sessionId },
      "Fleet mode: parallel execution"
    );
    const results: AgentExecutionResult[] = [];

    // Generate plan first
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

    // Execute via FleetManager
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
