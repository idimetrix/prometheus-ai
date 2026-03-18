import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import { type CILoopResult, CILoopRunner } from "../ci-loop/ci-loop-runner";
import {
  ArchitecturePhase,
  type ArchitectureResult,
} from "../phases/architecture";
import { DiscoveryPhase, type DiscoveryResult } from "../phases/discovery";
import { PlanningPhase, type SprintPlan } from "../phases/planning";

const logger = createLogger("orchestrator:pipeline");

export type PipelinePhase =
  | "discovery"
  | "architecture"
  | "planning"
  | "scaffold"
  | "parallel_build"
  | "ci_loop"
  | "security"
  | "deploy";

export interface PipelineState {
  architectureResult: ArchitectureResult | null;
  ciLoopResult: CILoopResult | null;
  completedPhases: PipelinePhase[];
  currentPhase: PipelinePhase;
  discoveryResult: DiscoveryResult | null;
  error: string | null;
  sprintPlan: SprintPlan | null;
  startedAt: Date;
}

export class PhaseManager {
  private readonly state: PipelineState;
  private readonly discovery = new DiscoveryPhase();
  private readonly architecture = new ArchitecturePhase();
  private readonly planning = new PlanningPhase();
  private readonly ciLoop = new CILoopRunner();

  constructor() {
    this.state = {
      currentPhase: "discovery",
      completedPhases: [],
      discoveryResult: null,
      architectureResult: null,
      sprintPlan: null,
      ciLoopResult: null,
      startedAt: new Date(),
      error: null,
    };
  }

  async runPipeline(
    agentLoop: AgentLoop,
    prompt: string,
    preset?: string
  ): Promise<PipelineState> {
    try {
      // Phase 1: Discovery
      this.state.currentPhase = "discovery";
      logger.info("Phase 1: Discovery");
      const discoveryResult = await this.discovery.execute(agentLoop, prompt);
      this.state.discoveryResult = discoveryResult;

      if (!this.discovery.shouldProceed(discoveryResult)) {
        this.state.error = "Confidence too low, needs clarification";
        return this.state;
      }
      this.state.completedPhases.push("discovery");

      // Phase 2: Architecture
      this.state.currentPhase = "architecture";
      logger.info("Phase 2: Architecture");
      const archResult = await this.architecture.execute(
        agentLoop,
        discoveryResult.srs,
        preset
      );
      this.state.architectureResult = archResult;
      this.state.completedPhases.push("architecture");

      // Phase 3: Planning
      this.state.currentPhase = "planning";
      logger.info("Phase 3: Planning");
      const plan = await this.planning.execute(agentLoop, archResult.blueprint);
      this.state.sprintPlan = plan;
      this.state.completedPhases.push("planning");

      // Phase 4: Scaffold
      this.state.currentPhase = "scaffold";
      logger.info("Phase 4: Scaffold");
      await agentLoop.executeTask(
        "Create the project scaffold based on the Blueprint: project structure, configuration files, initial setup.",
        "backend_coder"
      );
      this.state.completedPhases.push("scaffold");

      // Phase 5: Parallel Build
      this.state.currentPhase = "parallel_build";
      logger.info("Phase 5: Parallel Build");
      for (const task of plan.tasks) {
        await agentLoop.executeTask(task.description, task.agentRole);
      }
      this.state.completedPhases.push("parallel_build");

      // Phase 6: CI Loop
      this.state.currentPhase = "ci_loop";
      logger.info("Phase 6: CI Loop");
      const ciResult = await this.ciLoop.run(agentLoop);
      this.state.ciLoopResult = ciResult;
      this.state.completedPhases.push("ci_loop");

      // Phase 7: Security
      this.state.currentPhase = "security";
      logger.info("Phase 7: Security Audit");
      await agentLoop.executeTask(
        "Perform a comprehensive security audit on all code changes.",
        "security_auditor"
      );
      this.state.completedPhases.push("security");

      // Phase 8: Deploy
      this.state.currentPhase = "deploy";
      logger.info("Phase 8: Deploy");
      await agentLoop.executeTask(
        "Generate deployment configuration: Dockerfiles, k8s manifests, CI/CD pipeline.",
        "deploy_engineer"
      );
      this.state.completedPhases.push("deploy");

      logger.info(
        { completedPhases: this.state.completedPhases.length },
        "Pipeline complete!"
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.state.error = msg;
      logger.error(
        { phase: this.state.currentPhase, error: msg },
        "Pipeline failed"
      );
    }

    return this.state;
  }

  getState(): PipelineState {
    return { ...this.state };
  }
}
