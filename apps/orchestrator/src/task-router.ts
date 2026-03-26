import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { db, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, indexingQueue, QueueEvents } from "@prometheus/queue";
import type { AgentMode, AgentRole } from "@prometheus/types";
import { eq } from "drizzle-orm";
import { type CILoopResult, CILoopRunner } from "./ci-loop/ci-loop-runner";
import { PropertyTesting } from "./ci-loop/property-testing";
import { classifyTask } from "./embedding-classifier";
import { LearningExtractor } from "./feedback/learning-extractor";
import { MixtureOfAgents } from "./moa/parallel-generator";
import { MoADecisionGate, MoAVoting, type ModelResponse } from "./moa/voting";
import { GeneratorEvaluator } from "./patterns/generator-evaluator";
import { SpecFirst } from "./patterns/spec-first";
import {
  ArchitecturePhase,
  type ArchitectureResult,
} from "./phases/architecture";
import { DiscoveryPhase, type DiscoveryResult } from "./phases/discovery";
import type { SprintPlan } from "./phases/planning";
import { MCTSPlanner, type MCTSPlanResult } from "./planning/mcts-planner";
import { PlanReviser } from "./planning/plan-reviser";
import type { SessionManager } from "./session-manager";
import { VisualVerifier } from "./visual/visual-verifier";

// ─── Top-level regex constants for task matching ─────────────────────────
const REQUIREMENTS_RE =
  /\b(requirements?|user stor(?:y|ies)?|acceptance criteria|scope|srs|discover|elicit|interview)\b/;
const ARCHITECTURE_RE =
  /\b(architect|blueprint|schema|data model|tech stack|adr|system design|api contract)\b/;
const PLANNING_RE =
  /\b(plan|sprint|roadmap|milestone|timeline|schedule|backlog|epic)\b/;
const FRONTEND_RE =
  /\b(component|page|ui|ux|frontend|react|next\.?js|tailwind|css|layout|form|button|modal|sidebar|dashboard)\b/;
const BACKEND_RE =
  /\b(api|endpoint|route|controller|service|middleware|database|query|migration|trpc|crud|webhook)\b/;
const TESTING_RE =
  /\b(tests?|specs?|coverage|vitest|playwright|e2e|unit tests?|integration tests?|assert|expect)\b/;
const SECURITY_RE =
  /\b(security|audit|vulnerabilit|owasp|injection|xss|csrf|auth.*bypass|penetration|cve)\b/;
const DEPLOYMENT_RE =
  /\b(deploy|docker|kubernetes|k8s|k3s|ci.?cd|github action|helm|traefik|nginx|ssl|tls)\b/;
const INTEGRATION_RE =
  /\b(integrat|connect|wire|hook up|link|bind|api call|fetch data|real.?time)\b/;
const LLM_ROUTE_ROLE_RE = /ROLE:\s*(\w+)/;

// ---------------------------------------------------------------------------
// Complexity keywords for adaptive orchestration
// ---------------------------------------------------------------------------

const SIMPLE_KEYWORDS_RE =
  /\b(rename|typo|fix\s+import|update\s+version|change\s+color|bump|toggle)\b/i;
const CRITICAL_KEYWORDS_RE =
  /\b(security|production|migration|breaking|critical|rollback|incident)\b/i;
const COMPLEX_KEYWORDS_RE =
  /\b(full.?stack|multi.?service|architecture|redesign|platform|infrastructure|distributed)\b/i;
const WHITESPACE_SPLIT_RE = /\s+/;

type PipelineComplexity = "simple" | "medium" | "complex" | "critical";

interface AdaptivePipeline {
  complexity: PipelineComplexity;
  extraReviewPasses: number;
  phases: string[];
  useMoA: boolean;
}

interface TaskRoutingResult {
  agentRole: string;
  confidence: number;
  reasoning: string;
}

interface TaskProcessingResult {
  architectureResult?: ArchitectureResult;
  ciResult?: CILoopResult;
  discoveryResult?: DiscoveryResult;
  mode: string;
  results: AgentExecutionResult[];
  sessionId: string;
  sprintPlan?: SprintPlan;
  success: boolean;
  taskId: string;
  totalCreditsConsumed: number;
}

/**
 * TaskRouter orchestrates the full lifecycle of a task. Based on the
 * requested mode, it executes the appropriate sequence of phases
 * and agent roles to completion.
 *
 * Modes:
 * - "task":  Full pipeline - Discovery -> Architecture -> Planning -> Coding -> Test -> CI -> Security -> Deploy
 * - "ask":   Route directly to Project Brain for Q&A
 * - "plan":  Discovery -> Architecture -> Planning (stop before execution)
 * - "fleet": Dispatch multiple agents in parallel from a sprint plan
 * - "watch": Passive monitoring mode (not implemented here)
 */
export class TaskRouter {
  private readonly logger = createLogger("orchestrator:router");
  private readonly sessionManager: SessionManager;
  private readonly eventPublisher: EventPublisher;
  private currentSessionId: string | null = null;
  private currentTaskId: string | null = null;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.eventPublisher = new EventPublisher();
  }

  /**
   * Process a task through the appropriate pipeline based on mode.
   */
  async processTask(params: {
    taskId: string;
    sessionId: string;
    projectId: string;
    orgId: string;
    userId: string;
    title: string;
    description: string | null;
    mode: AgentMode;
    agentRole: AgentRole | null;
  }): Promise<TaskProcessingResult> {
    const {
      taskId,
      sessionId,
      projectId,
      orgId,
      userId,
      title,
      description,
      mode,
      agentRole,
    } = params;
    const taskDescription = description ?? title;
    const results: AgentExecutionResult[] = [];
    let totalCreditsConsumed = 0;
    this.currentSessionId = sessionId;
    this.currentTaskId = taskId;

    this.logger.info({ taskId, mode, agentRole }, "Processing task");

    // Update task status to running
    await db
      .update(tasks)
      .set({
        status: "running",
        startedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.TASK_STATUS,
      data: { taskId, status: "running", mode },
      timestamp: new Date().toISOString(),
    });

    try {
      // Get or create an active session
      let activeSession = this.sessionManager.getSession(sessionId);
      if (!activeSession) {
        const session = await this.sessionManager.createSession(
          {
            projectId,
            userId,
            orgId,
            mode,
          },
          sessionId
        );
        activeSession = this.sessionManager.getSession(session.id);
      }

      if (!activeSession) {
        throw new Error(`Failed to create session ${sessionId}`);
      }

      const { agentLoop } = activeSession;

      switch (mode) {
        case "ask": {
          const result = await this.processAskMode(agentLoop, taskDescription);
          results.push(result);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();
          break;
        }

        case "plan": {
          const planResult = await this.processPlanMode(
            agentLoop,
            taskDescription
          );
          results.push(...planResult.results);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();

          // Mark task complete with plan result
          await db
            .update(tasks)
            .set({
              status: "completed",
              completedAt: new Date(),
              creditsConsumed: totalCreditsConsumed,
            })
            .where(eq(tasks.id, taskId));

          await this.eventPublisher.publishSessionEvent(sessionId, {
            type: QueueEvents.TASK_STATUS,
            data: { taskId, status: "completed", mode },
            timestamp: new Date().toISOString(),
          });

          return {
            success: true,
            taskId,
            sessionId,
            mode,
            results,
            totalCreditsConsumed,
            discoveryResult: planResult.discoveryResult,
            architectureResult: planResult.architectureResult,
            sprintPlan: planResult.sprintPlan,
          };
        }

        case "task": {
          const taskResult = await this.processTaskMode(
            agentLoop,
            taskDescription,
            agentRole
          );
          results.push(...taskResult.results);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();

          // Mark task complete
          const success = taskResult.results.every((r) => r.success);
          await db
            .update(tasks)
            .set({
              status: success ? "completed" : "failed",
              completedAt: new Date(),
              creditsConsumed: totalCreditsConsumed,
            })
            .where(eq(tasks.id, taskId));

          await this.eventPublisher.publishSessionEvent(sessionId, {
            type: QueueEvents.TASK_STATUS,
            data: { taskId, status: success ? "completed" : "failed", mode },
            timestamp: new Date().toISOString(),
          });

          return {
            success,
            taskId,
            sessionId,
            mode,
            results,
            totalCreditsConsumed,
            discoveryResult: taskResult.discoveryResult,
            architectureResult: taskResult.architectureResult,
            sprintPlan: taskResult.sprintPlan,
            ciResult: taskResult.ciResult,
          };
        }

        case "fleet": {
          const fleetResult = await this.processFleetMode(
            agentLoop,
            taskDescription,
            params
          );
          results.push(...fleetResult);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();
          break;
        }

        case "watch": {
          // Watch mode: agent monitors file changes and provides suggestions
          const watchResult = await agentLoop.executeTask(
            `Watch mode: Monitor this project and provide real-time suggestions for:\n${taskDescription}\n\nWatch for file changes, catch bugs, suggest improvements, and flag potential issues. Operate as a pair programming assistant.`,
            "ci_loop"
          );
          results.push(watchResult);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();
          break;
        }

        default: {
          // If a specific agent role was requested, run it directly
          if (agentRole) {
            const result = await agentLoop.executeTask(
              taskDescription,
              agentRole
            );
            results.push(result);
            totalCreditsConsumed += agentLoop.getCreditsConsumed();
          } else {
            // Route based on task description analysis
            const routing = await this.routeTask(
              taskDescription,
              undefined,
              agentLoop
            );
            const result = await agentLoop.executeTask(
              taskDescription,
              routing.agentRole
            );
            results.push(result);
            totalCreditsConsumed += agentLoop.getCreditsConsumed();
          }
          break;
        }
      }

      // Update task as completed
      const allSuccess = results.every((r) => r.success);
      await db
        .update(tasks)
        .set({
          status: allSuccess ? "completed" : "failed",
          completedAt: new Date(),
          creditsConsumed: totalCreditsConsumed,
        })
        .where(eq(tasks.id, taskId));

      await this.eventPublisher.publishSessionEvent(sessionId, {
        type: QueueEvents.TASK_STATUS,
        data: {
          taskId,
          status: allSuccess ? "completed" : "failed",
          creditsConsumed: totalCreditsConsumed,
        },
        timestamp: new Date().toISOString(),
      });

      // Extract learning patterns at end of task processing
      const learningExtractor = new LearningExtractor();
      learningExtractor
        .extract({
          sessionId,
          projectId,
          agentRole: agentRole ?? "orchestrator",
          taskType: mode,
          success: allSuccess,
          toolCalls: [],
          errorMessages: results
            .filter((r) => r.error)
            .map((r) => r.error as string),
          filesChanged: results.flatMap((r) => r.filesChanged),
          totalTokens: results.reduce(
            (sum, r) => sum + r.tokensUsed.input + r.tokensUsed.output,
            0
          ),
          totalDuration: 0,
        })
        .catch(() => {
          /* fire-and-forget */
        });

      // Auto-index changed files after task completion
      const changedFiles = results.flatMap((r) => r.filesChanged);
      if (changedFiles.length > 0) {
        indexingQueue
          .add(
            "incremental-index",
            {
              projectId,
              orgId,
              filePaths: changedFiles,
              fullReindex: false,
              triggeredBy: "push" as const,
            },
            { priority: 10 }
          )
          .catch((err) => {
            this.logger.warn(
              { err, projectId, fileCount: changedFiles.length },
              "Failed to enqueue incremental indexing job"
            );
          });
      }

      return {
        success: allSuccess,
        taskId,
        sessionId,
        mode,
        results,
        totalCreditsConsumed,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        { taskId, error: errorMessage },
        "Task processing failed"
      );

      await db
        .update(tasks)
        .set({
          status: "failed",
          completedAt: new Date(),
          creditsConsumed: totalCreditsConsumed,
        })
        .where(eq(tasks.id, taskId));

      await this.eventPublisher.publishSessionEvent(sessionId, {
        type: QueueEvents.TASK_STATUS,
        data: { taskId, status: "failed", error: errorMessage },
        timestamp: new Date().toISOString(),
      });

      return {
        success: false,
        taskId,
        sessionId,
        mode,
        results,
        totalCreditsConsumed,
      };
    }
  }

  /**
   * Ask mode: route to a knowledge agent for answering questions.
   * Uses the discovery agent in Q&A mode since it has access to
   * semantic search and file reading tools.
   */
  private async processAskMode(
    agentLoop: import("./agent-loop").AgentLoop,
    taskDescription: string
  ): Promise<AgentExecutionResult> {
    this.logger.info("Processing in ASK mode");

    const prompt = `Answer the following question about the project. Use your available tools to search the codebase, read relevant files, and provide a comprehensive answer.

Question:
${taskDescription}

Instructions:
- Search the codebase for relevant code, documentation, and configuration
- Read files that are relevant to the question
- Provide a clear, accurate answer based on the actual codebase
- Include file paths and code snippets where relevant
- If you cannot find the answer, say so clearly`;

    return await agentLoop.executeTask(prompt, "discovery");
  }

  /**
   * Plan mode: Discovery -> Architect -> Planner (stop before execution).
   */
  private async processPlanMode(
    agentLoop: import("./agent-loop").AgentLoop,
    taskDescription: string
  ): Promise<{
    results: AgentExecutionResult[];
    discoveryResult: DiscoveryResult;
    architectureResult: ArchitectureResult;
    sprintPlan: SprintPlan;
  }> {
    this.logger.info("Processing in PLAN mode");
    const results: AgentExecutionResult[] = [];

    // Phase 1: Discovery
    await this.publishPhaseUpdate("discovery", "running");
    const discoveryPhase = new DiscoveryPhase();
    const discoveryResult = await discoveryPhase.execute(
      agentLoop,
      taskDescription
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
    await this.publishPhaseUpdate("discovery", "completed");

    // Phase 2: Architecture
    await this.publishPhaseUpdate("architecture", "running");
    const architecturePhase = new ArchitecturePhase();
    const architectureResult = await architecturePhase.execute(
      agentLoop,
      discoveryResult.srs
    );
    results.push({
      success: true,
      output: architectureResult.blueprint,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhaseUpdate("architecture", "completed");

    // Phase 3: MCTS Planning (replaces flat planning)
    await this.publishPhaseUpdate("planning", "running");
    const mctsPlanner = new MCTSPlanner({
      expansionWidth: 3,
      maxLLMCalls: 8,
    });
    const mctsResult = await mctsPlanner.plan(
      agentLoop,
      architectureResult.blueprint,
      taskDescription
    );
    const sprintPlan = mctsResult.selectedPlan;

    this.logger.info(
      {
        strategy: mctsResult.selectedStrategy,
        confidence: mctsResult.confidence,
        alternatives: mctsResult.alternativesExplored,
      },
      "MCTS planning selected strategy"
    );

    results.push({
      success: true,
      output: `MCTS Planning: Selected "${mctsResult.selectedStrategy}" strategy (confidence: ${mctsResult.confidence.toFixed(2)}, explored ${mctsResult.alternativesExplored} alternatives).\n${JSON.stringify(sprintPlan)}`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhaseUpdate("planning", "completed");

    return { results, discoveryResult, architectureResult, sprintPlan };
  }

  /**
   * Task mode: Full pipeline execution.
   * Discovery -> Architect -> Planner -> Coders -> Test -> CI Loop -> Security -> Deploy
   *
   * Uses the adaptive pipeline to determine which phases to run and
   * whether MoA voting should be used for high-stakes coding decisions.
   */
  private async processTaskMode(
    agentLoop: import("./agent-loop").AgentLoop,
    taskDescription: string,
    specificRole: AgentRole | null
  ): Promise<{
    results: AgentExecutionResult[];
    discoveryResult?: DiscoveryResult;
    architectureResult?: ArchitectureResult;
    sprintPlan?: SprintPlan;
    ciResult?: CILoopResult;
  }> {
    this.logger.info("Processing in TASK mode");
    const results: AgentExecutionResult[] = [];

    if (specificRole) {
      const routing = await this.routeTask(
        taskDescription,
        undefined,
        agentLoop
      );
      const role = specificRole || routing.agentRole;
      const result = await agentLoop.executeTask(taskDescription, role);
      results.push(result);
      return { results };
    }

    // Determine adaptive pipeline based on task complexity
    const pipeline = this.adaptPipeline(taskDescription);
    this.logger.info(
      {
        complexity: pipeline.complexity,
        phases: pipeline.phases,
        useMoA: pipeline.useMoA,
        extraReviewPasses: pipeline.extraReviewPasses,
      },
      "Adaptive pipeline selected"
    );

    // Simple tasks: skip discovery/architecture/planning, go straight to coding
    if (pipeline.complexity === "simple") {
      const routing = await this.routeTask(
        taskDescription,
        undefined,
        agentLoop
      );
      const codingResult = await agentLoop.executeTask(
        taskDescription,
        routing.agentRole
      );
      results.push(codingResult);

      if (pipeline.phases.includes("testing")) {
        await this.publishPhaseUpdate("testing", "running");
        const testResult = await agentLoop.executeTask(
          `Write tests for the changes just made:\n\n${taskDescription}`,
          "test_engineer"
        );
        results.push(testResult);
        await this.publishPhaseUpdate("testing", "completed");
      }

      return { results };
    }

    // Full pipeline: Discovery + Architecture + Planning
    const { discoveryResult, architectureResult } =
      await this.runDiscoveryAndArchitecture(
        agentLoop,
        taskDescription,
        results
      );

    // For complex/critical tasks with MoA, run MoA architecture review
    // (already done in runDiscoveryAndArchitecture, but add extra review
    // passes for critical tasks)
    if (pipeline.useMoA && pipeline.extraReviewPasses > 0) {
      await this.runMoAExtraReview(
        architectureResult,
        taskDescription,
        pipeline.extraReviewPasses
      );
    }

    const { sprintPlan, mctsResult } = await this.runPlanningPhase(
      agentLoop,
      architectureResult,
      taskDescription,
      results
    );

    const { specFirst, specResult } = await this.runSpecFirstPhase(
      agentLoop,
      architectureResult,
      sprintPlan,
      results
    );

    // Coding with backtracking — use MoA voting for critical tasks
    const { executionResults, finalPlan } = pipeline.useMoA
      ? await this.runCodingWithMoA(
          agentLoop,
          sprintPlan,
          architectureResult,
          mctsResult,
          taskDescription,
          results
        )
      : await this.runCodingWithBacktracking(
          agentLoop,
          sprintPlan,
          architectureResult,
          mctsResult,
          taskDescription,
          results
        );

    // Post-coding verification phases
    await this.runPostCodingVerification(
      agentLoop,
      executionResults,
      taskDescription,
      results
    );

    // Testing + spec validation
    await this.runTestingPhase(
      agentLoop,
      architectureResult,
      finalPlan,
      specFirst,
      specResult,
      results
    );

    // CI + property testing + security + deploy
    const allChangedFiles = executionResults.flatMap((r) => r.filesChanged);
    const ciResult = await this.runCIAndFinalPhases(
      agentLoop,
      allChangedFiles,
      results
    );

    return {
      results,
      discoveryResult,
      architectureResult,
      sprintPlan: finalPlan,
      ciResult,
    };
  }

  private async runDiscoveryAndArchitecture(
    agentLoop: import("./agent-loop").AgentLoop,
    taskDescription: string,
    results: AgentExecutionResult[]
  ): Promise<{
    discoveryResult: DiscoveryResult;
    architectureResult: ArchitectureResult;
  }> {
    // Phase 1: Discovery
    await this.publishPhaseUpdate("discovery", "running");
    const discoveryPhase = new DiscoveryPhase();
    const discoveryResult = await discoveryPhase.execute(
      agentLoop,
      taskDescription
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
    await this.publishPhaseUpdate("discovery", "completed");

    // Phase 2: Architecture
    await this.publishPhaseUpdate("architecture", "running");
    const architecturePhase = new ArchitecturePhase();
    const architectureResult = await architecturePhase.execute(
      agentLoop,
      discoveryResult.srs
    );
    results.push({
      success: true,
      output: architectureResult.blueprint,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhaseUpdate("architecture", "completed");

    // Phase 2.5: MoA architecture review
    const moaArchitecture = new MixtureOfAgents();
    const moaResult = await moaArchitecture
      .generate(
        `Review and enhance this architecture blueprint for potential issues, missing considerations, and improvements:\n\n${architectureResult.blueprint.slice(0, 4000)}`,
        1
      )
      .catch(() => null);
    if (moaResult?.synthesized) {
      architectureResult.blueprint += `\n\n## Architecture Review (Multi-Model Consensus)\n${moaResult.synthesized.slice(0, 2000)}`;
    }

    return { discoveryResult, architectureResult };
  }

  private async runPlanningPhase(
    agentLoop: import("./agent-loop").AgentLoop,
    architectureResult: ArchitectureResult,
    taskDescription: string,
    results: AgentExecutionResult[]
  ): Promise<{ sprintPlan: SprintPlan; mctsResult: MCTSPlanResult }> {
    await this.publishPhaseUpdate("planning", "running");
    const mctsPlanner = new MCTSPlanner({ expansionWidth: 3, maxLLMCalls: 8 });
    const mctsResult = await mctsPlanner.plan(
      agentLoop,
      architectureResult.blueprint,
      taskDescription
    );
    const sprintPlan = mctsResult.selectedPlan;

    this.logger.info(
      {
        strategy: mctsResult.selectedStrategy,
        confidence: mctsResult.confidence,
        alternatives: mctsResult.alternativesExplored,
      },
      "MCTS planning selected strategy"
    );

    results.push({
      success: true,
      output: `MCTS Planning: Selected "${mctsResult.selectedStrategy}" strategy (confidence: ${mctsResult.confidence.toFixed(2)}, explored ${mctsResult.alternativesExplored} alternatives).\n${JSON.stringify(sprintPlan)}`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhaseUpdate("planning", "completed");

    return { sprintPlan, mctsResult };
  }

  private async runSpecFirstPhase(
    agentLoop: import("./agent-loop").AgentLoop,
    architectureResult: ArchitectureResult,
    sprintPlan: SprintPlan,
    _results: AgentExecutionResult[]
  ): Promise<{
    specFirst: SpecFirst;
    specResult: Awaited<ReturnType<SpecFirst["generateSpecs"]>>;
  }> {
    await this.publishPhaseUpdate("spec_first", "running");
    const specFirst = new SpecFirst();
    const specResult = await specFirst.generateSpecs(
      agentLoop,
      architectureResult.blueprint,
      JSON.stringify(sprintPlan)
    );
    if (specResult.specs) {
      const specSummary = [
        specResult.specs.interfaces &&
          `### Interfaces\n${specResult.specs.interfaces}`,
        specResult.specs.validators &&
          `### Validators\n${specResult.specs.validators}`,
        specResult.specs.apiSignatures &&
          `### API Signatures\n${specResult.specs.apiSignatures}`,
        specResult.specs.dbChanges &&
          `### DB Changes\n${specResult.specs.dbChanges}`,
        specResult.specs.testStubs &&
          `### Test Stubs\n${specResult.specs.testStubs}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      if (specSummary) {
        architectureResult.blueprint += `\n\n## Generated Specifications\n${specSummary}`;
      }

      if (specResult.specs.testStubs) {
        await agentLoop.executeTask(
          `Write these test skeleton files to disk. Create the test files with test.todo() blocks based on these stubs:\n\n${specResult.specs.testStubs}\n\nUse vitest syntax. Each test should be a \`test.todo()\` placeholder that will be implemented later.`,
          "test_engineer"
        );
      }
    }
    await this.publishPhaseUpdate("spec_first", "completed");

    return { specFirst, specResult };
  }

  private async runCodingWithBacktracking(
    agentLoop: import("./agent-loop").AgentLoop,
    initialPlan: SprintPlan,
    architectureResult: ArchitectureResult,
    mctsResult: MCTSPlanResult,
    taskDescription: string,
    results: AgentExecutionResult[]
  ): Promise<{
    executionResults: AgentExecutionResult[];
    finalPlan: SprintPlan;
  }> {
    const planReviser = new PlanReviser(3);
    let executionAttempt = 0;
    const maxExecutionAttempts = 2;
    let executionResults: AgentExecutionResult[] = [];
    let sprintPlan = initialPlan;

    while (executionAttempt < maxExecutionAttempts) {
      executionAttempt++;
      await this.publishPhaseUpdate(
        "coding",
        executionAttempt > 1 ? "retrying" : "running"
      );

      executionResults = await this.executeSprintPlan(
        agentLoop,
        sprintPlan,
        architectureResult.blueprint
      );

      const failedTasks = executionResults.filter((r) => !r.success);
      const qualityGatePassed =
        failedTasks.length === 0 ||
        failedTasks.length / executionResults.length < 0.5;

      if (qualityGatePassed || planReviser.isExhausted()) {
        break;
      }

      const revision = await this.attemptPlanRevision(
        agentLoop,
        planReviser,
        mctsResult,
        sprintPlan,
        executionResults,
        architectureResult,
        taskDescription
      );
      if (!revision) {
        break;
      }
      sprintPlan = revision;
    }

    results.push(...executionResults);
    await this.publishPhaseUpdate("coding", "completed");

    return { executionResults, finalPlan: sprintPlan };
  }

  /**
   * Run coding with MoA voting for critical/complex tasks.
   *
   * For each coding task in the sprint plan, dispatches the prompt to
   * 3 models in parallel via {@link MixtureOfAgents}, scores responses
   * via {@link MoAVoting}, and uses the best response. Falls back to
   * standard single-model execution for non-coding tasks or on failure.
   */
  private async runCodingWithMoA(
    agentLoop: import("./agent-loop").AgentLoop,
    initialPlan: SprintPlan,
    architectureResult: ArchitectureResult,
    _mctsResult: MCTSPlanResult,
    _taskDescription: string,
    results: AgentExecutionResult[]
  ): Promise<{
    executionResults: AgentExecutionResult[];
    finalPlan: SprintPlan;
  }> {
    await this.publishPhaseUpdate("coding", "running");

    const executionResults: AgentExecutionResult[] = [];
    const completed = new Set<string>();
    const allTasks = [...initialPlan.tasks];
    const codingRoles = new Set([
      "frontend_coder",
      "backend_coder",
      "integration_coder",
    ]);

    let safetyCounter = 0;
    const maxRounds = allTasks.length + 1;

    while (completed.size < allTasks.length && safetyCounter < maxRounds) {
      safetyCounter++;

      const ready = allTasks.filter(
        (t) =>
          !completed.has(t.id) &&
          t.dependencies.every((dep) => completed.has(dep))
      );

      if (ready.length === 0 && completed.size < allTasks.length) {
        const remaining = allTasks.filter((t) => !completed.has(t.id));
        ready.push(...remaining);
      }

      for (const task of ready) {
        const enrichedDesc = `${task.description}\n\nBlueprint:\n${architectureResult.blueprint}\n\nAcceptance Criteria:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;

        const useMoA = codingRoles.has(task.agentRole);
        const result = useMoA
          ? await this.executeCodingTaskWithMoA(
              agentLoop,
              task.id,
              enrichedDesc,
              task.agentRole
            )
          : await agentLoop.executeTask(enrichedDesc, task.agentRole);

        executionResults.push(result);
        completed.add(task.id);

        this.logger.info(
          {
            taskId: task.id,
            role: task.agentRole,
            success: result.success,
            usedMoA: useMoA,
            progress: `${completed.size}/${allTasks.length}`,
          },
          "Sprint task completed (MoA pipeline)"
        );
      }
    }

    results.push(...executionResults);
    await this.publishPhaseUpdate("coding", "completed");

    return { executionResults, finalPlan: initialPlan };
  }

  /**
   * Execute a single coding task using MoA multi-model generation + voting.
   * Dispatches to 3 models in parallel, votes on the best response,
   * validates quorum via decision gate, and feeds the consensus result
   * to the agent loop for execution.
   */
  private async executeCodingTaskWithMoA(
    agentLoop: import("./agent-loop").AgentLoop,
    taskId: string,
    enrichedDesc: string,
    agentRole: string
  ): Promise<AgentExecutionResult> {
    const moa = new MixtureOfAgents();
    const moaVoting = new MoAVoting();
    const decisionGate = new MoADecisionGate({ mode: "majority" });

    try {
      const moaResult = await moa.generate(enrichedDesc, 1);
      this.runMoAVotingRound(moaVoting, decisionGate, moaResult, taskId);

      if (moaResult.synthesized.length > 0) {
        return await agentLoop.executeTask(
          `${enrichedDesc}\n\nReference implementation from multi-model consensus:\n${moaResult.synthesized.slice(0, 4000)}`,
          agentRole
        );
      }
      return await agentLoop.executeTask(enrichedDesc, agentRole);
    } catch (err) {
      this.logger.warn(
        { taskId, err },
        "MoA coding failed, falling back to single model"
      );
      return await agentLoop.executeTask(enrichedDesc, agentRole);
    }
  }

  /**
   * Run MoA voting and decision gate evaluation on multi-model responses.
   * Logs the voting outcome for observability.
   */
  private runMoAVotingRound(
    moaVoting: MoAVoting,
    decisionGate: MoADecisionGate,
    moaResult: import("./moa/parallel-generator").MoAResult,
    taskId: string
  ): void {
    const validResponses = moaResult.responses.filter(
      (r) => r.output.length > 0
    );
    if (validResponses.length <= 1) {
      return;
    }

    const modelResponses: ModelResponse[] = validResponses.map((r) => ({
      model: r.model,
      output: r.output,
      confidence: r.qualityScore ?? r.confidence,
    }));

    const voteResult = moaVoting.vote(modelResponses, "confidence-weighted");

    this.logger.info(
      {
        taskId,
        winner: modelResponses[voteResult.winner]?.model,
        strategy: voteResult.strategy,
        scores: voteResult.scores,
      },
      "MoA voting selected best coding response"
    );

    const gateResult = decisionGate.evaluate(modelResponses);
    if (!gateResult.approved) {
      this.logger.warn(
        { taskId },
        "MoA quorum not met, using synthesized result"
      );
    }
  }

  /**
   * Run extra MoA review passes on the architecture for critical tasks.
   * Each pass sends the blueprint to multiple models for review and
   * appends consensus improvements.
   */
  private async runMoAExtraReview(
    architectureResult: ArchitectureResult,
    taskDescription: string,
    passes: number
  ): Promise<void> {
    const moa = new MixtureOfAgents();

    for (let pass = 0; pass < passes; pass++) {
      const reviewResult = await moa
        .generate(
          `Critical task review pass ${pass + 1}: Review this architecture for security, scalability, and correctness issues.\n\nTask: ${taskDescription}\n\nBlueprint:\n${architectureResult.blueprint.slice(0, 3000)}`,
          1
        )
        .catch(() => null);

      if (reviewResult?.synthesized) {
        architectureResult.blueprint += `\n\n## MoA Review Pass ${pass + 1}\n${reviewResult.synthesized.slice(0, 1500)}`;
        this.logger.info({ pass: pass + 1 }, "MoA extra review pass completed");
      }
    }
  }

  private async attemptPlanRevision(
    agentLoop: import("./agent-loop").AgentLoop,
    planReviser: PlanReviser,
    mctsResult: MCTSPlanResult,
    sprintPlan: SprintPlan,
    executionResults: AgentExecutionResult[],
    architectureResult: ArchitectureResult,
    taskDescription: string
  ): Promise<SprintPlan | null> {
    const failedTasks = executionResults.filter((r) => !r.success);
    this.logger.warn(
      { failedCount: failedTasks.length },
      "Execution quality below threshold, attempting plan revision"
    );

    const revision = await planReviser.revise(
      agentLoop,
      mctsResult,
      {
        failedPhase: "coding",
        failedTaskId:
          sprintPlan.tasks.find(
            (_, i) => executionResults[i] && !executionResults[i]?.success
          )?.id ?? "unknown",
        errorMessage: failedTasks
          .map((r) => r.error)
          .filter(Boolean)
          .join("; "),
        partialResults: sprintPlan.tasks.map((t, i) => ({
          taskId: t.id,
          success: executionResults[i]?.success ?? false,
          output: executionResults[i]?.output ?? "",
        })),
        creditsConsumed: executionResults.reduce(
          (sum, r) => sum + r.creditsConsumed,
          0
        ),
        filesChanged: executionResults.flatMap((r) => r.filesChanged),
      },
      architectureResult.blueprint,
      taskDescription
    );

    if (!revision) {
      this.logger.warn("Plan revision failed, continuing with current results");
      return null;
    }

    this.logger.info(
      {
        newStrategy: revision.strategy,
        confidence: revision.confidence,
        reusableWork: revision.reusableWork.length,
      },
      "Plan revised via MCTS backtracking"
    );
    return revision.revisedPlan;
  }

  private async runPostCodingVerification(
    agentLoop: import("./agent-loop").AgentLoop,
    executionResults: AgentExecutionResult[],
    taskDescription: string,
    results: AgentExecutionResult[]
  ): Promise<void> {
    // Cross-file consistency validation
    const allChangedFilesPre = executionResults.flatMap((r) => r.filesChanged);
    if (allChangedFilesPre.length > 0) {
      try {
        const { CrossFileValidator } = await import(
          "./engine/cross-file-validator"
        );
        const crossFileValidator = new CrossFileValidator();
        const crossFileResult = await crossFileValidator.validate(
          allChangedFilesPre,
          "/workspace"
        );
        if (!crossFileResult.valid) {
          const feedback = crossFileValidator.formatForAgent(crossFileResult);
          const fixResult = await agentLoop.executeTask(
            `Fix the following cross-file consistency issues:\n\n${feedback}`,
            "backend_coder"
          );
          results.push(fixResult);
        }
      } catch {
        // Cross-file validator not available, skip
      }
    }

    // Typecheck verification gate
    const typecheckResult = await agentLoop.executeTask(
      "Run `pnpm typecheck` and report ALL TypeScript errors found. If there are errors, fix them. Repeat until typecheck passes (max 10 attempts).",
      "ci_loop"
    );
    results.push(typecheckResult);

    // Visual verification for frontend changes
    const allChangedFiles = executionResults.flatMap((r) => r.filesChanged);
    const hasFrontendChanges = allChangedFiles.some(
      (f) => f.endsWith(".tsx") || f.endsWith(".jsx") || f.endsWith(".css")
    );
    if (hasFrontendChanges) {
      await this.runVisualVerification(
        agentLoop,
        allChangedFiles,
        taskDescription,
        results
      );
    }
  }

  private async runVisualVerification(
    agentLoop: import("./agent-loop").AgentLoop,
    allChangedFiles: string[],
    taskDescription: string,
    results: AgentExecutionResult[]
  ): Promise<void> {
    await this.publishPhaseUpdate("visual_verify", "running");
    const visualVerifier = new VisualVerifier();
    const visualResult = await visualVerifier.verify(
      agentLoop,
      this.currentSessionId ?? "",
      allChangedFiles,
      taskDescription,
      this.currentSessionId ?? undefined
    );
    results.push({
      success: visualResult.passed,
      output: `Visual Verification: ${visualResult.summary} (score: ${visualResult.score.toFixed(2)}, ${visualResult.pagesChecked} pages checked)`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhaseUpdate(
      "visual_verify",
      visualResult.passed ? "completed" : "failed"
    );
  }

  private async runTestingPhase(
    agentLoop: import("./agent-loop").AgentLoop,
    architectureResult: ArchitectureResult,
    sprintPlan: SprintPlan,
    specFirst: SpecFirst,
    specResult: Awaited<ReturnType<SpecFirst["generateSpecs"]>>,
    results: AgentExecutionResult[]
  ): Promise<void> {
    await this.publishPhaseUpdate("testing", "running");
    const testResult = await agentLoop.executeTask(
      `Write comprehensive tests for the implementation based on the sprint plan and blueprint.\n\nBlueprint:\n${architectureResult.blueprint}\n\nSprint Plan:\n${JSON.stringify(sprintPlan, null, 2)}`,
      "test_engineer"
    );
    results.push(testResult);
    await this.publishPhaseUpdate("testing", "completed");

    if (specResult.specs) {
      await this.publishPhaseUpdate("spec_validation", "running");
      const validationResult = await specFirst.validateImplementation(
        agentLoop,
        specResult.specs
      );
      if (!validationResult.success) {
        this.logger.warn(
          "Spec validation found mismatches, feeding back to coding agent"
        );
        const fixResult = await agentLoop.executeTask(
          `Fix the following spec validation issues:\n\n${validationResult.output}\n\nEnsure the implementation matches the generated specifications.`,
          "backend_coder"
        );
        results.push(fixResult);
      }
      await this.publishPhaseUpdate("spec_validation", "completed");
    }
  }

  private async runCIAndFinalPhases(
    agentLoop: import("./agent-loop").AgentLoop,
    allChangedFiles: string[],
    results: AgentExecutionResult[]
  ): Promise<CILoopResult> {
    // CI Loop
    await this.publishPhaseUpdate("ci_loop", "running");
    const ciRunner = new CILoopRunner(20);
    const ciResult = await ciRunner.run(agentLoop);
    results.push({
      success: ciResult.passed,
      output: `CI Loop: ${ciResult.passed ? "PASSED" : "FAILED"} after ${ciResult.iterations}/${ciResult.maxIterations} iterations. Auto-resolved: ${ciResult.autoResolved}`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhaseUpdate(
      "ci_loop",
      ciResult.passed ? "completed" : "failed"
    );

    // Property-based testing
    if (ciResult.passed && allChangedFiles.length > 0) {
      await this.runPropertyTesting(
        agentLoop,
        ciRunner,
        allChangedFiles,
        results
      );
    }

    // Security audit
    await this.publishPhaseUpdate("security", "running");
    const securityResult = await agentLoop.executeTask(
      "Perform a security audit on the implemented code. Check for:\n- OWASP Top 10 vulnerabilities\n- Input validation issues\n- Authentication/authorization gaps\n- SQL injection risks\n- XSS vulnerabilities\n- Insecure dependencies",
      "security_auditor"
    );
    results.push(securityResult);
    await this.publishPhaseUpdate("security", "completed");

    // Deploy preparation
    await this.publishPhaseUpdate("deploy", "running");
    const deployResult = await agentLoop.executeTask(
      "Prepare deployment configuration for the implemented features:\n- Verify Dockerfiles\n- Update k8s manifests if needed\n- Ensure CI/CD pipeline configuration\n- Create migration scripts if needed",
      "deploy_engineer"
    );
    results.push(deployResult);
    await this.publishPhaseUpdate("deploy", "completed");

    return ciResult;
  }

  private async runPropertyTesting(
    agentLoop: import("./agent-loop").AgentLoop,
    ciRunner: CILoopRunner,
    allChangedFiles: string[],
    results: AgentExecutionResult[]
  ): Promise<void> {
    await this.publishPhaseUpdate("property_testing", "running");
    const propertyTesting = new PropertyTesting();
    const propertyResult = await propertyTesting.generate(
      agentLoop,
      allChangedFiles.filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    );
    results.push({
      success: propertyResult.failed === 0,
      output: `Property Testing: ${propertyResult.generated} files, ${propertyResult.passed} passed, ${propertyResult.failed} failed`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhaseUpdate("property_testing", "completed");

    if (propertyResult.failed > 0) {
      const propFixResult = await ciRunner.run(agentLoop);
      results.push({
        success: propFixResult.passed,
        output: `Property Test Fix Loop: ${propFixResult.passed ? "PASSED" : "FAILED"} after ${propFixResult.iterations} iterations`,
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        steps: 0,
        creditsConsumed: 0,
      });
    }
  }

  /**
   * Fleet mode: dispatch multiple agents in parallel from the sprint plan.
   */
  private async processFleetMode(
    agentLoop: import("./agent-loop").AgentLoop,
    taskDescription: string,
    params: {
      projectId: string;
      orgId: string;
      userId: string;
      sessionId: string;
    }
  ): Promise<AgentExecutionResult[]> {
    this.logger.info("Processing in FLEET mode");

    // First, generate a plan
    const planResult = await this.processPlanMode(agentLoop, taskDescription);
    const { sprintPlan, architectureResult } = planResult;

    if (!sprintPlan.tasks.length) {
      this.logger.warn("No tasks in sprint plan for fleet mode");
      return planResult.results;
    }

    // Group tasks by parallel workstreams
    const workstreams = sprintPlan.parallelWorkstreams;
    const results: AgentExecutionResult[] = [...planResult.results];

    if (workstreams.length > 0) {
      // Execute each workstream: tasks within a workstream run in parallel
      for (const streamTaskIds of workstreams) {
        const streamTasks = sprintPlan.tasks.filter((t) =>
          streamTaskIds.includes(t.id)
        );

        const streamPromises = streamTasks.map(async (task) => {
          // Create a separate AgentLoop for each parallel agent
          const { AgentLoop: AgentLoopClass } = await import("./agent-loop");
          const parallelLoop = new AgentLoopClass(
            params.sessionId,
            params.projectId,
            params.orgId,
            params.userId
          );

          const enrichedDesc = `${task.description}\n\nBlueprint:\n${architectureResult.blueprint}\n\nAcceptance Criteria:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;

          return parallelLoop.executeTask(enrichedDesc, task.agentRole);
        });

        const streamResults = await Promise.allSettled(streamPromises);
        for (const settled of streamResults) {
          if (settled.status === "fulfilled") {
            results.push(settled.value);
          } else {
            results.push({
              success: false,
              output: "",
              filesChanged: [],
              tokensUsed: { input: 0, output: 0 },
              toolCalls: 0,
              steps: 0,
              creditsConsumed: 0,
              error:
                settled.reason instanceof Error
                  ? settled.reason.message
                  : String(settled.reason),
            });
          }
        }
      }
    } else {
      // No explicit workstreams, execute tasks sequentially respecting dependencies
      const executionResults = await this.executeSprintPlan(
        agentLoop,
        sprintPlan,
        architectureResult.blueprint
      );
      results.push(...executionResults);
    }

    return results;
  }

  /**
   * Execute tasks from a sprint plan in dependency order.
   * Tasks with resolved dependencies run in parallel where possible.
   */
  private async executeSprintPlan(
    agentLoop: import("./agent-loop").AgentLoop,
    plan: SprintPlan,
    blueprint: string
  ): Promise<AgentExecutionResult[]> {
    const results: AgentExecutionResult[] = [];
    const completed = new Set<string>();
    const allTasks = [...plan.tasks];

    // Topological sort by dependencies
    let safetyCounter = 0;
    const maxRounds = allTasks.length + 1;

    while (completed.size < allTasks.length && safetyCounter < maxRounds) {
      safetyCounter++;

      // Find tasks whose dependencies are all satisfied
      const ready = allTasks.filter(
        (t) =>
          !completed.has(t.id) &&
          t.dependencies.every((dep) => completed.has(dep))
      );

      if (ready.length === 0 && completed.size < allTasks.length) {
        this.logger.warn(
          "Dependency deadlock detected, forcing remaining tasks"
        );
        const remaining = allTasks.filter((t) => !completed.has(t.id));
        ready.push(...remaining);
      }

      // Execute ready tasks (could be parallelized in fleet mode)
      for (const task of ready) {
        const enrichedDesc = `${task.description}\n\nBlueprint:\n${blueprint}\n\nAcceptance Criteria:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;

        // Use GeneratorEvaluator for coding roles
        const codingRoles = new Set([
          "frontend_coder",
          "backend_coder",
          "integration_coder",
        ]);
        let result: AgentExecutionResult;
        if (codingRoles.has(task.agentRole)) {
          const genEval = new GeneratorEvaluator({
            generatorRole: task.agentRole,
            evaluatorRole: "security_auditor",
            threshold: 0.75,
            maxRounds: 2,
          });
          const genResult = await genEval.execute(
            agentLoop,
            enrichedDesc,
            blueprint
          );
          result = genResult.result;
        } else {
          result = await agentLoop.executeTask(enrichedDesc, task.agentRole);
        }
        results.push(result);
        completed.add(task.id);

        this.logger.info(
          {
            taskId: task.id,
            role: task.agentRole,
            success: result.success,
            progress: `${completed.size}/${allTasks.length}`,
          },
          "Sprint task completed"
        );
      }
    }

    return results;
  }

  /**
   * Three-stage task routing:
   * 1. Embedding-based classification (primary) via model-router
   * 2. Regex pre-filter (fallback when embeddings unavailable)
   * 3. LLM disambiguation for ambiguous results
   */
  async routeTask(
    taskDescription: string,
    _projectContext?: string,
    agentLoop?: import("./agent-loop").AgentLoop
  ): Promise<TaskRoutingResult> {
    // Stage 1: Try embedding-based classification first
    const embeddingResult =
      await this.tryEmbeddingClassification(taskDescription);
    if (embeddingResult) {
      return embeddingResult;
    }

    // Stage 2: Regex pre-filter
    const candidates = this.regexRouteTask(taskDescription);

    if (
      candidates.length === 1 &&
      (candidates[0] as TaskRoutingResult).confidence >= 0.85
    ) {
      return candidates[0] as TaskRoutingResult;
    }

    // Stage 3: LLM disambiguation for ambiguous cases
    if (candidates.length > 1 && agentLoop) {
      const llmResult = await this.llmDisambiguate(
        taskDescription,
        candidates,
        agentLoop
      );
      if (llmResult) {
        return llmResult;
      }
    }

    // Fallback: return best regex match or orchestrator
    if (candidates.length > 0) {
      return candidates[0] as TaskRoutingResult;
    }

    return {
      agentRole: "orchestrator",
      confidence: 0.5,
      reasoning: "Task is complex or ambiguous, needs orchestration",
    };
  }

  private async tryEmbeddingClassification(
    taskDescription: string
  ): Promise<TaskRoutingResult | null> {
    try {
      const classification = await classifyTask(taskDescription);

      if (
        classification.role !== "ambiguous" &&
        classification.confidence >= 0.6
      ) {
        this.logger.info(
          {
            role: classification.role,
            confidence: classification.confidence.toFixed(4),
          },
          "Task routed via embedding classification"
        );
        return {
          agentRole: classification.role,
          confidence: classification.confidence,
          reasoning: `Embedding-based: ${classification.reasoning}`,
        };
      }

      if (classification.role === "ambiguous") {
        this.logger.info(
          "Embedding classification ambiguous, falling through to regex + LLM"
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        { error: msg },
        "Embedding classification unavailable, falling back to regex routing"
      );
    }
    return null;
  }

  private regexRouteTask(taskDescription: string): TaskRoutingResult[] {
    const description = taskDescription.toLowerCase();
    const candidates: TaskRoutingResult[] = [];

    const matchers: Array<{
      test: (d: string) => boolean;
      role: string;
      confidence: number;
      reasoning: string;
    }> = [
      {
        test: (d) => this.matchesRequirements(d),
        role: "discovery",
        confidence: 0.9,
        reasoning: "Task involves requirements gathering",
      },
      {
        test: (d) => this.matchesArchitecture(d),
        role: "architect",
        confidence: 0.9,
        reasoning: "Task involves architecture design",
      },
      {
        test: (d) => this.matchesPlanning(d),
        role: "planner",
        confidence: 0.85,
        reasoning: "Task involves planning or sprint creation",
      },
      {
        test: (d) => this.matchesFrontend(d),
        role: "frontend_coder",
        confidence: 0.85,
        reasoning: "Task involves frontend/UI work",
      },
      {
        test: (d) => this.matchesBackend(d),
        role: "backend_coder",
        confidence: 0.85,
        reasoning: "Task involves backend/API work",
      },
      {
        test: (d) => this.matchesTesting(d),
        role: "test_engineer",
        confidence: 0.9,
        reasoning: "Task involves writing tests",
      },
      {
        test: (d) => this.matchesSecurity(d),
        role: "security_auditor",
        confidence: 0.9,
        reasoning: "Task involves security audit",
      },
      {
        test: (d) => this.matchesDeployment(d),
        role: "deploy_engineer",
        confidence: 0.9,
        reasoning: "Task involves deployment",
      },
      {
        test: (d) => this.matchesIntegration(d),
        role: "integration_coder",
        confidence: 0.8,
        reasoning: "Task involves integration work",
      },
    ];

    for (const matcher of matchers) {
      if (matcher.test(description)) {
        candidates.push({
          agentRole: matcher.role,
          confidence: matcher.confidence,
          reasoning: matcher.reasoning,
        });
      }
    }

    return candidates;
  }

  private async llmDisambiguate(
    taskDescription: string,
    candidates: TaskRoutingResult[],
    agentLoop: import("./agent-loop").AgentLoop
  ): Promise<TaskRoutingResult | null> {
    const candidateList = candidates
      .slice(0, 3)
      .map((c, i) => `${i + 1}. ${c.agentRole} (${c.reasoning})`)
      .join("\n");

    const disambiguationPrompt = `You are a task router. Given the following task description, determine which agent role is the BEST fit.

Task: "${taskDescription}"

Candidate roles:
${candidateList}

Respond with ONLY the role name (e.g., "backend_coder") and a one-line reason. Format: ROLE: <role_name>\nREASON: <reason>`;

    try {
      const result = await agentLoop.executeTask(
        disambiguationPrompt,
        "orchestrator"
      );
      const roleMatch = result.output.match(LLM_ROUTE_ROLE_RE);
      if (roleMatch) {
        const selectedRole = roleMatch[1];
        const candidate = candidates.find((c) => c.agentRole === selectedRole);
        if (candidate) {
          return {
            ...candidate,
            confidence: 0.95,
            reasoning: `LLM-selected: ${candidate.reasoning}`,
          };
        }
      }
    } catch {
      this.logger.warn("LLM disambiguation failed, using regex result");
    }
    return null;
  }

  private static readonly PHASE_PROGRESS: Record<string, number> = {
    discovery: 10,
    architecture: 20,
    planning: 30,
    spec_first: 40,
    coding: 60,
    visual_verify: 70,
    testing: 75,
    spec_validation: 80,
    ci_loop: 85,
    security: 90,
    deploy: 95,
    property_testing: 98,
  };

  private async publishPhaseUpdate(
    phase: string,
    status: string
  ): Promise<void> {
    this.logger.info({ phase, status }, "Phase update");

    if (this.currentSessionId) {
      await this.eventPublisher.publishSessionEvent(this.currentSessionId, {
        type: QueueEvents.PLAN_UPDATE,
        data: { phase, status },
        timestamp: new Date().toISOString(),
      });

      // Emit granular task progress event
      if (this.currentTaskId) {
        const baseProgress = TaskRouter.PHASE_PROGRESS[phase] ?? 50;
        const progress =
          status === "completed" ? baseProgress : Math.max(baseProgress - 5, 0);
        const taskPhase = status === "completed" ? "reviewing" : "executing";
        await this.sessionManager.emitTaskProgress(
          this.currentSessionId,
          this.currentTaskId,
          taskPhase as import("@prometheus/types").TaskPhase,
          progress,
          `${phase}: ${status}`
        );
      }
    }
  }

  /**
   * Adapt the pipeline based on task complexity.
   *
   * - Simple tasks: skip discovery/planning, go straight to coding
   * - Medium tasks: abbreviated discovery -> code -> test
   * - Complex tasks: full pipeline with all phases
   * - Critical tasks: full pipeline + MoA + extra review passes
   */
  adaptPipeline(
    taskDescription: string,
    complexityEstimate?: PipelineComplexity
  ): AdaptivePipeline {
    const complexity =
      complexityEstimate ?? this.estimateComplexity(taskDescription);

    switch (complexity) {
      case "simple":
        return {
          complexity: "simple",
          phases: ["coding", "testing"],
          useMoA: false,
          extraReviewPasses: 0,
        };

      case "medium":
        return {
          complexity: "medium",
          phases: ["discovery", "coding", "testing", "ci_loop"],
          useMoA: false,
          extraReviewPasses: 0,
        };

      case "complex":
        return {
          complexity: "complex",
          phases: [
            "discovery",
            "architecture",
            "planning",
            "spec_first",
            "coding",
            "testing",
            "ci_loop",
            "security",
            "deploy",
          ],
          useMoA: true,
          extraReviewPasses: 0,
        };

      case "critical":
        return {
          complexity: "critical",
          phases: [
            "discovery",
            "architecture",
            "planning",
            "spec_first",
            "coding",
            "visual_verify",
            "testing",
            "ci_loop",
            "property_testing",
            "security",
            "deploy",
          ],
          useMoA: true,
          extraReviewPasses: 2,
        };
      default:
        return {
          complexity: "medium",
          phases: ["discovery", "coding", "testing", "ci_loop"],
          useMoA: false,
          extraReviewPasses: 0,
        };
    }
  }

  /**
   * Estimate task complexity based on description keywords.
   */
  estimateComplexity(taskDescription: string): PipelineComplexity {
    const desc = taskDescription.toLowerCase();

    if (CRITICAL_KEYWORDS_RE.test(desc)) {
      return "critical";
    }
    if (COMPLEX_KEYWORDS_RE.test(desc)) {
      return "complex";
    }
    if (SIMPLE_KEYWORDS_RE.test(desc)) {
      return "simple";
    }

    // Heuristic: longer descriptions tend to be more complex
    const wordCount = desc.split(WHITESPACE_SPLIT_RE).length;
    if (wordCount > 100) {
      return "complex";
    }
    if (wordCount > 30) {
      return "medium";
    }
    return "simple";
  }

  private matchesRequirements(desc: string): boolean {
    return REQUIREMENTS_RE.test(desc);
  }

  private matchesArchitecture(desc: string): boolean {
    return ARCHITECTURE_RE.test(desc);
  }

  private matchesPlanning(desc: string): boolean {
    return PLANNING_RE.test(desc);
  }

  private matchesFrontend(desc: string): boolean {
    return FRONTEND_RE.test(desc);
  }

  private matchesBackend(desc: string): boolean {
    return BACKEND_RE.test(desc);
  }

  private matchesTesting(desc: string): boolean {
    return TESTING_RE.test(desc);
  }

  private matchesSecurity(desc: string): boolean {
    return SECURITY_RE.test(desc);
  }

  private matchesDeployment(desc: string): boolean {
    return DEPLOYMENT_RE.test(desc);
  }

  private matchesIntegration(desc: string): boolean {
    return INTEGRATION_RE.test(desc);
  }
}
