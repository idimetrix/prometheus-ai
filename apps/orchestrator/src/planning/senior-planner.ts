import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";

const _logger = createLogger("orchestrator:senior-planner");

export interface PlanningStep {
  description: string;
  name: string;
  output?: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface SeniorPlanResult {
  explorationFindings: string;
  impactAnalysis: {
    affectedFiles: string[];
    riskLevel: "low" | "medium" | "high";
    estimatedEffort: string;
  };
  plan: string;
  steps: PlanningStep[];
  understanding: string;
  validation: string;
}

/**
 * SeniorPlanner implements a 5-step planning process modeled after
 * how a senior engineer would approach a complex task:
 * 1. Understand - deeply comprehend the requirements
 * 2. Explore - map the relevant codebase
 * 3. Plan - create a detailed implementation plan
 * 4. Validate - verify the plan against constraints
 * 5. Execute - hand off to coding agents
 */
export class SeniorPlanner {
  private readonly eventPublisher = new EventPublisher();

  async plan(
    agentLoop: AgentLoop,
    taskDescription: string,
    blueprint: string
  ): Promise<SeniorPlanResult> {
    const steps: PlanningStep[] = [
      {
        name: "understand",
        description: "Understanding requirements",
        status: "pending",
      },
      { name: "explore", description: "Exploring codebase", status: "pending" },
      {
        name: "plan",
        description: "Creating implementation plan",
        status: "pending",
      },
      { name: "validate", description: "Validating plan", status: "pending" },
      { name: "impact", description: "Analyzing impact", status: "pending" },
    ];

    const sessionId = agentLoop.getSessionId();

    const stepUnderstand = steps[0];
    const stepExplore = steps[1];
    const stepPlan = steps[2];
    const stepValidate = steps[3];
    const stepImpact = steps[4];

    // Step 1: Understand
    if (stepUnderstand) {
      stepUnderstand.status = "running";
    }
    await this.publishProgress(sessionId, steps);

    const understanding = await agentLoop.executeTask(
      `As a senior engineer, deeply understand this task before writing any code.

Task: ${taskDescription}

Blueprint: ${blueprint.slice(0, 3000)}

Answer these questions:
1. What exactly is being asked? (restate in your own words)
2. What are the acceptance criteria?
3. What edge cases exist?
4. What could go wrong?
5. What assumptions are you making?

Be thorough. This understanding guides all subsequent work.`,
      "architect"
    );
    if (stepUnderstand) {
      stepUnderstand.status = "completed";
      stepUnderstand.output = understanding.output.slice(0, 500);
    }

    // Step 2: Explore
    if (stepExplore) {
      stepExplore.status = "running";
    }
    await this.publishProgress(sessionId, steps);

    const exploration = await agentLoop.executeTask(
      `Based on this understanding, explore the codebase to map what exists and what needs to change.

Understanding:
${understanding.output.slice(0, 2000)}

Actions:
1. Search for files related to this feature
2. Read the most relevant files
3. Map the dependency graph (what imports what)
4. Identify existing patterns to follow
5. Note any technical debt that affects this work

Report your findings structured as:
RELEVANT_FILES: <list>
DEPENDENCIES: <what depends on what>
PATTERNS: <existing patterns to follow>
TECH_DEBT: <any issues to be aware of>`,
      "architect"
    );
    if (stepExplore) {
      stepExplore.status = "completed";
      stepExplore.output = exploration.output.slice(0, 500);
    }

    // Step 3: Plan
    if (stepPlan) {
      stepPlan.status = "running";
    }
    await this.publishProgress(sessionId, steps);

    const plan = await agentLoop.executeTask(
      `Create a detailed implementation plan based on your understanding and exploration.

Understanding:
${understanding.output.slice(0, 1500)}

Exploration Findings:
${exploration.output.slice(0, 1500)}

Create a step-by-step plan with:
1. Files to create/modify (in order)
2. For each file: what changes and why
3. Database changes needed
4. API changes needed
5. Test strategy
6. Risk mitigation for each step

Be specific enough that another developer could follow this plan.`,
      "planner"
    );
    if (stepPlan) {
      stepPlan.status = "completed";
      stepPlan.output = plan.output.slice(0, 500);
    }

    // Step 4: Validate
    if (stepValidate) {
      stepValidate.status = "running";
    }
    await this.publishProgress(sessionId, steps);

    const validation = await agentLoop.executeTask(
      `Validate this implementation plan for completeness and correctness.

Plan:
${plan.output.slice(0, 2000)}

Check:
1. Does the plan address all requirements?
2. Are there missing steps?
3. Are dependencies in the right order?
4. Are there any architectural violations?
5. Is the test strategy sufficient?
6. What could go wrong?

Provide a GO/NO-GO recommendation with reasoning.`,
      "security_auditor"
    );
    if (stepValidate) {
      stepValidate.status = "completed";
      stepValidate.output = validation.output.slice(0, 500);
    }

    // Step 5: Impact Analysis
    if (stepImpact) {
      stepImpact.status = "running";
    }
    await this.publishProgress(sessionId, steps);

    const impactAnalysis = this.analyzeImpact(exploration.output, plan.output);
    if (stepImpact) {
      stepImpact.status = "completed";
    }

    await this.publishProgress(sessionId, steps);

    return {
      understanding: understanding.output,
      explorationFindings: exploration.output,
      plan: plan.output,
      validation: validation.output,
      impactAnalysis,
      steps,
    };
  }

  private analyzeImpact(
    exploration: string,
    plan: string
  ): SeniorPlanResult["impactAnalysis"] {
    // Extract file paths from exploration and plan
    const filePattern = /(?:[\w-]+\/)*[\w-]+\.(?:ts|tsx|js|jsx|json|yaml|yml)/g;
    const files = new Set<string>();

    for (const match of exploration.matchAll(filePattern)) {
      files.add(match[0]);
    }
    for (const match of plan.matchAll(filePattern)) {
      files.add(match[0]);
    }

    const affectedFiles = Array.from(files);

    let riskLevel: "low" | "medium" | "high" = "low";
    if (affectedFiles.length > 10) {
      riskLevel = "high";
    } else if (affectedFiles.length > 5) {
      riskLevel = "medium";
    }

    // Check for high-risk indicators
    const combined = `${exploration} ${plan}`.toLowerCase();
    if (
      combined.includes("migration") ||
      combined.includes("breaking change") ||
      combined.includes("schema change")
    ) {
      riskLevel = "high";
    }

    let estimatedEffort: string;
    if (affectedFiles.length <= 3) {
      estimatedEffort = "small";
    } else if (affectedFiles.length <= 8) {
      estimatedEffort = "medium";
    } else {
      estimatedEffort = "large";
    }

    return {
      affectedFiles,
      riskLevel,
      estimatedEffort,
    };
  }

  private async publishProgress(
    sessionId: string,
    steps: PlanningStep[]
  ): Promise<void> {
    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.PLAN_UPDATE,
      data: {
        event: "senior_planning_progress",
        steps: steps.map((s) => ({ name: s.name, status: s.status })),
        currentStep: steps.find((s) => s.status === "running")?.name,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
