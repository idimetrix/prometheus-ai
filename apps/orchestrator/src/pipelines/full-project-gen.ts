/**
 * GAP-061: Full Project Generation Pipeline
 *
 * Multi-phase pipeline: requirements -> architecture -> scaffold ->
 * implement -> test -> deploy. Coordinates multiple agent roles
 * for complete project creation.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:pipeline:full-project-gen");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectPhase =
  | "requirements"
  | "architecture"
  | "scaffold"
  | "implement"
  | "test"
  | "deploy"
  | "completed"
  | "failed";

export interface ProjectSpec {
  constraints?: string[];
  description: string;
  features: string[];
  name: string;
  stack: string[];
}

export interface PhaseResult {
  agentRole: string;
  durationMs: number;
  outputs: Record<string, unknown>;
  phase: ProjectPhase;
  status: "success" | "failed" | "skipped";
}

export interface ProjectGenerationState {
  completedAt?: number;
  currentPhase: ProjectPhase;
  error?: string;
  id: string;
  phaseResults: PhaseResult[];
  spec: ProjectSpec;
  startedAt: number;
}

type AgentFn = (
  role: string,
  prompt: string
) => Promise<{ content: string; success: boolean }>;

// ─── Full Project Generator ──────────────────────────────────────────────────

export class FullProjectGenerator {
  private readonly agentFn: AgentFn;
  private readonly projects = new Map<string, ProjectGenerationState>();

  constructor(agentFn: AgentFn) {
    this.agentFn = agentFn;
  }

  /**
   * Start a full project generation pipeline.
   */
  async generate(spec: ProjectSpec): Promise<ProjectGenerationState> {
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state: ProjectGenerationState = {
      id,
      spec,
      currentPhase: "requirements",
      phaseResults: [],
      startedAt: Date.now(),
    };
    this.projects.set(id, state);

    logger.info(
      { projectId: id, name: spec.name },
      "Starting full project generation"
    );

    const phases: Array<{
      phase: ProjectPhase;
      agentRole: string;
      buildPrompt: () => string;
    }> = [
      {
        phase: "requirements",
        agentRole: "product-manager",
        buildPrompt: () =>
          `Analyze and refine requirements for project "${spec.name}": ${spec.description}. Features: ${spec.features.join(", ")}. Stack: ${spec.stack.join(", ")}. Output a detailed requirements document.`,
      },
      {
        phase: "architecture",
        agentRole: "architect",
        buildPrompt: () =>
          `Design the architecture for "${spec.name}" using ${spec.stack.join(", ")}. Requirements: ${JSON.stringify(this.getPhaseOutput(state, "requirements"))}. Output architecture decisions, component diagram, and API contracts.`,
      },
      {
        phase: "scaffold",
        agentRole: "developer",
        buildPrompt: () =>
          `Scaffold the project structure for "${spec.name}". Architecture: ${JSON.stringify(this.getPhaseOutput(state, "architecture"))}. Create directory structure, config files, and package.json.`,
      },
      {
        phase: "implement",
        agentRole: "developer",
        buildPrompt: () =>
          `Implement the core features for "${spec.name}". Scaffold: ${JSON.stringify(this.getPhaseOutput(state, "scaffold"))}. Features to implement: ${spec.features.join(", ")}.`,
      },
      {
        phase: "test",
        agentRole: "tester",
        buildPrompt: () =>
          `Write comprehensive tests for "${spec.name}". Implementation: ${JSON.stringify(this.getPhaseOutput(state, "implement"))}. Include unit tests, integration tests, and edge cases.`,
      },
      {
        phase: "deploy",
        agentRole: "devops",
        buildPrompt: () =>
          `Create deployment configuration for "${spec.name}". Stack: ${spec.stack.join(", ")}. Generate Dockerfile, CI/CD config, and deployment scripts.`,
      },
    ];

    for (const phaseConfig of phases) {
      state.currentPhase = phaseConfig.phase;
      const startMs = Date.now();

      try {
        const result = await this.agentFn(
          phaseConfig.agentRole,
          phaseConfig.buildPrompt()
        );

        const phaseResult: PhaseResult = {
          phase: phaseConfig.phase,
          status: result.success ? "success" : "failed",
          outputs: { content: result.content },
          durationMs: Date.now() - startMs,
          agentRole: phaseConfig.agentRole,
        };

        state.phaseResults.push(phaseResult);

        if (!result.success) {
          state.currentPhase = "failed";
          state.error = `Phase ${phaseConfig.phase} failed`;
          state.completedAt = Date.now();

          logger.error(
            { projectId: id, phase: phaseConfig.phase },
            "Project generation phase failed"
          );
          return state;
        }

        logger.info(
          {
            projectId: id,
            phase: phaseConfig.phase,
            durationMs: phaseResult.durationMs,
          },
          "Phase completed successfully"
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        state.currentPhase = "failed";
        state.error = msg;
        state.completedAt = Date.now();

        logger.error(
          { projectId: id, phase: phaseConfig.phase, error: msg },
          "Phase threw an error"
        );
        return state;
      }
    }

    state.currentPhase = "completed";
    state.completedAt = Date.now();

    logger.info(
      {
        projectId: id,
        totalDurationMs: state.completedAt - state.startedAt,
        phases: state.phaseResults.length,
      },
      "Full project generation completed"
    );

    return state;
  }

  /**
   * Get the current state of a project generation.
   */
  getState(projectId: string): ProjectGenerationState | undefined {
    return this.projects.get(projectId);
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private getPhaseOutput(
    state: ProjectGenerationState,
    phase: ProjectPhase
  ): unknown {
    const result = state.phaseResults.find((r) => r.phase === phase);
    return result?.outputs ?? {};
  }
}
