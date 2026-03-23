import { createLogger } from "@prometheus/logger";
import {
  type AgentExecutionEvent,
  inngest,
  TIER_CONCURRENCY_LIMITS,
  type WorkflowContext,
} from "../inngest";
import type {
  AgentExecutionWorkflowOutput,
  ApprovalResult,
  ExecutionResult,
  PlanStep,
  PRResult,
  ReviewResult,
} from "./agent-execution";
import { runCILoop } from "./phases/ci-loop";
import { runCodingStep } from "./phases/coding";
import { runDiscovery } from "./phases/discovery";
import { runReviewPhase } from "./phases/review";
import { runSecurityPhase } from "./phases/security";
import { runTestingPhase } from "./phases/testing";

const logger = createLogger("workflow:agent-execution");

const RETRY_CONFIG = { retries: 3 as const };

const JSON_ARRAY_RE = /\[[\s\S]*\]/;

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";
const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

interface CodingContext {
  orchestratorUrl: string;
  orgId: string;
  projectId: string;
  sessionId: string;
  taskId: string;
}

async function generatePlan(
  taskId: string,
  taskDescription: string,
  relevantFiles: string[],
  agentRole: string | undefined
): Promise<PlanStep[]> {
  logger.info({ taskId }, "Phase: Planning");

  try {
    const response = await fetch(`${MODEL_ROUTER_URL}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot: "default",
        messages: [
          {
            role: "system",
            content:
              "You are a planning agent. Break the task into steps. Return JSON array with id, title, description, agentRole, estimatedTokens.",
          },
          {
            role: "user",
            content: `Task: ${taskDescription}\nRelevant files: ${relevantFiles.join(", ")}`,
          },
        ],
        options: { maxTokens: 4096 },
      }),
    });

    if (response.ok) {
      const steps = parsePlanResponse(await response.json(), taskId, agentRole);
      if (steps) {
        return steps;
      }
    }
  } catch (error) {
    logger.warn(
      { taskId, error: String(error) },
      "LLM planning failed, using single-step plan"
    );
  }

  return [
    {
      id: `${taskId}-step-1`,
      title: "Implement changes",
      description: taskDescription,
      agentRole: agentRole ?? "coder",
      estimatedTokens: 5000,
    },
  ] satisfies PlanStep[];
}

function parsePlanResponse(
  data: unknown,
  taskId: string,
  agentRole: string | undefined
): PlanStep[] | null {
  const typed = data as {
    content?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = typed.content ?? typed.choices?.[0]?.message?.content ?? "";
  const jsonMatch = content.match(JSON_ARRAY_RE);
  if (!jsonMatch) {
    return null;
  }
  const parsed = JSON.parse(jsonMatch[0]) as Array<{
    id?: string;
    title: string;
    description: string;
    agentRole?: string;
    estimatedTokens?: number;
    dependencies?: string[];
  }>;
  return parsed.map((s, i) => ({
    id: s.id ?? `${taskId}-step-${i + 1}`,
    title: s.title,
    description: s.description,
    agentRole: s.agentRole ?? agentRole ?? "coder",
    estimatedTokens: s.estimatedTokens ?? 5000,
    dependencies: s.dependencies,
  }));
}

function selectReadySteps(
  remainingSteps: PlanStep[],
  completedStepIds: Set<string>
): PlanStep[] {
  const readySteps = remainingSteps.filter((s) => {
    const deps = (s as PlanStep & { dependencies?: string[] }).dependencies;
    return (
      !deps ||
      deps.length === 0 ||
      deps.every((depId) => completedStepIds.has(depId))
    );
  });
  return readySteps.length > 0 ? readySteps : [remainingSteps[0] as PlanStep];
}

async function executeSingleStep(
  step: WorkflowContext<AgentExecutionEvent>["step"],
  ctx: CodingContext,
  planStep: PlanStep,
  taskId: string,
  sessionId: string
): Promise<ExecutionResult> {
  const result = await step.run(`coding-${planStep.id}`, () =>
    runCodingStep(ctx, planStep)
  );

  await step.sendEvent(`coding-step-completed-${planStep.id}`, {
    name: "prometheus/agent.step.completed",
    data: {
      taskId,
      sessionId,
      stepId: planStep.id,
      phase: "coding",
      success: result.success,
      output: result.output,
      filesChanged: result.filesChanged,
      tokensUsed: result.tokensUsed,
    },
  });

  return result;
}

function settledToResult(
  settled: PromiseSettledResult<ExecutionResult> | undefined,
  planStep: PlanStep
): ExecutionResult {
  if (settled && settled.status === "fulfilled") {
    return settled.value;
  }
  const errorMsg =
    settled && settled.status === "rejected"
      ? String(settled.reason)
      : "Unknown error";
  return {
    stepId: planStep.id,
    success: false,
    output: errorMsg,
    filesChanged: [],
    tokensUsed: { input: 0, output: 0 },
    error: errorMsg,
  };
}

async function executeParallelSteps(
  step: WorkflowContext<AgentExecutionEvent>["step"],
  ctx: CodingContext,
  stepsToExecute: PlanStep[],
  taskId: string,
  sessionId: string
): Promise<Array<{ stepId: string; result: ExecutionResult }>> {
  logger.info(
    { taskId, parallelCount: stepsToExecute.length },
    "Executing steps in parallel"
  );

  const parallelResults = await Promise.allSettled(
    stepsToExecute.map((planStep) =>
      step.run(`coding-${planStep.id}`, () => runCodingStep(ctx, planStep))
    )
  );

  const results: Array<{ stepId: string; result: ExecutionResult }> = [];
  for (let idx = 0; idx < stepsToExecute.length; idx++) {
    const planStep = stepsToExecute[idx] as PlanStep;
    const result = settledToResult(parallelResults[idx], planStep);

    await step.sendEvent(`coding-step-completed-${planStep.id}`, {
      name: "prometheus/agent.step.completed",
      data: {
        taskId,
        sessionId,
        stepId: planStep.id,
        phase: "coding",
        success: result.success,
        output: result.output,
        filesChanged: result.filesChanged,
        tokensUsed: result.tokensUsed,
      },
    });

    results.push({ stepId: planStep.id, result });
  }

  return results;
}

export const agentExecutionWorkflow: ReturnType<typeof inngest.createFunction> =
  inngest.createFunction(
    {
      id: "agent-execution",
      name: "Agent Execution Pipeline",
      ...RETRY_CONFIG,
      triggers: [{ event: "prometheus/agent.execution.requested" }],
      concurrency: [{ limit: 10, key: "event.data.orgId" }],
      cancelOn: [
        {
          event: "prometheus/agent.execution.cancelled",
          match: "data.taskId",
        },
      ],
    },
    async ({ event, step }: WorkflowContext<AgentExecutionEvent>) => {
      const {
        taskId,
        sessionId,
        taskDescription,
        mode,
        agentRole,
        orgId,
        projectId,
      } = event.data;

      logger.info(
        { taskId, sessionId, mode, orgId },
        "Starting agent execution workflow"
      );

      // ── Phase 1: Discovery ──────────────────────────────────────────
      const discoveryResult = await step.run("discovery", () =>
        runDiscovery({
          taskId,
          taskDescription,
          projectId,
          orgId,
          projectBrainUrl: PROJECT_BRAIN_URL,
        })
      );

      await step.sendEvent("discovery-completed", {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: "discovery",
          phase: "discovery",
          success: true,
          output: `Discovered ${discoveryResult.relevantFiles.length} relevant files`,
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
        },
      });

      await step.sleep("post-discovery-backpressure", "1s");

      // ── Phase 2: Architecture ───────────────────────────────────────
      const architectureResult = await step.run("architecture", () => {
        logger.info({ taskId }, "Phase: Architecture");
        return {
          approach: "incremental" as const,
          affectedModules: discoveryResult.relevantFiles.map((f) =>
            f.split("/").slice(0, 3).join("/")
          ),
          estimatedComplexity: "medium" as const,
          discoveredFiles: discoveryResult.relevantFiles,
        };
      });

      await step.sendEvent("architecture-completed", {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: "architecture",
          phase: "architecture",
          success: true,
          output: `Architecture: ${architectureResult.approach}, ${architectureResult.affectedModules.length} modules`,
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
        },
      });

      await step.sleep("post-architecture-backpressure", "1s");

      // ── Phase 3: Planning (LLM-generated) ───────────────────────────
      const plan = await step.run("planning", () =>
        generatePlan(
          taskId,
          taskDescription,
          discoveryResult.relevantFiles,
          agentRole
        )
      );

      await step.sendEvent("planning-completed", {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: "planning",
          phase: "planning",
          success: true,
          output: `Generated plan with ${plan.length} steps`,
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
        },
      });

      // ── Phase 4: Approval (if supervised) ───────────────────────────
      let approval: ApprovalResult | null = null;
      if (mode === "supervised") {
        approval = (await step.waitForEvent("wait-for-approval", {
          event: "prometheus/agent.execution.approved",
          match: "data.taskId",
          timeout: "24h",
        })) as ApprovalResult | null;

        if (!approval) {
          logger.warn({ taskId }, "Approval timed out after 24h");
          return {
            success: false,
            plan,
            approval: null,
            executions: [],
            review: null,
            pr: null,
            totalCreditsConsumed: 0,
            totalTokensUsed: { input: 0, output: 0 },
          } satisfies AgentExecutionWorkflowOutput;
        }
      }

      // ── Phase 5: Coding (parallel where possible) ───────────────────
      const executions: ExecutionResult[] = [];
      const completedStepIds = new Set<string>();
      const remainingSteps = [...plan];
      const codingCtx = {
        taskId,
        sessionId,
        projectId,
        orgId,
        orchestratorUrl: ORCHESTRATOR_URL,
      };

      while (remainingSteps.length > 0) {
        const stepsToExecute = selectReadySteps(
          remainingSteps,
          completedStepIds
        );

        // Remove selected from remaining
        const selectedIds = new Set(stepsToExecute.map((s) => s.id));
        const nextRemaining = remainingSteps.filter(
          (s) => !selectedIds.has(s.id)
        );
        remainingSteps.length = 0;
        remainingSteps.push(...nextRemaining);

        if (stepsToExecute.length === 1) {
          const planStep = stepsToExecute[0] as PlanStep;
          const result = await executeSingleStep(
            step,
            codingCtx,
            planStep,
            taskId,
            sessionId
          );
          executions.push(result);
          completedStepIds.add(planStep.id);
          await step.sleep(`post-coding-${planStep.id}`, "500ms");
        } else {
          const results = await executeParallelSteps(
            step,
            codingCtx,
            stepsToExecute,
            taskId,
            sessionId
          );
          for (const r of results) {
            executions.push(r.result);
            completedStepIds.add(r.stepId);
          }
          await step.sleep("post-parallel-coding", "500ms");
        }
      }

      const allFilesChanged = executions.flatMap((e) => e.filesChanged);

      // ── Phase 6: Testing ────────────────────────────────────────────
      const testResult = await step.run("testing", () =>
        runTestingPhase({
          taskId,
          sessionId,
          projectId,
          orgId,
          filesChanged: allFilesChanged,
          testRunner: discoveryResult.codebaseContext.testRunner,
          orchestratorUrl: ORCHESTRATOR_URL,
        })
      );

      await step.sendEvent("testing-completed", {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: "testing",
          phase: "testing",
          success: testResult.passed,
          output: `Tests: ${testResult.testsRun} run, ${testResult.testsFailed} failed`,
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
        },
      });

      await step.sleep("post-testing-backpressure", "1s");

      // ── Phase 7: CI Loop ────────────────────────────────────────────
      const ciResult = await step.run("ci-loop", () =>
        runCILoop({
          taskId,
          sessionId,
          projectId,
          orgId,
          orchestratorUrl: ORCHESTRATOR_URL,
        })
      );

      await step.sendEvent("ci-completed", {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: "ci-loop",
          phase: "ci",
          success:
            ciResult.buildPassed &&
            ciResult.lintPassed &&
            ciResult.typecheckPassed,
          output: `CI: build=${ciResult.buildPassed}, lint=${ciResult.lintPassed}, typecheck=${ciResult.typecheckPassed} (${ciResult.iterations} iters)`,
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
        },
      });

      // ── Phase 8: Security ───────────────────────────────────────────
      const securityResult = await step.run("security", () =>
        runSecurityPhase({
          taskId,
          sessionId,
          projectId,
          orgId,
          filesChanged: allFilesChanged,
          orchestratorUrl: ORCHESTRATOR_URL,
        })
      );

      await step.sendEvent("security-completed", {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: "security",
          phase: "security",
          success: securityResult.passed,
          output: `Security: ${securityResult.vulnerabilities.length} vulns, ${securityResult.secretsFound} secrets`,
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
        },
      });

      // ── Phase 9: Review ─────────────────────────────────────────────
      const review: ReviewResult = await step.run("review", () =>
        runReviewPhase({
          taskId,
          sessionId,
          projectId,
          orgId,
          filesChanged: allFilesChanged,
          orchestratorUrl: ORCHESTRATOR_URL,
        })
      );

      // ── Phase 10: Deploy / PR ───────────────────────────────────────
      let pr: PRResult | null = null;
      if (
        review.passed &&
        testResult.passed &&
        ciResult.buildPassed &&
        securityResult.passed
      ) {
        pr = await step.run("deploy", () => {
          logger.info({ taskId }, "Phase: Deploy");
          return {
            url: "",
            number: 0,
            branch: "",
            title: taskDescription,
          } satisfies PRResult;
        });
      }

      // ── Aggregate results ───────────────────────────────────────────
      const totalTokens = executions.reduce(
        (acc, e) => ({
          input: acc.input + e.tokensUsed.input,
          output: acc.output + e.tokensUsed.output,
        }),
        { input: 0, output: 0 }
      );

      const output: AgentExecutionWorkflowOutput = {
        success: review.passed,
        plan,
        approval,
        executions,
        review,
        pr,
        totalCreditsConsumed: 0,
        totalTokensUsed: totalTokens,
      };

      logger.info(
        { taskId, success: output.success, steps: executions.length },
        "Agent execution workflow completed"
      );

      return output;
    }
  );

export function getConcurrencyForTier(tier: string): number {
  return TIER_CONCURRENCY_LIMITS[tier] ?? 1;
}
