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
  riskMitigations: Array<{ risk: string; mitigation: string }>;
}

/**
 * PlanningPhase runs the Planner agent to create a sprint plan from
 * the architecture blueprint. It generates a task breakdown with
 * dependencies, effort estimates, and parallel workstream identification.
 */
export class PlanningPhase {

  async execute(agentLoop: AgentLoop, blueprint: string): Promise<SprintPlan> {
    logger.info("Starting Planning phase");

    const result = await agentLoop.executeTask(
      this.buildPlanningPrompt(blueprint),
      "planner"
    );

    const plan = this.parseSprintPlan(result.output);

    logger.info({
      taskCount: plan.tasks.length,
      workstreams: plan.parallelWorkstreams.length,
      criticalPathLength: plan.criticalPath.length,
    }, "Planning phase complete");

    return plan;
  }

  private buildPlanningPrompt(blueprint: string): string {
    return `Based on the following Blueprint, create a detailed 2-week sprint plan.

Blueprint:
${blueprint}

Generate a sprint plan with the following structure:

## SPRINT_GOAL
A single sentence describing the primary deliverable.

## TASKS
For each task, use this exact format:

TASK-<number>: <title>
- Description: <what needs to be done>
- Agent: <one of: frontend_coder, backend_coder, integration_coder, test_engineer, deploy_engineer>
- Dependencies: <comma-separated TASK-N ids, or "none">
- Effort: <S|M|L|XL>
- Acceptance Criteria:
  - <criterion 1>
  - <criterion 2>

## PARALLEL_WORKSTREAMS
Group task IDs that can run simultaneously:
- Stream 1: TASK-1, TASK-2
- Stream 2: TASK-3, TASK-4

## CRITICAL_PATH
The sequence of tasks on the critical path:
TASK-1 -> TASK-3 -> TASK-5 -> TASK-7

## RISK_MITIGATIONS
- Risk: <risk description>
  Mitigation: <mitigation strategy>

Rules:
1. Backend database/schema tasks come before API tasks
2. API tasks come before frontend integration tasks
3. Frontend component tasks can run in parallel with backend tasks
4. Integration tasks depend on both frontend and backend
5. Test tasks can start after their target feature is implemented
6. Deploy tasks come last
7. Maximize parallel workstreams to minimize total time
8. Every task must have at least one acceptance criterion`;
  }

  /**
   * Parse the planner agent's output into a structured SprintPlan.
   */
  private parseSprintPlan(output: string): SprintPlan {
    return {
      sprintGoal: this.extractSprintGoal(output),
      tasks: this.extractTasks(output),
      parallelWorkstreams: this.extractParallelWorkstreams(output),
      criticalPath: this.extractCriticalPath(output),
      riskMitigations: this.extractRiskMitigations(output),
    };
  }

  private extractSprintGoal(output: string): string {
    const match = output.match(/##\s*SPRINT_GOAL[^\n]*\n([\s\S]*?)(?=##|$)/i);
    if (match?.[1]) {
      return match[1].trim().split("\n")[0]?.trim() ?? "Complete sprint tasks";
    }
    return "Complete sprint tasks";
  }

  private extractTasks(output: string): SprintPlan["tasks"] {
    const tasks: SprintPlan["tasks"] = [];
    const taskRegex = /TASK-(\d+):\s*(.+?)(?:\n|$)/g;
    let match;

    const taskSection = this.getSection(output, "TASKS");

    while ((match = taskRegex.exec(taskSection)) !== null) {
      const id = `TASK-${match[1]}`;
      const title = match[2]?.trim() ?? "";

      // Extract the block for this task
      const startPos = match.index + match[0].length;
      const nextTask = taskSection.indexOf("TASK-", startPos);
      const nextSection = taskSection.indexOf("##", startPos);
      const endPos = Math.min(
        nextTask > -1 ? nextTask : taskSection.length,
        nextSection > -1 ? nextSection : taskSection.length,
      );
      const block = taskSection.slice(startPos, endPos);

      // Parse fields
      const descMatch = block.match(/Description:\s*(.+?)(?=\n\s*-|\n\s*Agent|$)/is);
      const agentMatch = block.match(/Agent:\s*(\w+)/i);
      const depsMatch = block.match(/Dependencies:\s*(.+?)(?=\n|$)/i);
      const effortMatch = block.match(/Effort:\s*(S|M|L|XL)/i);

      // Parse acceptance criteria
      const acSection = block.match(/Acceptance Criteria:([\s\S]*?)(?=\nTASK-|\n##|$)/i);
      const acceptanceCriteria: string[] = [];
      if (acSection?.[1]) {
        const lines = acSection[1].split("\n");
        for (const line of lines) {
          const criterion = line.replace(/^\s*[-*]\s*/, "").trim();
          if (criterion.length > 0) {
            acceptanceCriteria.push(criterion);
          }
        }
      }

      // Parse dependencies
      const depsStr = depsMatch?.[1]?.trim() ?? "none";
      const dependencies: string[] = [];
      if (depsStr.toLowerCase() !== "none") {
        const depMatches = depsStr.match(/TASK-\d+/g);
        if (depMatches) {
          dependencies.push(...depMatches);
        }
      }

      // Map agent name to role
      const agentRaw = agentMatch?.[1]?.toLowerCase() ?? "backend_coder";
      const agentRole = this.normalizeAgentRole(agentRaw);

      tasks.push({
        id,
        title,
        description: descMatch?.[1]?.trim() ?? title,
        agentRole,
        dependencies,
        effort: (effortMatch?.[1]?.toUpperCase() ?? "M") as "S" | "M" | "L" | "XL",
        acceptanceCriteria: acceptanceCriteria.length > 0
          ? acceptanceCriteria
          : [`${title} is implemented and working`],
      });
    }

    // If no tasks were parsed, create a default task
    if (tasks.length === 0 && output.length > 100) {
      tasks.push({
        id: "TASK-1",
        title: "Implement feature",
        description: "Implement the requested feature based on the blueprint",
        agentRole: "backend_coder",
        dependencies: [],
        effort: "M",
        acceptanceCriteria: ["Feature is implemented and passing tests"],
      });
    }

    return tasks;
  }

  private extractParallelWorkstreams(output: string): string[][] {
    const workstreams: string[][] = [];
    const section = this.getSection(output, "PARALLEL_WORKSTREAMS");
    if (!section) return workstreams;

    const lines = section.split("\n");
    for (const line of lines) {
      const taskIds = line.match(/TASK-\d+/g);
      if (taskIds && taskIds.length > 0) {
        workstreams.push(taskIds);
      }
    }

    return workstreams;
  }

  private extractCriticalPath(output: string): string[] {
    const section = this.getSection(output, "CRITICAL_PATH");
    if (!section) return [];

    const taskIds = section.match(/TASK-\d+/g);
    return taskIds ?? [];
  }

  private extractRiskMitigations(output: string): SprintPlan["riskMitigations"] {
    const mitigations: SprintPlan["riskMitigations"] = [];
    const section = this.getSection(output, "RISK_MITIGATIONS");
    if (!section) return mitigations;

    const riskRegex = /Risk:\s*(.+?)(?:\n|$)/gi;
    let match;

    while ((match = riskRegex.exec(section)) !== null) {
      const risk = match[1]?.trim() ?? "";
      const mitigationStart = match.index + match[0].length;
      const nextRisk = section.indexOf("Risk:", mitigationStart);
      const blockEnd = nextRisk > -1 ? nextRisk : section.length;
      const block = section.slice(mitigationStart, blockEnd);

      const mitMatch = block.match(/Mitigation:\s*(.+?)(?=\n\s*-|\n\s*Risk:|$)/is);
      const mitigation = mitMatch?.[1]?.trim() ?? "";

      if (risk) {
        mitigations.push({ risk, mitigation });
      }
    }

    return mitigations;
  }

  private getSection(output: string, name: string): string {
    const patterns = [
      new RegExp(`##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=##|$)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return output; // Fallback: search the entire output
  }

  private normalizeAgentRole(raw: string): string {
    const roleMap: Record<string, string> = {
      frontend: "frontend_coder",
      frontend_coder: "frontend_coder",
      backend: "backend_coder",
      backend_coder: "backend_coder",
      integration: "integration_coder",
      integration_coder: "integration_coder",
      test: "test_engineer",
      test_engineer: "test_engineer",
      tester: "test_engineer",
      deploy: "deploy_engineer",
      deploy_engineer: "deploy_engineer",
      devops: "deploy_engineer",
      security: "security_auditor",
      security_auditor: "security_auditor",
    };

    return roleMap[raw] ?? "backend_coder";
  }
}
