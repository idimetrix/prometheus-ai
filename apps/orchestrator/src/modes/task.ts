import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { CILoopRunner } from "../ci-loop/ci-loop-runner";
import { FleetManager } from "../fleet-manager";
import type { SchedulableTask } from "../parallel/scheduler";
import { ArchitecturePhase } from "../phases/architecture";
import { DiscoveryPhase } from "../phases/discovery";
import { PlanningPhase } from "../phases/planning";
import type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const logger = createLogger("orchestrator:mode:task");

/**
 * Task Mode: Full pipeline execution.
 * Discovery -> Architecture -> Planning -> Parallel Build -> CI Loop -> Security -> Deploy
 */
export class TaskModeHandler implements ModeHandler {
  readonly modeName = "task";
  private readonly eventPublisher = new EventPublisher();

  async execute(params: ModeHandlerParams): Promise<ModeResult> {
    logger.info({ sessionId: params.sessionId }, "Task mode: full pipeline");
    const results: AgentExecutionResult[] = [];

    // Phase 1: Discovery
    await this.publishPhase(params.sessionId, "discovery", "running");
    const discovery = new DiscoveryPhase();
    const discoveryResult = await discovery.execute(
      params.agentLoop,
      params.taskDescription
    );
    results.push({
      success: discoveryResult.confidenceScore >= 0.8,
      output: discoveryResult.srs,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhase(params.sessionId, "discovery", "completed");

    // Phase 2: Architecture
    await this.publishPhase(params.sessionId, "architecture", "running");
    const architecture = new ArchitecturePhase();
    const archResult = await architecture.execute(
      params.agentLoop,
      discoveryResult.srs
    );
    results.push({
      success: true,
      output: archResult.blueprint,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhase(params.sessionId, "architecture", "completed");

    // Phase 3: Planning
    await this.publishPhase(params.sessionId, "planning", "running");
    const planning = new PlanningPhase();
    const sprintPlan = await planning.execute(
      params.agentLoop,
      archResult.blueprint
    );
    results.push({
      success: true,
      output: JSON.stringify(sprintPlan),
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhase(params.sessionId, "planning", "completed");

    // Phase 4: Scaffold
    await this.publishPhase(params.sessionId, "scaffold", "running");
    await params.agentLoop.executeTask(
      "Create the project scaffold based on the Blueprint: project structure, configuration files, initial setup.",
      "backend_coder"
    );
    await this.publishPhase(params.sessionId, "scaffold", "completed");

    // Phase 5: Parallel Build via FleetManager
    await this.publishPhase(params.sessionId, "parallel_build", "running");
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
    await this.publishPhase(params.sessionId, "parallel_build", "completed");

    // Phase 6: CI Loop
    await this.publishPhase(params.sessionId, "ci_loop", "running");
    const ciRunner = new CILoopRunner(20);
    const ciResult = await ciRunner.run(params.agentLoop);
    results.push({
      success: ciResult.passed,
      output: `CI Loop: ${ciResult.passed ? "PASSED" : "FAILED"} after ${ciResult.iterations}/${ciResult.maxIterations} iterations. Auto-resolved: ${ciResult.autoResolved}`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhase(
      params.sessionId,
      "ci_loop",
      ciResult.passed ? "completed" : "failed"
    );

    // Phase 7: Security Audit
    await this.publishPhase(params.sessionId, "security", "running");
    const secResult = await params.agentLoop.executeTask(
      "Perform a security audit on the implemented code. Check for OWASP Top 10 vulnerabilities, input validation, auth gaps, injection risks.",
      "security_auditor"
    );
    results.push(secResult);
    await this.publishPhase(params.sessionId, "security", "completed");

    // Phase 8: Deploy
    await this.publishPhase(params.sessionId, "deploy", "running");
    const deployResult = await params.agentLoop.executeTask(
      "Prepare deployment configuration: Dockerfiles, k8s manifests, CI/CD pipeline, migration scripts.",
      "deploy_engineer"
    );
    results.push(deployResult);
    await this.publishPhase(params.sessionId, "deploy", "completed");

    return {
      results,
      totalCreditsConsumed: params.agentLoop.getCreditsConsumed(),
      metadata: {
        discoveryResult,
        architectureResult: archResult,
        sprintPlan,
        ciResult,
      },
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
