import type {
  AgentContext,
  AgentExecutionResult,
  BaseAgent,
  ToolCall,
} from "@prometheus/agent-sdk";
import { AGENT_ROLES, TOOL_REGISTRY } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentRole } from "@prometheus/types";
import { BlueprintEnforcer } from "./blueprint-enforcer";
import { type ConfidenceResult, ConfidenceScorer } from "./confidence";

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

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

/** Maximum consecutive failures on the same step before triggering a blocker. */
const BLOCKER_THRESHOLD = 3;

/**
 * AgentLoop manages the full lifecycle of a single agent execution:
 * loading context, running the LLM loop with tool calls, tracking
 * credits consumed, and handling blockers.
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
  private readonly confidenceScorer: ConfidenceScorer;
  private readonly blueprintEnforcer: BlueprintEnforcer;
  private consecutiveFailures = 0;
  private totalCreditsConsumed = 0;
  private lastConfidence: ConfidenceResult | null = null;
  private activeAgent: BaseAgent | null = null;

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
    this.confidenceScorer = new ConfidenceScorer();
    this.blueprintEnforcer = new BlueprintEnforcer();
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
   * Load context from Project Brain service. This fetches the active
   * blueprint, recent CI results, and sprint state for the project.
   */
  private async loadProjectBrainContext(): Promise<ProjectBrainContext> {
    const defaultCtx: ProjectBrainContext = {
      blueprintContent: null,
      recentCIResults: null,
      sprintState: null,
      projectSummary: null,
    };

    try {
      const response = await fetch(
        `${PROJECT_BRAIN_URL}/api/projects/${this.projectId}/context`,
        {
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!response.ok) {
        this.logger.warn(
          { status: response.status },
          "Failed to load Project Brain context, continuing without it"
        );
        return defaultCtx;
      }

      const data = (await response.json()) as ProjectBrainContext;
      this.logger.info("Loaded Project Brain context");
      return data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        { error: msg },
        "Project Brain unavailable, continuing without context"
      );
      return defaultCtx;
    }
  }

  private createContext(
    brainContext: ProjectBrainContext,
    agentRole = "orchestrator"
  ): AgentContext {
    return {
      sessionId: this.sessionId,
      projectId: this.projectId,
      orgId: this.orgId,
      userId: this.userId,
      agentRole: agentRole as AgentRole,
      blueprintContent: brainContext.blueprintContent,
      projectContext: brainContext.projectSummary,
    };
  }

  /**
   * Select the model router slot based on the agent role.
   */
  private selectSlotForRole(agentRole: string): string {
    const slotMap: Record<string, string> = {
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
    };
    return slotMap[agentRole] ?? "default";
  }

  /**
   * Execute a task with a specific agent role. This is the main entry
   * point called by the TaskRouter and phase runners.
   */
  async executeTask(
    taskDescription: string,
    agentRole: string
  ): Promise<AgentExecutionResult> {
    this.status = "running";
    this.consecutiveFailures = 0;
    this.confidenceScorer.reset();

    // Load context from project brain
    const brainContext = await this.loadProjectBrainContext();
    const context = this.createContext(brainContext);

    // Phase 9.5: Load blueprint into enforcer
    await this.blueprintEnforcer.loadForProject(this.projectId).catch((err) => {
      this.logger.warn(
        { err },
        "Blueprint loading failed, continuing without enforcement"
      );
    });

    // Create agent instance
    const roleConfig = AGENT_ROLES[agentRole];
    if (!roleConfig) {
      throw new Error(`Unknown agent role: ${agentRole}`);
    }

    const agent = roleConfig.create();
    agent.initialize(context);
    this.activeAgent = agent;

    // Inject project context into the task description if available
    let enrichedDescription = taskDescription;
    if (brainContext.blueprintContent) {
      enrichedDescription += `\n\n--- Blueprint ---\n${brainContext.blueprintContent}`;
    }
    if (brainContext.sprintState) {
      enrichedDescription += `\n\n--- Current Sprint State ---\n${brainContext.sprintState}`;
    }
    if (brainContext.recentCIResults) {
      enrichedDescription += `\n\n--- Recent CI Results ---\n${brainContext.recentCIResults}`;
    }

    agent.addUserMessage(enrichedDescription);

    const iteration: LoopIteration = {
      iteration: this.iterations.length + 1,
      agentRole,
      startedAt: new Date(),
      completedAt: null,
      result: null,
    };

    this.logger.info(
      {
        iteration: iteration.iteration,
        agentRole,
      },
      "Starting agent execution"
    );

    // Publish status event
    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: {
        agentRole,
        status: "running",
        iteration: iteration.iteration,
      },
      agentRole,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await this.runAgentLoop(agent, context, agentRole);
      iteration.completedAt = new Date();
      iteration.result = result;
      this.iterations.push(iteration);
      this.status = "idle";
      this.activeAgent = null;

      // Publish completion event
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

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
      this.activeAgent = null;

      // Publish error event
      await this.eventPublisher.publishSessionEvent(this.sessionId, {
        type: QueueEvents.ERROR,
        data: { agentRole, error: errorMessage },
        agentRole,
        timestamp: new Date().toISOString(),
      });

      return iteration.result as NonNullable<typeof iteration.result>;
    }
  }

  /**
   * Core agent loop: send messages to LLM, parse tool calls, execute
   * them, and repeat until the agent completes or hits the iteration limit.
   */
  private async runAgentLoop(
    agent: BaseAgent,
    _context: AgentContext,
    agentRole: string
  ): Promise<AgentExecutionResult> {
    const maxIterations = 50;
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const filesChanged = new Set<string>();
    let lastOutput = "";
    let consecutiveErrors = 0;
    let staleIterations = 0;

    let slot = this.selectSlotForRole(agentRole);
    const toolDefs = agent.getToolDefinitions();

    // Phase 9.5: Inject blueprint context if available
    const blueprintContext = this.blueprintEnforcer.getContextForPrompt();
    if (blueprintContext) {
      agent.addUserMessage(
        `[System] Blueprint constraints for this project:\n${blueprintContext}`
      );
    }

    for (let i = 0; i < maxIterations; i++) {
      // Handle pause
      if (this.status === "paused") {
        await this.waitForResume();
      }
      if (this.status === "stopped") {
        break;
      }

      // Send messages to model-router
      const messages = agent.getMessages().map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
      }));

      let response: {
        choices: Array<{
          message: {
            role: string;
            content: string;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason: string;
        }>;
        usage: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          cost_usd: number;
        };
      };

      try {
        const routeResponse = await fetch(`${MODEL_ROUTER_URL}/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slot,
            messages,
            options: {
              tools: toolDefs.length > 0 ? toolDefs : undefined,
              temperature: 0.1,
              maxTokens: 4096,
            },
          }),
          signal: AbortSignal.timeout(120_000),
        });

        if (!routeResponse.ok) {
          const errBody = await routeResponse.text();
          throw new Error(
            `Model router returned ${routeResponse.status}: ${errBody}`
          );
        }

        response = (await routeResponse.json()) as typeof response;
      } catch (error) {
        consecutiveErrors++;
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error({ error: msg, iteration: i }, "LLM request failed");

        if (consecutiveErrors >= BLOCKER_THRESHOLD) {
          await this.publishBlocker(
            agentRole,
            `LLM call failed ${consecutiveErrors} times: ${msg}`
          );
          return {
            success: false,
            output: lastOutput,
            filesChanged: Array.from(filesChanged),
            tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
            toolCalls: totalToolCalls,
            steps: 0,
            creditsConsumed: 0,
            error: `Blocked after ${consecutiveErrors} consecutive LLM failures`,
          };
        }

        // Brief pause before retry
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Reset consecutive error counter on success
      consecutiveErrors = 0;

      // Track token usage
      totalInputTokens += response.usage.prompt_tokens;
      totalOutputTokens += response.usage.completion_tokens;

      // Track credits (1 credit per 1K tokens approximately)
      const creditsForRequest = Math.ceil(response.usage.total_tokens / 1000);
      this.totalCreditsConsumed += creditsForRequest;

      // Publish credit update
      await this.eventPublisher.publishSessionEvent(this.sessionId, {
        type: QueueEvents.CREDIT_UPDATE,
        data: {
          creditsConsumed: creditsForRequest,
          totalCreditsConsumed: this.totalCreditsConsumed,
          tokensUsed: response.usage.total_tokens,
        },
        timestamp: new Date().toISOString(),
      });

      const choice = response.choices[0];
      if (!choice) {
        this.logger.warn("Empty response from LLM");
        continue;
      }

      const assistantContent = choice.message.content ?? "";
      const toolCalls = choice.message.tool_calls;

      // Publish reasoning/output event for streaming to frontend
      if (assistantContent) {
        lastOutput = assistantContent;
        await this.eventPublisher.publishSessionEvent(this.sessionId, {
          type: QueueEvents.AGENT_OUTPUT,
          data: { content: assistantContent, agentRole, iteration: i },
          agentRole,
          timestamp: new Date().toISOString(),
        });
      }

      // If no tool calls, the agent is done
      if (!toolCalls || toolCalls.length === 0) {
        agent.addAssistantMessage(assistantContent);
        break;
      }

      // Add assistant message with tool calls
      const parsedToolCalls: ToolCall[] = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
      agent.addAssistantMessage(assistantContent, parsedToolCalls);

      // Execute each tool call
      for (const tc of toolCalls) {
        totalToolCalls++;
        const toolName = tc.function.name;
        const toolArgs = this.parseToolArgs(tc.function.arguments);

        this.logger.info(
          { tool: toolName, callId: tc.id },
          "Executing tool call"
        );

        // Phase 9.5: Blueprint pre-action validation
        if (this.blueprintEnforcer.isLoaded()) {
          let actionType:
            | "file_write"
            | "file_edit"
            | "terminal_exec"
            | "other";
          if (toolName === "file_write" || toolName === "file_edit") {
            actionType = toolName as "file_write" | "file_edit";
          } else if (toolName === "terminal_exec") {
            actionType = "terminal_exec";
          } else {
            actionType = "other";
          }
          const violations = this.blueprintEnforcer.validateAction({
            type: actionType,
            filePath:
              (toolArgs.path as string) ?? (toolArgs.filePath as string),
            content: toolArgs.content as string,
            command: toolArgs.command as string,
          });

          if (violations.length > 0) {
            const errors = violations.filter((v) => v.severity === "error");
            if (errors.length > 0) {
              // Block the action and inform the agent
              const violationMsg = errors
                .map((v) => `- ${v.description}`)
                .join("\n");
              agent.addToolResult(
                tc.id,
                JSON.stringify({
                  success: false,
                  error: `Blueprint violation(s) blocked this action:\n${violationMsg}`,
                })
              );
              this.logger.warn(
                { toolName, violations: errors.length },
                "Blueprint violations blocked tool call"
              );
              continue;
            }

            // Warnings: let the action proceed but inform the agent
            const _warningMsg = violations
              .map((v) => `- [${v.severity}] ${v.description}`)
              .join("\n");
            this.logger.info(
              { toolName, warnings: violations.length },
              "Blueprint warnings for tool call"
            );
            // We'll append warnings after the tool result below
          }
        }

        // Risk gating: detect destructive commands
        if (
          toolName === "terminal_exec" &&
          toolArgs.command &&
          this.isDestructiveCommand(String(toolArgs.command))
        ) {
          this.logger.warn(
            { command: toolArgs.command, agentRole },
            "Destructive command detected, requesting approval"
          );

          // Publish checkpoint event for approval
          await this.eventPublisher.publishSessionEvent(this.sessionId, {
            type: QueueEvents.CHECKPOINT,
            data: {
              event: "destructive_command_blocked",
              command: toolArgs.command,
              agentRole,
              reason:
                "This command was detected as potentially destructive and requires approval.",
            },
            agentRole,
            timestamp: new Date().toISOString(),
          });

          agent.addToolResult(
            tc.id,
            JSON.stringify({
              success: false,
              error:
                "Destructive command blocked: This operation requires human approval. The command has been flagged for review.",
            })
          );
          continue;
        }

        const toolDef = TOOL_REGISTRY[toolName];
        if (!toolDef) {
          agent.addToolResult(
            tc.id,
            JSON.stringify({
              success: false,
              error: `Unknown tool: ${toolName}`,
            })
          );
          continue;
        }

        try {
          const toolResult = await toolDef.execute(toolArgs, {
            sessionId: this.sessionId,
            projectId: this.projectId,
            sandboxId: this.sessionId, // sandbox scoped to session
            workDir: `/workspace/${this.projectId}`,
            orgId: this.orgId,
            userId: this.userId,
          });

          agent.addToolResult(tc.id, JSON.stringify(toolResult));

          // Track file changes
          if (toolResult.metadata?.filePath) {
            filesChanged.add(toolResult.metadata.filePath as string);
          }
          if (toolName === "file_write" || toolName === "file_edit") {
            const filePath = toolArgs.path ?? toolArgs.filePath;
            if (filePath) {
              filesChanged.add(String(filePath));
            }
          }

          // Publish file change event if applicable
          if (
            filesChanged.size > 0 &&
            (toolName === "file_write" || toolName === "file_edit")
          ) {
            await this.eventPublisher.publishSessionEvent(this.sessionId, {
              type: QueueEvents.FILE_CHANGE,
              data: {
                tool: toolName,
                filePath: toolArgs.path ?? toolArgs.filePath,
                agentRole,
              },
              agentRole,
              timestamp: new Date().toISOString(),
            });
          }

          // Publish terminal output for terminal_exec
          if (toolName === "terminal_exec" && toolResult.output) {
            await this.eventPublisher.publishSessionEvent(this.sessionId, {
              type: QueueEvents.TERMINAL_OUTPUT,
              data: {
                command: toolArgs.command,
                output: toolResult.output.slice(0, 5000), // cap to 5KB
                success: toolResult.success,
              },
              agentRole,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            { tool: toolName, error: errMsg },
            "Tool execution failed"
          );
          agent.addToolResult(
            tc.id,
            JSON.stringify({
              success: false,
              error: errMsg,
            })
          );

          // Track consecutive failures for blocker detection
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= BLOCKER_THRESHOLD) {
            await this.publishBlocker(
              agentRole,
              `Tool ${toolName} failed ${this.consecutiveFailures} times: ${errMsg}`
            );
            return {
              success: false,
              output: lastOutput,
              filesChanged: Array.from(filesChanged),
              tokensUsed: {
                input: totalInputTokens,
                output: totalOutputTokens,
              },
              toolCalls: totalToolCalls,
              steps: 0,
              creditsConsumed: 0,
              error: `Blocked: ${toolName} failed ${this.consecutiveFailures} consecutive times`,
            };
          }
        }
      }

      // Phase 9.4: Score confidence after each iteration with tool calls
      const iterationToolResults = toolCalls.map((tc) => {
        const toolDef = TOOL_REGISTRY[tc.function.name];
        return { success: !!toolDef, name: tc.function.name };
      });
      const signals = ConfidenceScorer.extractSignals(
        assistantContent,
        iterationToolResults,
        filesChanged.size,
        staleIterations,
        lastOutput.length
      );
      staleIterations = signals.staleIterations;

      const confidence = this.confidenceScorer.scoreIteration(signals);
      this.lastConfidence = confidence;

      // Publish confidence event
      await this.eventPublisher.publishSessionEvent(this.sessionId, {
        type: QueueEvents.AGENT_STATUS,
        data: {
          agentRole,
          confidence: confidence.score,
          action: confidence.action,
          iteration: i,
        },
        timestamp: new Date().toISOString(),
      });

      // Phase 9.4: Adaptive model slot based on confidence
      if (confidence.recommendedSlot) {
        slot = ConfidenceScorer.getModelSlot(slot, confidence);
      }

      // Phase 9.4: Handle low confidence actions
      if (confidence.action === "escalate") {
        this.logger.warn(
          { confidence: confidence.score, iteration: i },
          "Low confidence - escalating"
        );
        await this.publishBlocker(
          agentRole,
          `Agent confidence dropped to ${confidence.score.toFixed(2)}. Factors: ${confidence.factors.map((f) => `${f.name}=${f.value.toFixed(2)}`).join(", ")}`
        );
        return {
          success: false,
          output: lastOutput,
          filesChanged: Array.from(filesChanged),
          tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
          toolCalls: totalToolCalls,
          steps: 0,
          creditsConsumed: 0,
          error: `Escalated due to low confidence (${confidence.score.toFixed(2)})`,
        };
      }

      if (confidence.action === "request_help") {
        // Add a hint to the agent that it should be more careful
        agent.addUserMessage(
          "[System] Your confidence appears moderate. Please verify your approach before proceeding, and be explicit about any uncertainties."
        );
      }
    }

    return {
      success: true,
      output: lastOutput,
      filesChanged: Array.from(filesChanged),
      tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
      toolCalls: totalToolCalls,
      steps: 0,
      creditsConsumed: 0,
    };
  }

  /**
   * Publish a human_input_needed event when the agent is blocked.
   */
  private async publishBlocker(
    agentRole: string,
    reason: string
  ): Promise<void> {
    this.logger.warn(
      { agentRole, reason },
      "Agent blocked, requesting human input"
    );
    this.status = "paused";

    await this.eventPublisher.publishSessionEvent(this.sessionId, {
      type: QueueEvents.ERROR,
      data: {
        event: "human_input_needed",
        agentRole,
        reason,
        consecutiveFailures: this.consecutiveFailures,
      },
      agentRole,
      timestamp: new Date().toISOString(),
    });

    // Also notify the user
    await this.eventPublisher.publishNotification(this.userId, {
      type: "human_input_needed",
      title: "Agent needs help",
      message: reason,
      data: { sessionId: this.sessionId, agentRole },
    });
  }

  /** Patterns that indicate destructive or dangerous operations. */
  private static readonly DESTRUCTIVE_PATTERNS = [
    /\brm\s+(-rf?|--recursive)\b/,
    /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\b/,
    /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bgit\s+push\s+--force\b/,
    /\bgit\s+push\s+-f\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\s+-[a-zA-Z]*f/,
    /\bDELETE\s+FROM\s+\S+\s*(;|\s*$)/i,
    /\bformat\s+[cC]:/,
    /\bsudo\s+rm\b/,
    /\bchmod\s+777\b/,
    /\bchown\s+-R\s+/,
  ];

  private isDestructiveCommand(command: string): boolean {
    return AgentLoop.DESTRUCTIVE_PATTERNS.some((pattern) =>
      pattern.test(command)
    );
  }

  private parseToolArgs(argsStr: string): Record<string, unknown> {
    try {
      return JSON.parse(argsStr);
    } catch {
      return { raw: argsStr };
    }
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

  pause(): void {
    this.status = "paused";
    this.logger.info("Agent loop paused");
  }

  resume(): void {
    this.status = "running";
    this.consecutiveFailures = 0;
    this.logger.info("Agent loop resumed");
  }

  stop(): void {
    this.status = "stopped";
    this.logger.info("Agent loop stopped");
  }
}
