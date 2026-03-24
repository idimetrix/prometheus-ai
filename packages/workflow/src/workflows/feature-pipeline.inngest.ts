import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import {
  type FeaturePipelineEvent,
  inngest,
  type WorkflowContext,
} from "../inngest";

const logger = createLogger("workflow:feature-pipeline");

const RETRY_CONFIG = { retries: 3 as const };

const MAX_CI_ITERATIONS = 10;

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";

interface TaskAnalysisResult {
  capabilities: Array<{
    capability: string;
    complexity: string;
    description: string;
    estimatedTokens: number;
  }>;
  crossCuttingConcerns: string[];
  estimatedTotalComplexity: "low" | "medium" | "high";
  requiresArchitectureReview: boolean;
  suggestedMode: "single" | "sequential" | "parallel" | "fleet";
  taskSummary: string;
}

interface AgentAssignment {
  agentRole: string;
  dependencies: string[];
  description: string;
  estimatedTokens: number;
  id: string;
  modelSlot: string;
}

interface CompositionResult {
  assignments: AgentAssignment[];
  crossCuttingContext: string;
  estimatedCost: number;
  estimatedDuration: string;
  mode: "single" | "sequential" | "parallel" | "fleet";
  waves: AgentAssignment[][];
}

interface WaveExecutionResult {
  results: Array<{
    assignmentId: string;
    agentRole: string;
    success: boolean;
    output: string;
    filesChanged: string[];
    tokensUsed: { input: number; output: number };
  }>;
  waveIndex: number;
}

interface QualityCheckResult {
  filesReviewed: number;
  issues: string[];
  passed: boolean;
}

interface OrchestratorResponse {
  error?: string;
  filesChanged?: string[];
  output?: string;
  success: boolean;
  tokensUsed?: { input: number; output: number };
}

interface TestResult {
  output: string;
  passed: boolean;
  testsFailed: number;
  testsRun: number;
}

interface CIResult {
  buildPassed: boolean;
  iterations: number;
  lintPassed: boolean;
  output: string;
  typecheckPassed: boolean;
}

interface SecurityResult {
  passed: boolean;
  secretsFound: number;
  vulnerabilities: string[];
}

interface PRResult {
  branch: string;
  number: number;
  title: string;
  url: string;
}

interface ApprovalEvent {
  data: {
    taskId: string;
    approved: boolean;
    approvedBy: string;
    modifications?: string[];
  };
}

interface PipelineOutput {
  analysis: TaskAnalysisResult | null;
  ciResult: CIResult | null;
  composition: CompositionResult | null;
  pr: PRResult | null;
  securityResult: SecurityResult | null;
  success: boolean;
  taskId: string;
  testResult: TestResult | null;
  totalCreditsConsumed: number;
  totalTokensUsed: { input: number; output: number };
  waves: WaveExecutionResult[];
}

async function callOrchestrator(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<OrchestratorResponse> {
  const response = await fetch(`${ORCHESTRATOR_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Orchestrator returned ${response.status}: ${response.statusText}`
    );
  }

  return (await response.json()) as OrchestratorResponse;
}

export const featurePipelineWorkflow: ReturnType<
  typeof inngest.createFunction
> = inngest.createFunction(
  {
    id: "feature-pipeline",
    name: "Feature Pipeline",
    ...RETRY_CONFIG,
    triggers: [{ event: "prometheus/feature.pipeline.requested" }],
    concurrency: [{ limit: 5, key: "event.data.orgId" }],
    cancelOn: [
      {
        event: "prometheus/feature.pipeline.cancelled",
        match: "data.taskId",
      },
    ],
  },
  async ({ event, step }: WorkflowContext<FeaturePipelineEvent>) => {
    const {
      taskId,
      sessionId,
      projectId,
      orgId,
      userId,
      title,
      description,
      sourceChannel,
      maxCredits,
    } = event.data;

    logger.info(
      { taskId, sessionId, projectId, orgId, sourceChannel },
      "Starting feature pipeline"
    );

    const totalTokens = { input: 0, output: 0 };
    const creditsConsumed = 0;

    // ── Step 1: Analyze Task ────────────────────────────────────────
    const analysis = await step.run("analyze-task", async () => {
      logger.info({ taskId, title }, "Analyzing task");

      const result = await callOrchestrator("/analyze", {
        taskDescription: description,
        projectId,
        orgId,
      });

      if (!(result.success && result.output)) {
        throw new Error(`Task analysis failed: ${result.error ?? "unknown"}`);
      }

      try {
        return JSON.parse(result.output) as TaskAnalysisResult;
      } catch {
        throw new Error("Failed to parse task analysis output as JSON");
      }
    });

    await step.sendEvent("analysis-completed", {
      name: "prometheus/agent.step.completed",
      data: {
        taskId,
        sessionId,
        stepId: "analyze-task",
        phase: "analysis",
        success: true,
        output: `Analyzed: ${analysis.capabilities.length} capabilities, complexity=${analysis.estimatedTotalComplexity}`,
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
      },
    });

    await step.sleep("post-analysis-backpressure", "1s");

    // ── Step 2: Compose Agents ──────────────────────────────────────
    const composition = await step.run("compose-agents", async () => {
      logger.info(
        { taskId, mode: analysis.suggestedMode },
        "Composing agent execution plan"
      );

      const result = await callOrchestrator("/compose", {
        analysis,
        projectId,
        orgId,
      });

      if (!(result.success && result.output)) {
        throw new Error(
          `Agent composition failed: ${result.error ?? "unknown"}`
        );
      }

      try {
        return JSON.parse(result.output) as CompositionResult;
      } catch {
        throw new Error("Failed to parse composition output as JSON");
      }
    });

    await step.sendEvent("composition-completed", {
      name: "prometheus/agent.step.completed",
      data: {
        taskId,
        sessionId,
        stepId: "compose-agents",
        phase: "composition",
        success: true,
        output: `Plan: ${composition.waves.length} waves, ${composition.assignments.length} agents, mode=${composition.mode}`,
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
      },
    });

    // ── Step 3: Human Approval (if complex) ─────────────────────────
    const requiresApproval =
      analysis.estimatedTotalComplexity === "high" ||
      analysis.requiresArchitectureReview;

    if (requiresApproval) {
      await step.sendEvent("approval-requested", {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: "approval-request",
          phase: "approval",
          success: true,
          output: `Waiting for human approval. Complexity: ${analysis.estimatedTotalComplexity}, waves: ${composition.waves.length}`,
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
        },
      });

      const approval = (await step.waitForEvent("wait-for-approval", {
        event: "prometheus/agent.execution.approved",
        match: "data.taskId",
        timeout: "24h",
      })) as ApprovalEvent | null;

      if (!approval?.data.approved) {
        logger.warn(
          { taskId, timedOut: !approval },
          "Feature pipeline aborted: approval denied or timed out"
        );

        return {
          success: false,
          taskId,
          analysis,
          composition,
          waves: [],
          testResult: null,
          ciResult: null,
          securityResult: null,
          pr: null,
          totalCreditsConsumed: creditsConsumed,
          totalTokensUsed: totalTokens,
        } satisfies PipelineOutput;
      }

      logger.info(
        { taskId, approvedBy: approval.data.approvedBy },
        "Feature pipeline approved"
      );
    }

    await step.sleep("post-approval-backpressure", "1s");

    // ── Step 4: Execute Waves ───────────────────────────────────────
    const waveResults: WaveExecutionResult[] = [];
    const allFilesChanged: string[] = [];

    for (let waveIdx = 0; waveIdx < composition.waves.length; waveIdx++) {
      const wave = composition.waves[waveIdx];
      if (!wave || wave.length === 0) {
        continue;
      }

      // Check credit budget before each wave
      if (maxCredits !== undefined && creditsConsumed >= maxCredits) {
        logger.warn(
          { taskId, creditsConsumed, maxCredits },
          "Credit budget exhausted, stopping execution"
        );
        break;
      }

      const waveResult = await step.run(`execute-wave-${waveIdx}`, async () => {
        logger.info(
          { taskId, waveIndex: waveIdx, agentCount: wave.length },
          "Executing wave"
        );

        const results = await Promise.allSettled(
          wave.map((assignment) =>
            callOrchestrator("/execute", {
              assignmentId: assignment.id,
              agentRole: assignment.agentRole,
              description: assignment.description,
              modelSlot: assignment.modelSlot,
              estimatedTokens: assignment.estimatedTokens,
              crossCuttingContext: composition.crossCuttingContext,
              taskId,
              sessionId,
              projectId,
              orgId,
            })
          )
        );

        const waveResults: WaveExecutionResult["results"] = [];

        for (let i = 0; i < wave.length; i++) {
          const assignment = wave[i] as AgentAssignment;
          const settled = results[i];

          if (settled && settled.status === "fulfilled") {
            const res = settled.value;
            waveResults.push({
              assignmentId: assignment.id,
              agentRole: assignment.agentRole,
              success: res.success,
              output: res.output ?? "",
              filesChanged: res.filesChanged ?? [],
              tokensUsed: res.tokensUsed ?? { input: 0, output: 0 },
            });
          } else {
            const reason =
              settled && settled.status === "rejected"
                ? String(settled.reason)
                : "Unknown error";
            waveResults.push({
              assignmentId: assignment.id,
              agentRole: assignment.agentRole,
              success: false,
              output: reason,
              filesChanged: [],
              tokensUsed: { input: 0, output: 0 },
            });
          }
        }

        return { waveIndex: waveIdx, results: waveResults };
      });

      // Track tokens and files
      for (const result of waveResult.results) {
        totalTokens.input += result.tokensUsed.input;
        totalTokens.output += result.tokensUsed.output;
        allFilesChanged.push(...result.filesChanged);
      }

      waveResults.push(waveResult);

      await step.sendEvent(`wave-${waveIdx}-completed`, {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: `execute-wave-${waveIdx}`,
          phase: "execution",
          success: waveResult.results.every((r) => r.success),
          output: `Wave ${waveIdx}: ${waveResult.results.filter((r) => r.success).length}/${waveResult.results.length} agents succeeded`,
          filesChanged: waveResult.results.flatMap((r) => r.filesChanged),
          tokensUsed: waveResult.results.reduce(
            (acc, r) => ({
              input: acc.input + r.tokensUsed.input,
              output: acc.output + r.tokensUsed.output,
            }),
            { input: 0, output: 0 }
          ),
        },
      });

      // Quality check after each wave
      const qualityCheck = await step.run(
        `wave-${waveIdx}-quality-check`,
        async () => {
          logger.info(
            { taskId, waveIndex: waveIdx },
            "Running wave quality check"
          );

          const waveFiles = waveResult.results.flatMap((r) => r.filesChanged);

          if (waveFiles.length === 0) {
            return {
              passed: true,
              issues: [],
              filesReviewed: 0,
            } satisfies QualityCheckResult;
          }

          try {
            const result = await callOrchestrator("/quality-check", {
              filesChanged: waveFiles,
              taskId,
              sessionId,
              projectId,
              orgId,
            });

            return {
              passed: result.success,
              issues: result.output ? [result.output] : [],
              filesReviewed: waveFiles.length,
            } satisfies QualityCheckResult;
          } catch (error) {
            logger.warn(
              { taskId, waveIndex: waveIdx, error: String(error) },
              "Quality check failed, continuing"
            );
            return {
              passed: true,
              issues: [`Quality check unavailable: ${String(error)}`],
              filesReviewed: 0,
            } satisfies QualityCheckResult;
          }
        }
      );

      if (!qualityCheck.passed) {
        logger.warn(
          {
            taskId,
            waveIndex: waveIdx,
            issues: qualityCheck.issues,
          },
          "Wave quality check failed"
        );
      }

      await step.sleep(`post-wave-${waveIdx}-backpressure`, "500ms");
    }

    // ── Step 5: Run Tests ───────────────────────────────────────────
    const testResult = await step.run("run-tests", async () => {
      logger.info(
        { taskId, filesChanged: allFilesChanged.length },
        "Running tests"
      );

      try {
        const result = await callOrchestrator("/execute", {
          assignmentId: generateId("test"),
          agentRole: "test_engineer",
          description: `Run and fix tests for changed files: ${allFilesChanged.join(", ")}`,
          modelSlot: "default",
          estimatedTokens: 5000,
          taskId,
          sessionId,
          projectId,
          orgId,
        });

        return {
          passed: result.success,
          testsRun: 0,
          testsFailed: 0,
          output: result.output ?? "",
        } satisfies TestResult;
      } catch (error) {
        return {
          passed: false,
          testsRun: 0,
          testsFailed: 0,
          output: `Test execution error: ${String(error)}`,
        } satisfies TestResult;
      }
    });

    await step.sendEvent("tests-completed", {
      name: "prometheus/agent.step.completed",
      data: {
        taskId,
        sessionId,
        stepId: "run-tests",
        phase: "testing",
        success: testResult.passed,
        output: `Tests: passed=${testResult.passed}`,
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
      },
    });

    await step.sleep("post-testing-backpressure", "1s");

    // ── Step 6: CI Loop ─────────────────────────────────────────────
    const ciResult = await step.run("ci-loop", async () => {
      logger.info({ taskId }, "Starting CI loop");

      let iteration = 0;
      let buildPassed = false;
      let lintPassed = false;
      let typecheckPassed = false;
      let lastOutput = "";

      while (iteration < MAX_CI_ITERATIONS) {
        iteration++;
        logger.info({ taskId, iteration }, "CI loop iteration");

        try {
          const result = await callOrchestrator("/execute", {
            assignmentId: generateId("ci"),
            agentRole: "ci_loop",
            description: `CI iteration ${iteration}: run build, lint, and typecheck. Fix any errors found.${lastOutput ? ` Previous errors: ${lastOutput}` : ""}`,
            modelSlot: "default",
            estimatedTokens: 4000,
            taskId,
            sessionId,
            projectId,
            orgId,
          });

          lastOutput = result.output ?? "";
          buildPassed = result.success;
          lintPassed = result.success;
          typecheckPassed = result.success;

          if (result.success) {
            break;
          }
        } catch (error) {
          lastOutput = String(error);
          logger.warn(
            { taskId, iteration, error: lastOutput },
            "CI iteration failed"
          );
        }
      }

      return {
        buildPassed,
        lintPassed,
        typecheckPassed,
        iterations: iteration,
        output: lastOutput,
      } satisfies CIResult;
    });

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

    // ── Step 7: Security Scan ───────────────────────────────────────
    const securityResult = await step.run("security-scan", async () => {
      logger.info(
        { taskId, filesChanged: allFilesChanged.length },
        "Running security scan"
      );

      try {
        const result = await callOrchestrator("/execute", {
          assignmentId: generateId("sec"),
          agentRole: "security_auditor",
          description: `Security audit of changed files: ${allFilesChanged.join(", ")}`,
          modelSlot: "think",
          estimatedTokens: 4000,
          taskId,
          sessionId,
          projectId,
          orgId,
        });

        return {
          passed: result.success,
          vulnerabilities: result.success
            ? []
            : [result.output ?? "Unknown vulnerability"],
          secretsFound: 0,
        } satisfies SecurityResult;
      } catch (error) {
        return {
          passed: false,
          vulnerabilities: [`Security scan error: ${String(error)}`],
          secretsFound: 0,
        } satisfies SecurityResult;
      }
    });

    await step.sendEvent("security-completed", {
      name: "prometheus/agent.step.completed",
      data: {
        taskId,
        sessionId,
        stepId: "security-scan",
        phase: "security",
        success: securityResult.passed,
        output: `Security: ${securityResult.vulnerabilities.length} vulns, ${securityResult.secretsFound} secrets`,
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
      },
    });

    // ── Step 8: Create PR ───────────────────────────────────────────
    let pr: PRResult | null = null;

    const allChecksPassed =
      testResult.passed &&
      ciResult.buildPassed &&
      ciResult.lintPassed &&
      ciResult.typecheckPassed &&
      securityResult.passed;

    if (allChecksPassed) {
      pr = await step.run("create-pr", async () => {
        logger.info({ taskId, title }, "Creating PR");

        try {
          const result = await callOrchestrator("/execute", {
            assignmentId: generateId("pr"),
            agentRole: "deploy_engineer",
            description: `Create a pull request for: ${title}\n\nDescription: ${description}\nFiles changed: ${allFilesChanged.join(", ")}`,
            modelSlot: "default",
            estimatedTokens: 3000,
            taskId,
            sessionId,
            projectId,
            orgId,
          });

          return {
            url: result.output ?? "",
            number: 0,
            branch: `feature/${taskId}`,
            title,
          } satisfies PRResult;
        } catch (error) {
          logger.error({ taskId, error: String(error) }, "PR creation failed");
          return {
            url: "",
            number: 0,
            branch: `feature/${taskId}`,
            title,
          } satisfies PRResult;
        }
      });

      await step.sendEvent("pr-created", {
        name: "prometheus/agent.step.completed",
        data: {
          taskId,
          sessionId,
          stepId: "create-pr",
          phase: "deploy",
          success: pr.url !== "",
          output: pr.url
            ? `PR created: ${pr.url}`
            : "PR creation returned empty URL",
          filesChanged: allFilesChanged,
          tokensUsed: { input: 0, output: 0 },
        },
      });
    }

    // ── Step 9: Extract Learnings ───────────────────────────────────
    await step.run("extract-learnings", async () => {
      logger.info({ taskId }, "Extracting learnings");

      try {
        await callOrchestrator("/learnings", {
          taskId,
          sessionId,
          projectId,
          orgId,
          description,
          analysis,
          waveResults,
          testResult,
          ciResult,
          securityResult,
          prCreated: pr !== null && pr.url !== "",
        });
      } catch (error) {
        logger.warn(
          { taskId, error: String(error) },
          "Learning extraction failed, continuing"
        );
      }
    });

    // ── Step 10: Notify Completion ──────────────────────────────────
    await step.run("notify-completion", async () => {
      logger.info(
        { taskId, sourceChannel, success: allChecksPassed },
        "Notifying completion"
      );

      try {
        await callOrchestrator("/notify", {
          taskId,
          sessionId,
          projectId,
          orgId,
          userId,
          sourceChannel,
          success: allChecksPassed,
          title,
          prUrl: pr?.url ?? null,
          summary: allChecksPassed
            ? `Feature "${title}" completed successfully. ${allFilesChanged.length} files changed across ${waveResults.length} waves.`
            : `Feature "${title}" completed with issues. Tests: ${testResult.passed}, CI: ${ciResult.buildPassed}, Security: ${securityResult.passed}`,
        });
      } catch (error) {
        logger.warn(
          { taskId, error: String(error) },
          "Completion notification failed"
        );
      }
    });

    // ── Aggregate Output ────────────────────────────────────────────
    const output: PipelineOutput = {
      success: allChecksPassed,
      taskId,
      analysis,
      composition,
      waves: waveResults,
      testResult,
      ciResult,
      securityResult,
      pr,
      totalCreditsConsumed: creditsConsumed,
      totalTokensUsed: totalTokens,
    };

    logger.info(
      {
        taskId,
        success: output.success,
        waves: waveResults.length,
        filesChanged: allFilesChanged.length,
        totalTokens,
      },
      "Feature pipeline completed"
    );

    return output;
  }
);
