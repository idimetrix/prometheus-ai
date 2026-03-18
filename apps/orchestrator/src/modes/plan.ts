import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { ArchitecturePhase } from "../phases/architecture";
import { DiscoveryPhase } from "../phases/discovery";
import { PlanningPhase } from "../phases/planning";
import type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const logger = createLogger("orchestrator:mode:plan");

/**
 * Plan Mode: Discovery + Architecture + Planning only. NO code execution.
 * Requires approval to transition to task mode.
 */
export class PlanModeHandler implements ModeHandler {
  readonly modeName = "plan";
  private readonly eventPublisher = new EventPublisher();

  async execute(params: ModeHandlerParams): Promise<ModeResult> {
    logger.info(
      { sessionId: params.sessionId },
      "Plan mode: generating plan without execution"
    );

    // Phase 1: Discovery
    await this.publishPhase(params.sessionId, "discovery", "running");
    const discovery = new DiscoveryPhase();
    const discoveryResult = await discovery.execute(
      params.agentLoop,
      params.taskDescription
    );
    await this.publishPhase(params.sessionId, "discovery", "completed");

    // Phase 2: Architecture
    await this.publishPhase(params.sessionId, "architecture", "running");
    const architecture = new ArchitecturePhase();
    const archResult = await architecture.execute(
      params.agentLoop,
      discoveryResult.srs
    );
    await this.publishPhase(params.sessionId, "architecture", "completed");

    // Phase 3: Planning
    await this.publishPhase(params.sessionId, "planning", "running");
    const planning = new PlanningPhase();
    const sprintPlan = await planning.execute(
      params.agentLoop,
      archResult.blueprint
    );
    await this.publishPhase(params.sessionId, "planning", "completed");

    // Publish checkpoint for plan approval
    await this.eventPublisher.publishSessionEvent(params.sessionId, {
      type: QueueEvents.CHECKPOINT,
      data: {
        event: "plan_approval_required",
        discoveryResult,
        architectureResult: archResult,
        sprintPlan,
        message:
          "Plan generated. Approve to transition to task mode for execution.",
      },
      timestamp: new Date().toISOString(),
    });

    return {
      results: [
        {
          success: true,
          output: `Plan generated with ${sprintPlan.tasks.length} tasks across ${sprintPlan.parallelWorkstreams.length} workstreams.`,
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
          toolCalls: 0,
          steps: 0,
          creditsConsumed: 0,
        },
      ],
      totalCreditsConsumed: params.agentLoop.getCreditsConsumed(),
      metadata: { discoveryResult, architectureResult: archResult, sprintPlan },
    };
  }

  private async publishPhase(
    sessionId: string,
    phase: string,
    status: string
  ): Promise<void> {
    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.PLAN_UPDATE,
      data: { phase, status },
      timestamp: new Date().toISOString(),
    });
  }
}
