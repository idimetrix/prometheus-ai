import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:planning");

export interface SprintPlan {
  sprintGoal: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    agentRole: string;
    dependencies: string[];
    effort: "S" | "M" | "L" | "XL";
    acceptanceCriteria: string[];
  }>;
  parallelWorkstreams: string[][];
  criticalPath: string[];
}

export class PlanningPhase {
  async execute(agentLoop: AgentLoop, blueprint: string): Promise<SprintPlan> {
    logger.info("Starting Planning phase");

    const result = await agentLoop.executeTask(
      `Based on the following Blueprint, create a 2-week sprint plan.

Blueprint:
${blueprint}

Generate:
1. Sprint goal (1 sentence)
2. Task list with: ID, title, description, assigned agent role, dependencies, effort estimate (S/M/L/XL), acceptance criteria
3. Identify parallel workstreams (tasks that can run simultaneously)
4. Identify the critical path
5. Risk items and mitigations

Assign tasks to these agent roles: frontend_coder, backend_coder, integration_coder, test_engineer, deploy_engineer`,
      "planner"
    );

    return {
      sprintGoal: "Complete sprint tasks",
      tasks: [],
      parallelWorkstreams: [],
      criticalPath: [],
    };
  }
}
