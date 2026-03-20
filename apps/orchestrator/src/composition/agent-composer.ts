import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { CapabilityRequirement, TaskAnalysis } from "./task-analyzer";

const logger = createLogger("orchestrator:agent-composer");

export interface AgentAssignment {
  agentRole: string;
  dependencies: string[];
  description: string;
  estimatedTokens: number;
  id: string;
  modelSlot: string;
}

export interface ExecutionPlan {
  assignments: AgentAssignment[];
  crossCuttingContext: string;
  estimatedCost: number;
  estimatedDuration: string;
  mode: "single" | "sequential" | "parallel" | "fleet";
  waves: AgentAssignment[][];
}

const CAPABILITY_TO_ROLE: Record<string, { role: string; modelSlot: string }> =
  {
    backend: { role: "backend_coder", modelSlot: "default" },
    database: { role: "architect", modelSlot: "think" },
    deploy: { role: "deploy_engineer", modelSlot: "default" },
    documentation: { role: "documentation", modelSlot: "longContext" },
    frontend: { role: "frontend_coder", modelSlot: "default" },
    infrastructure: { role: "deploy_engineer", modelSlot: "default" },
    security: { role: "security_auditor", modelSlot: "think" },
    test: { role: "test_engineer", modelSlot: "default" },
  };

/** Cost per 1K tokens in USD (rough estimate for planning) */
const COST_PER_1K_TOKENS = 0.003;

/** Rough ms-per-token for duration estimation */
const MS_PER_TOKEN = 15;

/**
 * Defines the execution ordering between agent roles.
 * An entry `[A, B]` means role A must run before role B.
 */
const ROLE_ORDERING: [string, string][] = [
  ["architect", "frontend_coder"],
  ["architect", "backend_coder"],
  ["architect", "deploy_engineer"],
  ["frontend_coder", "test_engineer"],
  ["backend_coder", "test_engineer"],
  ["test_engineer", "deploy_engineer"],
  ["security_auditor", "deploy_engineer"],
];

export class AgentComposer {
  compose(analysis: TaskAnalysis): ExecutionPlan {
    const assignments: AgentAssignment[] = [];

    // Map each capability to an agent assignment
    for (const capability of analysis.capabilities) {
      const assignment = this.createAssignment(capability);
      assignments.push(assignment);
    }

    // Add architecture review if required and not already present
    if (
      analysis.requiresArchitectureReview &&
      !assignments.some((a) => a.agentRole === "architect")
    ) {
      assignments.unshift({
        agentRole: "architect",
        dependencies: [],
        description: "Architecture review for cross-cutting task",
        estimatedTokens: 6000,
        id: generateId("asgn"),
        modelSlot: "think",
      });
    }

    // Add security audit for high-complexity tasks if not already present
    if (
      analysis.estimatedTotalComplexity === "high" &&
      !assignments.some((a) => a.agentRole === "security_auditor")
    ) {
      assignments.push({
        agentRole: "security_auditor",
        dependencies: [],
        description: "Security audit for high-complexity task",
        estimatedTokens: 4000,
        id: generateId("asgn"),
        modelSlot: "think",
      });
    }

    // Build dependency edges between assignments based on role ordering
    this.resolveDependencies(assignments);

    // Compute topologically sorted parallel waves
    const waves = this.buildWaves(assignments);

    const crossCuttingContext = this.buildCrossCuttingContext(analysis);
    const estimatedCost = this.estimateCost(assignments);
    const estimatedDuration = this.estimateDuration(waves);

    const plan: ExecutionPlan = {
      assignments,
      crossCuttingContext,
      estimatedCost,
      estimatedDuration,
      mode: analysis.suggestedMode,
      waves,
    };

    logger.info(
      {
        assignmentCount: assignments.length,
        estimatedCost: estimatedCost.toFixed(4),
        estimatedDuration,
        mode: plan.mode,
        waveCount: waves.length,
      },
      "Execution plan composed"
    );

    return plan;
  }

  private createAssignment(capability: CapabilityRequirement): AgentAssignment {
    const mapping = CAPABILITY_TO_ROLE[capability.capability] ?? {
      modelSlot: "default",
      role: "backend_coder",
    };

    return {
      agentRole: mapping.role,
      dependencies: [],
      description: capability.description,
      estimatedTokens: capability.estimatedTokens,
      id: generateId("asgn"),
      modelSlot: mapping.modelSlot,
    };
  }

  private resolveDependencies(assignments: AgentAssignment[]): void {
    for (const [beforeRole, afterRole] of ROLE_ORDERING) {
      const beforeAssignments = assignments.filter(
        (a) => a.agentRole === beforeRole
      );
      const afterAssignments = assignments.filter(
        (a) => a.agentRole === afterRole
      );

      for (const after of afterAssignments) {
        for (const before of beforeAssignments) {
          if (!after.dependencies.includes(before.id)) {
            after.dependencies.push(before.id);
          }
        }
      }
    }
  }

  private buildWaves(assignments: AgentAssignment[]): AgentAssignment[][] {
    const waves: AgentAssignment[][] = [];
    const placed = new Set<string>();
    const remaining = new Set(assignments.map((a) => a.id));

    while (remaining.size > 0) {
      const wave: AgentAssignment[] = [];

      for (const assignment of assignments) {
        if (!remaining.has(assignment.id)) {
          continue;
        }

        const depsResolved = assignment.dependencies.every((dep) =>
          placed.has(dep)
        );

        if (depsResolved) {
          wave.push(assignment);
        }
      }

      if (wave.length === 0) {
        // Circular dependency safety — break the cycle by forcing remaining into a wave
        logger.warn(
          { remainingCount: remaining.size },
          "Circular dependency detected in assignment graph, forcing remaining assignments into final wave"
        );

        for (const assignment of assignments) {
          if (remaining.has(assignment.id)) {
            wave.push(assignment);
          }
        }
      }

      for (const a of wave) {
        placed.add(a.id);
        remaining.delete(a.id);
      }

      waves.push(wave);
    }

    return waves;
  }

  private estimateCost(assignments: AgentAssignment[]): number {
    const totalTokens = assignments.reduce(
      (sum, a) => sum + a.estimatedTokens,
      0
    );
    return (totalTokens / 1000) * COST_PER_1K_TOKENS;
  }

  private estimateDuration(waves: AgentAssignment[][]): string {
    // For each wave, the duration is the max token count (parallel execution).
    // Total duration is the sum of wave durations.
    let totalMs = 0;

    for (const wave of waves) {
      const maxTokens = Math.max(...wave.map((a) => a.estimatedTokens));
      totalMs += maxTokens * MS_PER_TOKEN;
    }

    const totalSeconds = Math.ceil(totalMs / 1000);

    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (seconds === 0) {
      return `${minutes}m`;
    }

    return `${minutes}m ${seconds}s`;
  }

  private buildCrossCuttingContext(analysis: TaskAnalysis): string {
    if (analysis.crossCuttingConcerns.length === 0) {
      return "";
    }

    const lines = [
      "Cross-cutting concerns that all agents must consider:",
      ...analysis.crossCuttingConcerns.map((concern) => `- ${concern}`),
      "",
      `Overall complexity: ${analysis.estimatedTotalComplexity}`,
      `Task summary: ${analysis.taskSummary}`,
    ];

    return lines.join("\n");
  }
}
