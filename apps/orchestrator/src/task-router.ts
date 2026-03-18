import { createLogger } from "@prometheus/logger";
import { db } from "@prometheus/db";
import { tasks } from "@prometheus/db";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentRole, AgentMode } from "@prometheus/types";
import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import type { SessionManager } from "./session-manager";
import { DiscoveryPhase, type DiscoveryResult } from "./phases/discovery";
import { ArchitecturePhase, type ArchitectureResult } from "./phases/architecture";
import { PlanningPhase, type SprintPlan } from "./phases/planning";
import { CILoopRunner, type CILoopResult } from "./ci-loop/ci-loop-runner";
import { eq } from "drizzle-orm";

interface TaskRoutingResult {
  agentRole: string;
  confidence: number;
  reasoning: string;
}

interface TaskProcessingResult {
  success: boolean;
  taskId: string;
  sessionId: string;
  mode: string;
  results: AgentExecutionResult[];
  totalCreditsConsumed: number;
  discoveryResult?: DiscoveryResult;
  architectureResult?: ArchitectureResult;
  sprintPlan?: SprintPlan;
  ciResult?: CILoopResult;
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
    const { taskId, sessionId, projectId, orgId, userId, title, description, mode, agentRole } = params;
    const taskDescription = description ?? title;
    const results: AgentExecutionResult[] = [];
    let totalCreditsConsumed = 0;
    this.currentSessionId = sessionId;

    this.logger.info({ taskId, mode, agentRole }, "Processing task");

    // Update task status to running
    await db.update(tasks).set({
      status: "running",
      startedAt: new Date(),
    }).where(eq(tasks.id, taskId));

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.TASK_STATUS,
      data: { taskId, status: "running", mode },
      timestamp: new Date().toISOString(),
    });

    try {
      // Get or create an active session
      let activeSession = this.sessionManager.getSession(sessionId);
      if (!activeSession) {
        const session = await this.sessionManager.createSession({
          projectId, userId, orgId, mode,
        }, sessionId);
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
          const planResult = await this.processPlanMode(agentLoop, taskDescription);
          results.push(...planResult.results);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();

          // Mark task complete with plan result
          await db.update(tasks).set({
            status: "completed",
            completedAt: new Date(),
            creditsConsumed: totalCreditsConsumed,
          }).where(eq(tasks.id, taskId));

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
          const taskResult = await this.processTaskMode(agentLoop, taskDescription, agentRole);
          results.push(...taskResult.results);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();

          // Mark task complete
          const success = taskResult.results.every((r) => r.success);
          await db.update(tasks).set({
            status: success ? "completed" : "failed",
            completedAt: new Date(),
            creditsConsumed: totalCreditsConsumed,
          }).where(eq(tasks.id, taskId));

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
          const fleetResult = await this.processFleetMode(agentLoop, taskDescription, params);
          results.push(...fleetResult);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();
          break;
        }

        case "watch": {
          // Watch mode: agent monitors file changes and provides suggestions
          const watchResult = await agentLoop.executeTask(
            `Watch mode: Monitor this project and provide real-time suggestions for:\n${taskDescription}\n\nWatch for file changes, catch bugs, suggest improvements, and flag potential issues. Operate as a pair programming assistant.`,
            "ci_loop",
          );
          results.push(watchResult);
          totalCreditsConsumed += agentLoop.getCreditsConsumed();
          break;
        }

        default: {
          // If a specific agent role was requested, run it directly
          if (agentRole) {
            const result = await agentLoop.executeTask(taskDescription, agentRole);
            results.push(result);
            totalCreditsConsumed += agentLoop.getCreditsConsumed();
          } else {
            // Route based on task description analysis
            const routing = this.routeTask(taskDescription);
            const result = await agentLoop.executeTask(taskDescription, routing.agentRole);
            results.push(result);
            totalCreditsConsumed += agentLoop.getCreditsConsumed();
          }
          break;
        }
      }

      // Update task as completed
      const allSuccess = results.every((r) => r.success);
      await db.update(tasks).set({
        status: allSuccess ? "completed" : "failed",
        completedAt: new Date(),
        creditsConsumed: totalCreditsConsumed,
      }).where(eq(tasks.id, taskId));

      await this.eventPublisher.publishSessionEvent(sessionId, {
        type: QueueEvents.TASK_STATUS,
        data: {
          taskId,
          status: allSuccess ? "completed" : "failed",
          creditsConsumed: totalCreditsConsumed,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        success: allSuccess,
        taskId,
        sessionId,
        mode,
        results,
        totalCreditsConsumed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ taskId, error: errorMessage }, "Task processing failed");

      await db.update(tasks).set({
        status: "failed",
        completedAt: new Date(),
        creditsConsumed: totalCreditsConsumed,
      }).where(eq(tasks.id, taskId));

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
    taskDescription: string,
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

    return agentLoop.executeTask(prompt, "discovery");
  }

  /**
   * Plan mode: Discovery -> Architect -> Planner (stop before execution).
   */
  private async processPlanMode(
    agentLoop: import("./agent-loop").AgentLoop,
    taskDescription: string,
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
    const discoveryResult = await discoveryPhase.execute(agentLoop, taskDescription);
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
    const architectureResult = await architecturePhase.execute(agentLoop, discoveryResult.srs);
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

    // Phase 3: Planning
    await this.publishPhaseUpdate("planning", "running");
    const planningPhase = new PlanningPhase();
    const sprintPlan = await planningPhase.execute(agentLoop, architectureResult.blueprint);
    results.push({
      success: true,
      output: JSON.stringify(sprintPlan),
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
   */
  private async processTaskMode(
    agentLoop: import("./agent-loop").AgentLoop,
    taskDescription: string,
    specificRole: AgentRole | null,
  ): Promise<{
    results: AgentExecutionResult[];
    discoveryResult?: DiscoveryResult;
    architectureResult?: ArchitectureResult;
    sprintPlan?: SprintPlan;
    ciResult?: CILoopResult;
  }> {
    this.logger.info("Processing in TASK mode");
    const results: AgentExecutionResult[] = [];

    // If a specific agent role was provided, skip the planning phases
    // and go directly to execution
    if (specificRole) {
      const routing = this.routeTask(taskDescription);
      const role = specificRole || routing.agentRole;
      const result = await agentLoop.executeTask(taskDescription, role);
      results.push(result);
      return { results };
    }

    // Full pipeline

    // Phase 1: Discovery
    await this.publishPhaseUpdate("discovery", "running");
    const discoveryPhase = new DiscoveryPhase();
    const discoveryResult = await discoveryPhase.execute(agentLoop, taskDescription);
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
    const architectureResult = await architecturePhase.execute(agentLoop, discoveryResult.srs);
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

    // Phase 3: Planning
    await this.publishPhaseUpdate("planning", "running");
    const planningPhase = new PlanningPhase();
    const sprintPlan = await planningPhase.execute(agentLoop, architectureResult.blueprint);
    results.push({
      success: true,
      output: JSON.stringify(sprintPlan),
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
    });
    await this.publishPhaseUpdate("planning", "completed");

    // Phase 4: Execute sprint tasks in dependency order
    await this.publishPhaseUpdate("coding", "running");
    const executionResults = await this.executeSprintPlan(agentLoop, sprintPlan, architectureResult.blueprint);
    results.push(...executionResults);
    await this.publishPhaseUpdate("coding", "completed");

    // Phase 5: Testing
    await this.publishPhaseUpdate("testing", "running");
    const testResult = await agentLoop.executeTask(
      `Write comprehensive tests for the implementation based on the sprint plan and blueprint.\n\nBlueprint:\n${architectureResult.blueprint}\n\nSprint Plan:\n${JSON.stringify(sprintPlan, null, 2)}`,
      "test_engineer"
    );
    results.push(testResult);
    await this.publishPhaseUpdate("testing", "completed");

    // Phase 6: CI Loop
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
    await this.publishPhaseUpdate("ci_loop", ciResult.passed ? "completed" : "failed");

    // Phase 7: Security audit
    await this.publishPhaseUpdate("security", "running");
    const securityResult = await agentLoop.executeTask(
      `Perform a security audit on the implemented code. Check for:\n- OWASP Top 10 vulnerabilities\n- Input validation issues\n- Authentication/authorization gaps\n- SQL injection risks\n- XSS vulnerabilities\n- Insecure dependencies`,
      "security_auditor"
    );
    results.push(securityResult);
    await this.publishPhaseUpdate("security", "completed");

    // Phase 8: Deploy preparation
    await this.publishPhaseUpdate("deploy", "running");
    const deployResult = await agentLoop.executeTask(
      `Prepare deployment configuration for the implemented features:\n- Verify Dockerfiles\n- Update k8s manifests if needed\n- Ensure CI/CD pipeline configuration\n- Create migration scripts if needed`,
      "deploy_engineer"
    );
    results.push(deployResult);
    await this.publishPhaseUpdate("deploy", "completed");

    return { results, discoveryResult, architectureResult, sprintPlan, ciResult };
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
    },
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
        const streamTasks = sprintPlan.tasks.filter((t) => streamTaskIds.includes(t.id));

        const streamPromises = streamTasks.map(async (task) => {
          // Create a separate AgentLoop for each parallel agent
          const { AgentLoop: AgentLoopClass } = await import("./agent-loop");
          const parallelLoop = new AgentLoopClass(
            params.sessionId,
            params.projectId,
            params.orgId,
            params.userId,
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
              error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
            });
          }
        }
      }
    } else {
      // No explicit workstreams, execute tasks sequentially respecting dependencies
      const executionResults = await this.executeSprintPlan(agentLoop, sprintPlan, architectureResult.blueprint);
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
    blueprint: string,
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
        (t) => !completed.has(t.id) && t.dependencies.every((dep) => completed.has(dep))
      );

      if (ready.length === 0 && completed.size < allTasks.length) {
        this.logger.warn("Dependency deadlock detected, forcing remaining tasks");
        const remaining = allTasks.filter((t) => !completed.has(t.id));
        ready.push(...remaining);
      }

      // Execute ready tasks (could be parallelized in fleet mode)
      for (const task of ready) {
        const enrichedDesc = `${task.description}\n\nBlueprint:\n${blueprint}\n\nAcceptance Criteria:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;

        const result = await agentLoop.executeTask(enrichedDesc, task.agentRole);
        results.push(result);
        completed.add(task.id);

        this.logger.info({
          taskId: task.id,
          role: task.agentRole,
          success: result.success,
          progress: `${completed.size}/${allTasks.length}`,
        }, "Sprint task completed");
      }
    }

    return results;
  }

  /**
   * Rule-based task routing: analyze the task description to determine
   * the best agent role for a single-shot execution.
   */
  routeTask(taskDescription: string, projectContext?: string): TaskRoutingResult {
    const description = taskDescription.toLowerCase();

    if (this.matchesRequirements(description)) {
      return { agentRole: "discovery", confidence: 0.9, reasoning: "Task involves requirements gathering" };
    }
    if (this.matchesArchitecture(description)) {
      return { agentRole: "architect", confidence: 0.9, reasoning: "Task involves architecture design" };
    }
    if (this.matchesPlanning(description)) {
      return { agentRole: "planner", confidence: 0.85, reasoning: "Task involves planning or sprint creation" };
    }
    if (this.matchesFrontend(description)) {
      return { agentRole: "frontend_coder", confidence: 0.85, reasoning: "Task involves frontend/UI work" };
    }
    if (this.matchesBackend(description)) {
      return { agentRole: "backend_coder", confidence: 0.85, reasoning: "Task involves backend/API work" };
    }
    if (this.matchesTesting(description)) {
      return { agentRole: "test_engineer", confidence: 0.9, reasoning: "Task involves writing tests" };
    }
    if (this.matchesSecurity(description)) {
      return { agentRole: "security_auditor", confidence: 0.9, reasoning: "Task involves security audit" };
    }
    if (this.matchesDeployment(description)) {
      return { agentRole: "deploy_engineer", confidence: 0.9, reasoning: "Task involves deployment" };
    }
    if (this.matchesIntegration(description)) {
      return { agentRole: "integration_coder", confidence: 0.8, reasoning: "Task involves integration work" };
    }

    // Default to orchestrator for complex/ambiguous tasks
    return { agentRole: "orchestrator", confidence: 0.5, reasoning: "Task is complex or ambiguous, needs orchestration" };
  }

  private async publishPhaseUpdate(phase: string, status: string): Promise<void> {
    this.logger.info({ phase, status }, "Phase update");

    if (this.currentSessionId) {
      await this.eventPublisher.publishSessionEvent(this.currentSessionId, {
        type: QueueEvents.PLAN_UPDATE,
        data: { phase, status },
        timestamp: new Date().toISOString(),
      });
    }
  }

  private matchesRequirements(desc: string): boolean {
    return /\b(requirements?|user stor(?:y|ies)?|acceptance criteria|scope|srs|discover|elicit|interview)\b/.test(desc);
  }

  private matchesArchitecture(desc: string): boolean {
    return /\b(architect|blueprint|schema|data model|tech stack|adr|system design|api contract)\b/.test(desc);
  }

  private matchesPlanning(desc: string): boolean {
    return /\b(plan|sprint|roadmap|milestone|timeline|schedule|backlog|epic)\b/.test(desc);
  }

  private matchesFrontend(desc: string): boolean {
    return /\b(component|page|ui|ux|frontend|react|next\.?js|tailwind|css|layout|form|button|modal|sidebar|dashboard)\b/.test(desc);
  }

  private matchesBackend(desc: string): boolean {
    return /\b(api|endpoint|route|controller|service|middleware|database|query|migration|trpc|crud|webhook)\b/.test(desc);
  }

  private matchesTesting(desc: string): boolean {
    return /\b(tests?|specs?|coverage|vitest|playwright|e2e|unit tests?|integration tests?|assert|expect)\b/.test(desc);
  }

  private matchesSecurity(desc: string): boolean {
    return /\b(security|audit|vulnerabilit|owasp|injection|xss|csrf|auth.*bypass|penetration|cve)\b/.test(desc);
  }

  private matchesDeployment(desc: string): boolean {
    return /\b(deploy|docker|kubernetes|k8s|k3s|ci.?cd|github action|helm|traefik|nginx|ssl|tls)\b/.test(desc);
  }

  private matchesIntegration(desc: string): boolean {
    return /\b(integrat|connect|wire|hook up|link|bind|api call|fetch data|real.?time)\b/.test(desc);
  }
}
