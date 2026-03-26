import type { AgentExecutionResult, BaseAgent } from "@prometheus/agent-sdk";
import { db, sessionEvents } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { withSpan } from "@prometheus/telemetry";
import type { AgentRole } from "@prometheus/types";
import { generateId, projectBrainClient } from "@prometheus/utils";
import type { ConfidenceResult } from "./confidence";
import { SessionMemory } from "./continuity/session-memory";
import {
  createExecutionContext,
  ExecutionEngine,
  type ExecutionEvent,
  type ExecutionOptions,
} from "./engine";
import { ExecutionTracker } from "./feedback/execution-tracker";
import { LearningExtractor } from "./feedback/learning-extractor";
import {
  ServiceHealthMonitor,
  withGracefulDegradation,
} from "./resilience/service-health";

export type AgentLoopStatus = "idle" | "running" | "paused" | "stopped";

interface LoopIteration {
  agentRole: string;
  completedAt: Date | null;
  iteration: number;
  result: AgentExecutionResult | null;
  startedAt: Date;
}

interface ProjectBrainContext {
  blueprintContent: string | null;
  projectSummary: string | null;
  recentCIResults: string | null;
  sprintState: string | null;
}

const ROLE_SLOT_MAP: Record<string, string> = {
  orchestrator: "think",
  discovery: "longContext",
  architect: "think",
  planner: "think",
  frontend_coder: "default",
  backend_coder: "default",
  integration_coder: "fastLoop",
  test_engineer: "fastLoop",
  ci_loop: "fastLoop",
  security_auditor: "think",
  deploy_engineer: "default",
  documentation_specialist: "longContext",
  performance_optimizer: "think",
};

/**
 * AgentLoop is now a thin wrapper around the ExecutionEngine.
 * It manages session-level state (pause/resume/cancel), loads context
 * from Project Brain, and publishes events to Redis — but delegates
 * the core LLM loop to ExecutionEngine.execute().
 */
export class AgentLoop {
  private readonly logger;
  private readonly sessionId: string;
  private readonly projectId: string;
  private readonly orgId: string;
  private readonly userId: string;
  private status: AgentLoopStatus = "idle";
  private readonly iterations: LoopIteration[] = [];
  private readonly eventPublisher: EventPublisher;
  private readonly sessionMemory: SessionMemory;
  private readonly learningExtractor: LearningExtractor;
  private readonly executionTracker: ExecutionTracker;
  private readonly healthMonitor: ServiceHealthMonitor;
  private totalCreditsConsumed = 0;
  private lastConfidence: ConfidenceResult | null = null;
  private activeAgent: BaseAgent | null = null;
  private tokenBatchBuffer = "";
  private tokenBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private fileChangeBatch: Array<{ tool: string; filePath: string }> = [];
  private fileChangeBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private eventPersistBatch: Array<{
    type: string;
    data: Record<string, unknown>;
    agentRole?: string;
    timestamp: string;
  }> = [];
  private eventPersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    sessionId: string,
    projectId: string,
    orgId: string,
    userId: string
  ) {
    this.sessionId = sessionId;
    this.projectId = projectId;
    this.orgId = orgId;
    this.userId = userId;
    this.logger = createLogger(`agent-loop:${sessionId}`);
    this.eventPublisher = new EventPublisher();
    this.sessionMemory = new SessionMemory();
    this.executionTracker = new ExecutionTracker();
    this.learningExtractor = new LearningExtractor();
    this.healthMonitor = new ServiceHealthMonitor();
  }

  getLastConfidence(): ConfidenceResult | null {
    return this.lastConfidence;
  }

  getStatus(): AgentLoopStatus {
    return this.status;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getCreditsConsumed(): number {
    return this.totalCreditsConsumed;
  }

  getIterations(): LoopIteration[] {
    return [...this.iterations];
  }

  getActiveAgent(): BaseAgent | null {
    return this.activeAgent;
  }

  /**
   * Load context from Project Brain service.
   * Uses the /context/assemble endpoint which aggregates blueprint,
   * code context, sprint state, and CI results.
   */
  private async loadProjectBrainContext(): Promise<ProjectBrainContext> {
    const defaultCtx: ProjectBrainContext = {
      blueprintContent: null,
      recentCIResults: null,
      sprintState: null,
      projectSummary: null,
    };

    return await withGracefulDegradation(
      this.healthMonitor,
      "project-brain",
      async () => {
        const response = await projectBrainClient.post<{
          global?: string;
          session?: string;
          taskSpecific?: string;
        }>("/context/assemble", {
          projectId: this.projectId,
          sessionId: this.sessionId,
          taskDescription: "",
          agentRole: "orchestrator",
          maxTokens: 14_000,
        });
        this.logger.info("Loaded Project Brain context");

        return {
          blueprintContent: response.data.global ?? null,
          projectSummary: response.data.taskSpecific ?? null,
          recentCIResults: null,
          sprintState: response.data.session ?? null,
        };
      },
      defaultCtx,
      "loadProjectBrainContext"
    );
  }

  /**
   * Execute a task with a specific agent role. This is the main entry
   * point called by the TaskRouter and phase runners.
   *
   * Delegates to ExecutionEngine.execute() and translates events
   * into Redis pub/sub messages for the frontend.
   */
  executeTask(
    taskDescription: string,
    agentRole: string,
    options?: ExecutionOptions
  ): Promise<AgentExecutionResult> {
    return withSpan(`agent.executeTask.${agentRole}`, (span) => {
      span.setAttribute("session.id", this.sessionId);
      span.setAttribute("agent.role", agentRole);
      span.setAttribute("project.id", this.projectId);
      return this._executeTaskInner(taskDescription, agentRole, options);
    });
  }

  private async _executeTaskInner(
    taskDescription: string,
    agentRole: string,
    options?: ExecutionOptions
  ): Promise<AgentExecutionResult> {
    this.status = "running";

    const iteration: LoopIteration = {
      iteration: this.iterations.length + 1,
      agentRole,
      startedAt: new Date(),
      completedAt: null,
      result: null,
    };

    const ctx = await this.buildTaskContext(
      taskDescription,
      agentRole,
      iteration,
      options
    );

    try {
      const result = await this.consumeExecutionEvents(ctx, agentRole);
      return this.completeIteration(iteration, result, agentRole);
    } catch (error) {
      return this.failIteration(error, iteration, agentRole);
    }
  }

  private async buildTaskContext(
    taskDescription: string,
    agentRole: string,
    iteration: LoopIteration,
    options?: ExecutionOptions
  ): Promise<ReturnType<typeof createExecutionContext>> {
    const brainContext = await this.loadProjectBrainContext();
    const priorContext = await this.loadPriorContext();

    this.logger.info(
      { iteration: iteration.iteration, agentRole },
      "Starting agent execution"
    );

    await this.publishStartEvent(agentRole, iteration.iteration);

    const enrichedDescription = await this.enrichTaskDescription(
      taskDescription,
      agentRole
    );

    return createExecutionContext({
      sessionId: this.sessionId,
      projectId: this.projectId,
      orgId: this.orgId,
      userId: this.userId,
      agentRole: agentRole as AgentRole,
      taskDescription: enrichedDescription,
      sandboxId: this.sessionId,
      blueprintContent: brainContext.blueprintContent,
      projectContext: brainContext.projectSummary,
      sprintState: brainContext.sprintState,
      recentCIResults: brainContext.recentCIResults,
      priorSessionContext:
        priorContext.loaded && priorContext.context
          ? priorContext.context
          : null,
      options: {
        slot: ROLE_SLOT_MAP[agentRole] ?? "default",
        ...options,
      },
    });
  }

  private async loadPriorContext(): Promise<{
    loaded: boolean;
    priorSessions: number;
    context: string;
  }> {
    const priorContext = await this.sessionMemory
      .loadPriorContext(this.sessionId, this.projectId)
      .catch(() => ({ loaded: false, priorSessions: 0, context: "" }));

    if (priorContext.loaded && priorContext.context) {
      this.logger.info(
        { priorSessions: priorContext.priorSessions },
        "Loaded prior session context"
      );
    }

    return priorContext;
  }

  private async publishStartEvent(
    agentRole: string,
    iterationNum: number
  ): Promise<void> {
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: {
        agentRole,
        status: "running",
        iteration: iterationNum,
      },
      agentRole,
      timestamp: new Date().toISOString(),
    });
  }

  private async enrichTaskDescription(
    taskDescription: string,
    agentRole: string
  ): Promise<string> {
    const taskType = this.inferTaskType(taskDescription);
    const learnedContext = await this.learningExtractor
      .getLearnedContext(agentRole, taskType, this.projectId)
      .catch(() => "");

    return learnedContext
      ? `${taskDescription}\n\n${learnedContext}`
      : taskDescription;
  }

  private async consumeExecutionEvents(
    ctx: ReturnType<typeof createExecutionContext>,
    agentRole: string
  ): Promise<AgentExecutionResult> {
    let result: AgentExecutionResult | null = null;

    for await (const event of ExecutionEngine.execute(ctx)) {
      if (this.getStatus() === "paused") {
        await this.waitForResume();
      }
      if (this.getStatus() === "stopped") {
        break;
      }

      await this.publishExecutionEvent(event, agentRole);

      const eventResult = this.trackEventState(event, result);
      if (eventResult !== undefined) {
        result = eventResult;
      }
    }

    return (
      result ?? {
        success: false,
        output: "",
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        steps: 0,
        creditsConsumed: 0,
        error: "Execution completed without result",
      }
    );
  }

  private async completeIteration(
    iteration: LoopIteration,
    result: AgentExecutionResult,
    agentRole: string
  ): Promise<AgentExecutionResult> {
    iteration.completedAt = new Date();
    iteration.result = result;
    this.iterations.push(iteration);
    this.status = "idle";
    this.cleanup();

    await this.finalizeExecution(iteration, result, agentRole);
    return result;
  }

  private async failIteration(
    error: unknown,
    iteration: LoopIteration,
    agentRole: string
  ): Promise<AgentExecutionResult> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error({ error: errorMessage }, "Agent execution failed");

    iteration.completedAt = new Date();
    iteration.result = {
      success: false,
      output: "",
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: 0,
      creditsConsumed: 0,
      error: errorMessage,
    };
    this.iterations.push(iteration);
    this.status = "idle";
    this.cleanup();

    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.ERROR,
      data: { agentRole, error: errorMessage },
      agentRole,
      timestamp: new Date().toISOString(),
    });

    return iteration.result as NonNullable<typeof iteration.result>;
  }

  private async finalizeExecution(
    iteration: LoopIteration,
    result: AgentExecutionResult,
    agentRole: string
  ): Promise<void> {
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: {
        agentRole,
        status: result.success ? "completed" : "failed",
        tokensUsed: result.tokensUsed,
        toolCalls: result.toolCalls,
        filesChanged: result.filesChanged,
      },
      agentRole,
      timestamp: new Date().toISOString(),
    });

    this.sessionMemory
      .saveSessionSummary({
        sessionId: this.sessionId,
        projectId: this.projectId,
        outcome: result.success ? "completed" : "failed",
        filesChanged: result.filesChanged,
        creditsConsumed: result.creditsConsumed,
        duration: iteration.completedAt
          ? iteration.completedAt.getTime() - iteration.startedAt.getTime()
          : 0,
        decisions: [],
        blockers: result.error ? [result.error] : [],
      })
      .catch((err) => {
        this.logger.warn({ err }, "Failed to save session summary");
      });

    this.executionTracker
      .record({
        projectId: this.projectId,
        agentRole,
        taskType: agentRole,
        success: result.success,
        duration: iteration.completedAt
          ? iteration.completedAt.getTime() - iteration.startedAt.getTime()
          : 0,
        iterations: result.steps,
        tokensUsed: result.tokensUsed.input + result.tokensUsed.output,
        filesChanged: result.filesChanged.length,
        errorType: result.error,
      })
      .catch(() => {
        /* fire-and-forget */
      });
  }

  /**
   * Track internal state changes from execution events.
   * Returns a new result if the event produces one, otherwise undefined.
   */
  private trackEventState(
    event: ExecutionEvent,
    currentResult: AgentExecutionResult | null
  ): AgentExecutionResult | null | undefined {
    if (event.type === "confidence") {
      this.lastConfidence = {
        score: event.score,
        action: event.action,
        factors: event.factors.map((f) => ({
          name: f.name,
          value: f.value,
          weight: 0,
          contribution: 0,
        })),
        recommendedSlot: null,
      };
      return undefined;
    }

    if (event.type === "credit_update") {
      this.totalCreditsConsumed = event.totalCreditsConsumed;
      return undefined;
    }

    if (event.type === "complete") {
      return {
        success: event.success,
        output: event.output,
        filesChanged: event.filesChanged,
        tokensUsed: event.tokensUsed,
        toolCalls: event.toolCalls,
        steps: event.steps,
        creditsConsumed: event.creditsConsumed,
      };
    }

    if (event.type === "error" && !event.recoverable && !currentResult) {
      return {
        success: false,
        output: "",
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        steps: 0,
        creditsConsumed: 0,
        error: event.error,
      };
    }

    return undefined;
  }

  /**
   * Translate ExecutionEngine events to Redis pub/sub messages.
   */
  private async publishExecutionEvent(
    event: ExecutionEvent,
    agentRole: string
  ): Promise<void> {
    switch (event.type) {
      case "token":
        // Batch token events (50ms window) to reduce pub/sub pressure
        this.tokenBatchBuffer += event.content;
        if (!this.tokenBatchTimer) {
          this.tokenBatchTimer = setTimeout(() => {
            const content = this.tokenBatchBuffer;
            this.tokenBatchBuffer = "";
            this.tokenBatchTimer = null;
            if (content) {
              this.eventPublisher
                .publishSessionEvent(this.sessionId, {
                  type: QueueEvents.AGENT_OUTPUT,
                  data: { content, agentRole, streaming: true },
                  agentRole,
                  timestamp: new Date().toISOString(),
                })
                .catch(() => {
                  // best-effort batch publish
                });
            }
          }, 50);
        }
        break;

      case "tool_call":
        await this.eventPublisher.publishSessionEvent(this.sessionId, {
          type: QueueEvents.AGENT_OUTPUT,
          data: {
            type: "tool_call",
            tool: event.toolName,
            args: event.args,
            agentRole,
          },
          agentRole,
          timestamp: event.timestamp,
        });
        break;

      case "tool_result":
        await this.eventPublisher.publishSessionEvent(this.sessionId, {
          type: QueueEvents.AGENT_OUTPUT,
          data: {
            type: "tool_result",
            tool: event.toolName,
            success: event.success,
            output: event.output.slice(0, 2000),
            agentRole,
          },
          agentRole,
          timestamp: event.timestamp,
        });
        break;

      case "file_change":
        // Batch file_change events (200ms window)
        this.fileChangeBatch.push({
          tool: event.tool,
          filePath: event.filePath,
        });
        if (!this.fileChangeBatchTimer) {
          this.fileChangeBatchTimer = setTimeout(() => {
            const batch = [...this.fileChangeBatch];
            this.fileChangeBatch = [];
            this.fileChangeBatchTimer = null;
            for (const change of batch) {
              this.eventPublisher
                .publishSessionEvent(this.sessionId, {
                  type: QueueEvents.FILE_CHANGE,
                  data: {
                    tool: change.tool,
                    filePath: change.filePath,
                    agentRole,
                  },
                  agentRole,
                  timestamp: new Date().toISOString(),
                })
                .catch(() => {
                  // best-effort batch publish
                });
            }
          }, 200);
        }
        break;

      case "terminal_output":
        await this.eventPublisher.publishSessionEvent(this.sessionId, {
          type: QueueEvents.TERMINAL_OUTPUT,
          data: {
            command: event.command,
            output: event.output,
            success: event.success,
          },
          agentRole,
          timestamp: event.timestamp,
        });
        break;

      case "credit_update":
        await this.eventPublisher.publishSessionEvent(this.sessionId, {
          type: QueueEvents.CREDIT_UPDATE,
          data: {
            creditsConsumed: event.creditsConsumed,
            totalCreditsConsumed: event.totalCreditsConsumed,
          },
          timestamp: event.timestamp,
        });
        break;

      case "confidence":
        await this.eventPublisher.publishSessionEvent(this.sessionId, {
          type: QueueEvents.AGENT_STATUS,
          data: {
            agentRole,
            confidence: event.score,
            action: event.action,
            iteration: event.iteration,
          },
          timestamp: event.timestamp,
        });
        break;

      case "checkpoint":
        await this.eventPublisher.publishSessionEvent(this.sessionId, {
          type: QueueEvents.CHECKPOINT,
          data: {
            event: "strategic_checkpoint",
            checkpointType: event.checkpointType,
            agentRole,
            reason: event.reason,
            affectedFiles: event.affectedFiles,
          },
          agentRole,
          timestamp: event.timestamp,
        });
        break;

      case "error":
        if (!event.recoverable) {
          await this.eventPublisher.publishSessionEvent(this.sessionId, {
            type: QueueEvents.ERROR,
            data: {
              event: "human_input_needed",
              agentRole,
              reason: event.error,
            },
            agentRole,
            timestamp: event.timestamp,
          });
          await this.eventPublisher.publishNotification(this.userId, {
            type: "human_input_needed",
            title: "Agent needs help",
            message: event.error,
            data: { sessionId: this.sessionId, agentRole },
          });
        }
        break;

      // self_review and complete events don't need separate Redis publishing
      default:
        break;
    }

    // Batch-persist events to DB for session replay (fire-and-forget)
    this.eventPersistBatch.push({
      type: event.type,
      data: event as unknown as Record<string, unknown>,
      agentRole,
      timestamp: event.timestamp,
    });
    if (!this.eventPersistTimer) {
      this.eventPersistTimer = setTimeout(() => {
        this.flushEventPersistBatch();
      }, 500);
    }
  }

  private flushEventPersistBatch(): void {
    const batch = [...this.eventPersistBatch];
    this.eventPersistBatch = [];
    this.eventPersistTimer = null;
    if (batch.length === 0) {
      return;
    }

    const rows = batch.map((evt) => ({
      id: generateId("evt"),
      sessionId: this.sessionId,
      type: evt.type as "agent_output",
      data: evt.data,
      agentRole: evt.agentRole ?? null,
      timestamp: new Date(evt.timestamp),
    }));

    db.insert(sessionEvents)
      .values(rows)
      .catch((err) => {
        this.logger.warn(
          { err, count: rows.length },
          "Event batch persist failed"
        );
      });
  }

  /**
   * Infer a coarse task type from the description for memory lookup.
   */
  private inferTaskType(description: string): string {
    const lower = description.toLowerCase();
    if (lower.includes("bug") || lower.includes("fix")) {
      return "bugfix";
    }
    if (lower.includes("test")) {
      return "testing";
    }
    if (lower.includes("refactor")) {
      return "refactoring";
    }
    if (lower.includes("deploy") || lower.includes("ci")) {
      return "deployment";
    }
    if (lower.includes("security") || lower.includes("audit")) {
      return "security";
    }
    if (lower.includes("document")) {
      return "documentation";
    }
    return "feature";
  }

  private waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.status === "paused") {
          setTimeout(check, 500);
        } else {
          resolve();
        }
      };
      check();
    });
  }

  async pause(): Promise<void> {
    this.status = "paused";
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { status: "paused", sessionId: this.sessionId },
      timestamp: new Date().toISOString(),
    });
    this.logger.info("Agent loop paused");
  }

  async resume(): Promise<void> {
    this.status = "running";
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { status: "resumed", sessionId: this.sessionId },
      timestamp: new Date().toISOString(),
    });
    this.logger.info("Agent loop resumed");
  }

  async stop(): Promise<void> {
    this.status = "stopped";
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { status: "stopped", sessionId: this.sessionId },
      timestamp: new Date().toISOString(),
    });
    this.logger.info("Agent loop stopped");
  }

  /**
   * Clean up resources: clear batch timers, flush pending batches.
   * Called after task completion (success or error).
   */
  cleanup(): void {
    if (this.tokenBatchTimer) {
      clearTimeout(this.tokenBatchTimer);
      this.tokenBatchTimer = null;
      this.tokenBatchBuffer = "";
    }
    if (this.fileChangeBatchTimer) {
      clearTimeout(this.fileChangeBatchTimer);
      this.fileChangeBatchTimer = null;
      this.fileChangeBatch = [];
    }
    if (this.eventPersistTimer) {
      clearTimeout(this.eventPersistTimer);
      this.eventPersistTimer = null;
    }
    // Flush any remaining events to DB
    this.flushEventPersistBatch();
    this.activeAgent = null;
    this.logger.debug("Agent loop cleaned up");
  }
}
