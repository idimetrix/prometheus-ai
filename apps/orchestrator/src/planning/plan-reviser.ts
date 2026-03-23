import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import type { SprintPlan } from "../phases/planning";
import type { MCTSPlanResult } from "./mcts-planner";

const logger = createLogger("orchestrator:plan-reviser");

const TASK_HEADER_RE = /TASK-(\d+):\s*(.+?)(?:\n|$)/g;
const AGENT_RE = /Agent:\s*(\w+)/i;
const DEPS_RE = /Dependencies:\s*(.+?)(?:\n|$)/i;
const EFFORT_RE = /Effort:\s*(S|M|L|XL)/i;
const AC_RE = /Acceptance Criteria:([\s\S]*?)(?=\nTASK-|\n##|$)/i;
const TASK_ID_RE = /TASK-\d+/g;
const SPRINT_GOAL_RE = /SPRINT_GOAL[^\n]*\n(.+?)(?:\n|$)/i;
const WORKSTREAMS_RE = /PARALLEL_WORKSTREAMS[\s\S]*?(?=##|$)/i;
const CRITICAL_PATH_RE = /CRITICAL_PATH[\s\S]*?(?=##|$)/i;
const LIST_BULLET_PREFIX_RE = /^\s*[-*]\s*/;
const STRATEGY_RE = /STRATEGY:\s*(.+?)(?:\n|$)/i;
const CONFIDENCE_RE = /CONFIDENCE:\s*([\d.]+)/i;
const REASONING_RE = /REASONING:\s*([\s\S]*?)(?=\n(?:REUSABLE|STRATEGY|##)|$)/i;
const REUSABLE_RE =
  /REUSABLE_TASKS:([\s\S]*?)(?=\n(?:STRATEGY|CONFIDENCE|##)|$)/i;

const ROLE_MAP: Record<string, string> = {
  frontend: "frontend_coder",
  frontend_coder: "frontend_coder",
  backend: "backend_coder",
  backend_coder: "backend_coder",
  integration: "integration_coder",
  integration_coder: "integration_coder",
  test: "test_engineer",
  test_engineer: "test_engineer",
  deploy: "deploy_engineer",
  deploy_engineer: "deploy_engineer",
};

function parseAcceptanceCriteriaLines(
  block: string,
  acRegex: RegExp,
  bulletPrefixRegex: RegExp
): string[] {
  const acLines: string[] = [];
  const acMatch = block.match(acRegex);
  if (acMatch?.[1]) {
    for (const line of acMatch[1].split("\n")) {
      const cleaned = line.replace(bulletPrefixRegex, "").trim();
      if (cleaned.length > 0) {
        acLines.push(cleaned);
      }
    }
  }
  return acLines;
}

function parseTaskBlock(
  block: string,
  id: string,
  title: string
): SprintPlan["tasks"][number] {
  const agentMatch = block.match(AGENT_RE);
  const depsMatch = block.match(DEPS_RE);
  const effortMatch = block.match(EFFORT_RE);

  const depsStr = depsMatch?.[1]?.trim() ?? "none";
  const deps: string[] = [];
  if (depsStr.toLowerCase() !== "none") {
    const depIds = depsStr.match(TASK_ID_RE);
    if (depIds) {
      deps.push(...depIds);
    }
  }

  const acLines = parseAcceptanceCriteriaLines(
    block,
    AC_RE,
    LIST_BULLET_PREFIX_RE
  );

  return {
    id,
    title,
    description: title,
    agentRole:
      ROLE_MAP[agentMatch?.[1]?.toLowerCase() ?? "backend"] ?? "backend_coder",
    dependencies: deps,
    effort: (effortMatch?.[1]?.toUpperCase() ?? "M") as "S" | "M" | "L" | "XL",
    acceptanceCriteria:
      acLines.length > 0 ? acLines : [`${title} works correctly`],
  };
}

/** Trace of a failed execution attempt */
export interface FailedTrace {
  creditsConsumed: number;
  errorMessage: string;
  failedPhase: string;
  failedTaskId: string;
  filesChanged: string[];
  partialResults: Array<{ taskId: string; success: boolean; output: string }>;
}

/** Result of a plan revision */
export interface RevisionResult {
  backtrackDepth: number;
  confidence: number;
  reasoning: string;
  reusableWork: string[];
  revisedPlan: SprintPlan;
  strategy: string;
}

/**
 * PlanReviser enables backtracking when execution fails by selecting
 * the next-best strategy from the MCTS tree and generating a revised
 * sprint plan that incorporates lessons learned from the failure.
 *
 * It tracks exhausted strategies to avoid retrying failed approaches
 * and identifies reusable work from partial results so successful
 * tasks don't need re-execution.
 */
export class PlanReviser {
  private readonly exhaustedStrategies: Set<string>;
  private revisionCount: number;
  private readonly maxRevisions: number;

  constructor(maxRevisions = 3) {
    this.exhaustedStrategies = new Set();
    this.revisionCount = 0;
    this.maxRevisions = maxRevisions;
  }

  /**
   * Attempt to revise a failed plan by selecting the next-best strategy
   * from the MCTS tree and generating a new sprint plan.
   *
   * Returns null if all strategies are exhausted or max revisions reached.
   */
  async revise(
    agentLoop: AgentLoop,
    originalResult: MCTSPlanResult,
    failedTrace: FailedTrace,
    blueprint: string,
    taskDescription: string
  ): Promise<RevisionResult | null> {
    if (this.isExhausted()) {
      logger.warn(
        {
          revisionCount: this.revisionCount,
          maxRevisions: this.maxRevisions,
          exhaustedStrategies: [...this.exhaustedStrategies],
        },
        "Plan revision exhausted — no more strategies available"
      );
      return null;
    }

    // Mark the failed strategy as exhausted
    this.exhaustedStrategies.add(originalResult.selectedStrategy);

    logger.info(
      {
        failedStrategy: originalResult.selectedStrategy,
        failedPhase: failedTrace.failedPhase,
        failedTaskId: failedTrace.failedTaskId,
        errorMessage: failedTrace.errorMessage.slice(0, 200),
        exhaustedStrategies: [...this.exhaustedStrategies],
        revisionCount: this.revisionCount + 1,
      },
      "Starting plan revision — backtracking from failed strategy"
    );

    // Identify reusable work from partial results
    const reusableWork = this.identifyReusableWork(
      failedTrace,
      originalResult.selectedPlan
    );

    logger.debug(
      { reusableTaskIds: reusableWork, count: reusableWork.length },
      "Identified reusable work from partial results"
    );

    // Build the revision prompt with failure context and lessons learned
    const prompt = this.buildRevisionPrompt(
      originalResult,
      failedTrace,
      reusableWork,
      blueprint,
      taskDescription
    );

    // Ask the planner to generate a revised plan
    const result = await agentLoop.executeTask(prompt, "planner");

    // Parse the revision response
    const revision = this.parseRevisionResult(
      result.output,
      reusableWork,
      taskDescription
    );

    if (!revision) {
      logger.warn("Failed to parse revision result from planner output");
      return null;
    }

    this.revisionCount++;

    logger.info(
      {
        newStrategy: revision.strategy,
        confidence: revision.confidence,
        reusableWorkCount: revision.reusableWork.length,
        backtrackDepth: revision.backtrackDepth,
        revisionCount: this.revisionCount,
        taskCount: revision.revisedPlan.tasks.length,
      },
      "Plan revision complete"
    );

    return revision;
  }

  /** Check whether all revision attempts have been exhausted */
  isExhausted(): boolean {
    return this.revisionCount >= this.maxRevisions;
  }

  /** Get the number of revisions performed so far */
  getRevisionCount(): number {
    return this.revisionCount;
  }

  /**
   * Identify tasks from the partial results that completed successfully
   * and can be reused in the revised plan.
   */
  private identifyReusableWork(
    failedTrace: FailedTrace,
    originalPlan: SprintPlan
  ): string[] {
    const reusable: string[] = [];

    for (const partial of failedTrace.partialResults) {
      if (!partial.success) {
        continue;
      }

      // Verify the task exists in the original plan
      const originalTask = originalPlan.tasks.find(
        (t) => t.id === partial.taskId
      );
      if (!originalTask) {
        continue;
      }

      // A successful task is reusable only if it does not depend on the
      // failed task (which would make its output potentially invalid)
      const dependsOnFailed = this.taskDependsOnFailed(
        partial.taskId,
        failedTrace.failedTaskId,
        originalPlan
      );

      if (!dependsOnFailed) {
        reusable.push(partial.taskId);
      }
    }

    return reusable;
  }

  /**
   * Check whether a task is or transitively depends on the failed task.
   */
  private taskDependsOnFailed(
    taskId: string,
    failedTaskId: string,
    plan: SprintPlan
  ): boolean {
    if (taskId === failedTaskId) {
      return true;
    }

    const task = plan.tasks.find((t) => t.id === taskId);
    if (!task) {
      return false;
    }

    for (const depId of task.dependencies) {
      if (depId === failedTaskId) {
        return true;
      }
      if (this.taskDependsOnFailed(depId, failedTaskId, plan)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Build the prompt for the planner agent to generate a revised plan.
   */
  private buildRevisionPrompt(
    originalResult: MCTSPlanResult,
    failedTrace: FailedTrace,
    reusableWork: string[],
    blueprint: string,
    taskDescription: string
  ): string {
    const exhaustedList = [...this.exhaustedStrategies].join(", ");
    const reusableList =
      reusableWork.length > 0 ? reusableWork.join(", ") : "none";

    const partialSummary = failedTrace.partialResults
      .map(
        (r) =>
          `  - ${r.taskId}: ${r.success ? "SUCCESS" : "FAILED"} — ${r.output.slice(0, 100)}`
      )
      .join("\n");

    const filesChangedList =
      failedTrace.filesChanged.length > 0
        ? failedTrace.filesChanged.join(", ")
        : "none";

    return `You are revising a failed sprint plan. The previous strategy failed and you must select a DIFFERENT approach.

## FAILURE CONTEXT
- Failed strategy: "${originalResult.selectedStrategy}"
- Failed phase: ${failedTrace.failedPhase}
- Failed task: ${failedTrace.failedTaskId}
- Error: ${failedTrace.errorMessage}
- Credits consumed: ${failedTrace.creditsConsumed}
- Files already changed: ${filesChangedList}

## PARTIAL RESULTS
${partialSummary || "No partial results available."}

## REUSABLE WORK
These tasks completed successfully and their output can be preserved:
${reusableList}

## EXHAUSTED STRATEGIES (DO NOT USE THESE)
${exhaustedList}

## ORIGINAL TASK
${taskDescription}

## BLUEPRINT
${blueprint.slice(0, 4000)}

## INSTRUCTIONS
1. Choose a NEW strategy that avoids the failure mode described above
2. Incorporate lessons from the failure into the revised plan
3. Preserve reusable work — do not re-execute tasks that already succeeded
4. Address the root cause of the failure in the new approach

Respond with this EXACT format:

STRATEGY: <new strategy name>
CONFIDENCE: <0.0-1.0 confidence score>
REASONING: <explain why this strategy avoids the previous failure>

REUSABLE_TASKS:
${reusableWork.map((id) => `- ${id}: preserved from previous run`).join("\n") || "- none"}

## SPRINT_GOAL
A single sentence describing the revised deliverable.

## TASKS
For each task:
TASK-<number>: <title>
- Description: <what needs to be done>
- Agent: <frontend_coder|backend_coder|integration_coder|test_engineer|deploy_engineer>
- Dependencies: <TASK-N ids or "none">
- Effort: <S|M|L|XL>
- Acceptance Criteria:
  - <criterion>

## PARALLEL_WORKSTREAMS
- Stream 1: TASK-1, TASK-2
- Stream 2: TASK-3

## CRITICAL_PATH
TASK-1 -> TASK-3 -> TASK-5`;
  }

  /**
   * Parse the planner's output into a RevisionResult.
   */
  private parseRevisionResult(
    output: string,
    fallbackReusable: string[],
    fallbackTitle: string
  ): RevisionResult | null {
    // Extract strategy
    const strategyMatch = output.match(STRATEGY_RE);
    const strategy = strategyMatch?.[1]?.trim() ?? "revised-approach";

    // Reject if the planner suggested an already-exhausted strategy
    if (this.exhaustedStrategies.has(strategy)) {
      logger.warn(
        { strategy },
        "Planner suggested an exhausted strategy — rejecting revision"
      );
      return null;
    }

    // Extract confidence
    const confidenceMatch = output.match(CONFIDENCE_RE);
    const confidence = confidenceMatch?.[1]
      ? Math.min(1, Math.max(0, Number.parseFloat(confidenceMatch[1])))
      : 0.5;

    // Extract reasoning
    const reasoningMatch = output.match(REASONING_RE);
    const reasoning =
      reasoningMatch?.[1]?.trim() ??
      "Revised approach to avoid previous failure";

    // Extract reusable tasks from response
    const reusableMatch = output.match(REUSABLE_RE);
    const reusable: string[] = [];
    if (reusableMatch?.[1]) {
      const ids = reusableMatch[1].match(TASK_ID_RE);
      if (ids) {
        reusable.push(...ids);
      }
    }
    const reusableWork = reusable.length > 0 ? reusable : fallbackReusable;

    // Parse the sprint plan from the output
    const plan = this.parsePlanFromOutput(output, fallbackTitle);

    if (plan.tasks.length === 0) {
      return null;
    }

    return {
      revisedPlan: plan,
      strategy,
      confidence,
      reasoning,
      reusableWork,
      backtrackDepth: this.revisionCount + 1,
    };
  }

  /**
   * Parse a sprint plan from LLM output. Mirrors the parsing logic
   * in MCTSPlanner for consistency.
   */
  private parsePlanFromOutput(
    output: string,
    fallbackTitle: string
  ): SprintPlan {
    const tasks: SprintPlan["tasks"] = [];

    TASK_HEADER_RE.lastIndex = 0;
    let match: RegExpExecArray | null = TASK_HEADER_RE.exec(output);
    while (match !== null) {
      const id = `TASK-${match[1]}`;
      const title = match[2]?.trim() ?? "";

      const startPos = match.index + match[0].length;
      const nextTask = output.indexOf("TASK-", startPos);
      const nextSection = output.indexOf("##", startPos);
      const endPos = Math.min(
        nextTask > -1 ? nextTask : output.length,
        nextSection > -1 ? nextSection : output.length
      );
      const block = output.slice(startPos, endPos);

      tasks.push(parseTaskBlock(block, id, title));
      match = TASK_HEADER_RE.exec(output);
    }

    if (tasks.length === 0) {
      tasks.push({
        id: "TASK-1",
        title: fallbackTitle,
        description: fallbackTitle,
        agentRole: "backend_coder",
        dependencies: [],
        effort: "M",
        acceptanceCriteria: ["Feature implemented"],
      });
    }

    // Extract parallel workstreams
    const workstreams: string[][] = [];
    const wsSection = output.match(WORKSTREAMS_RE);
    if (wsSection) {
      for (const line of wsSection[0].split("\n")) {
        const ids = line.match(TASK_ID_RE);
        if (ids && ids.length > 0) {
          workstreams.push(ids);
        }
      }
    }

    // Extract critical path
    const cpSection = output.match(CRITICAL_PATH_RE);
    const criticalPath = cpSection
      ? (cpSection[0].match(TASK_ID_RE) ?? [])
      : [];

    // Extract goal
    const goalMatch = output.match(SPRINT_GOAL_RE);

    return {
      sprintGoal: goalMatch?.[1]?.trim() ?? fallbackTitle,
      tasks,
      parallelWorkstreams: workstreams,
      criticalPath,
      riskMitigations: [],
    };
  }
}
