import { createLLMClient, type ModelProvider } from "@prometheus/ai";
import { createLogger, type Logger } from "@prometheus/logger";
import type { AgentRole } from "@prometheus/types";
import { TOOL_REGISTRY, ToolRegistry } from "./tools/registry";
import type { AgentToolDefinition, ToolExecutionContext } from "./tools/types";
// We use inline type assertions rather than importing OpenAI types directly
// to avoid module resolution issues with pnpm hoisting.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentContext {
  agentRole: AgentRole;
  blueprintContent: string | null;
  memory?: AgentMessage[];
  model?: string;
  orgId: string;
  projectContext: string | null;
  projectId: string;
  sandboxId?: string;
  sessionId: string;
  tools?: string[];
  userId: string;
  workDir?: string;
}

export interface AgentMessage {
  content: string | null;
  role: "system" | "user" | "assistant" | "tool";
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  arguments: string;
  id: string;
  name: string;
}

export interface AgentExecutionResult {
  askUserPending?: {
    question: string;
    options: string[];
    context: string;
  };
  blockerEscalated?: boolean;
  creditsConsumed: number;
  error?: string;
  filesChanged: string[];
  killRequests?: Array<{
    agentId: string;
    reason: string;
  }>;
  output: string;
  spawnRequests?: Array<{
    role: string;
    task: string;
    dependencies: string[];
    priority: number;
  }>;
  steps: number;
  success: boolean;
  tokensUsed: { input: number; output: number };
  toolCalls: number;
}

export interface EventPublisherInterface {
  publishSessionEvent(
    sessionId: string,
    event: {
      type: string;
      data: Record<string, unknown>;
      agentRole?: string;
      timestamp: string;
    }
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STEPS = 100;
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const MAX_CONTEXT_MESSAGES = 200;
const DEFAULT_SANDBOX_ID = "local";
const DEFAULT_WORK_DIR = "/workspace";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveTools(names: string[]): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = [];
  for (const name of names) {
    const tool = TOOL_REGISTRY[name];
    if (tool) {
      tools.push(tool);
    }
  }
  return tools;
}

function parseModelString(modelStr: string): {
  provider: string;
  model: string;
} {
  const slashIdx = modelStr.indexOf("/");
  if (slashIdx === -1) {
    return { provider: "ollama", model: modelStr };
  }
  return {
    provider: modelStr.slice(0, slashIdx),
    model: modelStr.slice(slashIdx + 1),
  };
}

function truncateOutput(output: string, maxLen = 20_000): string {
  if (output.length <= maxLen) {
    return output;
  }
  const half = Math.floor(maxLen / 2) - 50;
  return (
    output.slice(0, half) +
    `\n\n... [${output.length - maxLen} characters truncated] ...\n\n` +
    output.slice(-half)
  );
}

// ---------------------------------------------------------------------------
// BaseAgent
// ---------------------------------------------------------------------------

export abstract class BaseAgent {
  protected readonly role: AgentRole;
  protected readonly logger: Logger;
  protected readonly tools: AgentToolDefinition[];
  protected readonly toolRegistry: ToolRegistry;
  protected messages: AgentMessage[] = [];
  protected context: AgentContext | null = null;
  protected eventPublisher: EventPublisherInterface | null = null;

  // Execution state
  protected stepCount = 0;
  protected consecutiveFailures = 0;
  protected tokensUsed = { input: 0, output: 0 };
  protected creditsConsumed = 0;
  protected toolCallCount = 0;
  protected filesChanged: Set<string> = new Set();
  protected spawnRequests: Array<{
    role: string;
    task: string;
    dependencies: string[];
    priority: number;
  }> = [];
  protected killRequests: Array<{ agentId: string; reason: string }> = [];

  constructor(role: AgentRole, tools: AgentToolDefinition[] = []) {
    this.role = role;
    this.logger = createLogger(`agent:${role}`);
    this.tools = tools;
    this.toolRegistry = new ToolRegistry(tools);
  }

  // ---------------------------------------------------------------------------
  // Abstract methods for subclasses
  // ---------------------------------------------------------------------------

  abstract getSystemPrompt(context: AgentContext): string;
  abstract getPreferredModel(): string;

  /**
   * Return the list of tool names this agent is allowed to use.
   * Defaults to the tools passed in the constructor.
   */
  getAllowedTools(): string[] {
    return this.tools.map((t) => t.name);
  }

  /**
   * Return the model string (provider/model) this agent should use.
   * Can be overridden by context.model.
   */
  getModel(): string {
    return this.context?.model ?? this.getPreferredModel();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  initialize(context: AgentContext): void {
    this.context = context;
    this.stepCount = 0;
    this.consecutiveFailures = 0;
    this.tokensUsed = { input: 0, output: 0 };
    this.creditsConsumed = 0;
    this.toolCallCount = 0;
    this.filesChanged = new Set();
    this.spawnRequests = [];
    this.killRequests = [];

    // If additional tools are specified in context, merge them
    if (context.tools && context.tools.length > 0) {
      const additional = resolveTools(context.tools);
      for (const tool of additional) {
        if (!this.toolRegistry.resolve(tool.name)) {
          this.toolRegistry.register(tool);
        }
      }
    }

    // Build initial message history
    this.messages = [
      { role: "system", content: this.getSystemPrompt(context) },
    ];

    // Restore memory if provided (for agent resume)
    if (context.memory && context.memory.length > 0) {
      for (const msg of context.memory) {
        if (msg.role !== "system") {
          this.messages.push(msg);
        }
      }
    }

    this.logger.info(
      { sessionId: context.sessionId, role: this.role },
      "Agent initialized"
    );
  }

  /**
   * Attach an event publisher for streaming events to clients via Redis Pub/Sub.
   */
  setEventPublisher(publisher: EventPublisherInterface): void {
    this.eventPublisher = publisher;
  }

  // ---------------------------------------------------------------------------
  // Message management
  // ---------------------------------------------------------------------------

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    this.messages.push({ role: "assistant", content, toolCalls });
  }

  addToolResult(toolCallId: string, result: string): void {
    this.messages.push({ role: "tool", content: result, toolCallId });
  }

  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  getToolDefinitions(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return this.toolRegistry.getOpenAIToolDefs();
  }

  // ---------------------------------------------------------------------------
  // Context window management
  // ---------------------------------------------------------------------------

  /**
   * Trim message history to stay within context limits.
   * Preserves the system message and recent messages, summarizing old ones.
   */
  private trimMessages(): void {
    if (this.messages.length <= MAX_CONTEXT_MESSAGES) {
      return;
    }

    const systemMsg = this.messages[0] as (typeof this.messages)[0];
    const recentCount = Math.floor(MAX_CONTEXT_MESSAGES * 0.7);
    const recentMessages = this.messages.slice(-recentCount);

    // Summarize the middle section that's being dropped
    const droppedCount = this.messages.length - 1 - recentCount;

    const summaryMsg: AgentMessage = {
      role: "system",
      content: `[Context trimmed: ${droppedCount} earlier messages were removed to stay within limits. The conversation continues from the most recent messages below.]`,
    };

    this.messages = [systemMsg, summaryMsg, ...recentMessages];
    this.logger.info({ droppedCount }, "Trimmed message history");
  }

  // ---------------------------------------------------------------------------
  // Event publishing
  // ---------------------------------------------------------------------------

  private async publishEvent(
    type: string,
    data: Record<string, unknown>
  ): Promise<void> {
    if (!(this.eventPublisher && this.context)) {
      return;
    }
    try {
      await this.eventPublisher.publishSessionEvent(this.context.sessionId, {
        type,
        data,
        agentRole: this.role,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn({ err }, "Failed to publish event");
    }
  }

  // ---------------------------------------------------------------------------
  // Main execution loop
  // ---------------------------------------------------------------------------

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex but well-structured logic
  async run(task: string): Promise<AgentExecutionResult> {
    if (!this.context) {
      throw new Error("Agent not initialized. Call initialize() first.");
    }

    const ctx = this.context;
    this.addUserMessage(task);

    await this.publishEvent("agent_output", {
      type: "task_started",
      task,
      role: this.role,
    });

    const { provider, model } = parseModelString(this.getModel());
    const client = createLLMClient({ provider: provider as ModelProvider });

    const toolCtx: ToolExecutionContext = {
      sessionId: ctx.sessionId,
      projectId: ctx.projectId,
      sandboxId: ctx.sandboxId ?? DEFAULT_SANDBOX_ID,
      workDir: ctx.workDir ?? DEFAULT_WORK_DIR,
      orgId: ctx.orgId,
      userId: ctx.userId,
    };

    let finalOutput = "";
    let askUserPending: AgentExecutionResult["askUserPending"] | undefined;

    try {
      while (this.stepCount < MAX_STEPS) {
        this.stepCount++;
        this.trimMessages();

        // Build the request
        const toolDefs = this.getToolDefinitions();
        const requestMessages = this.messages.map((m) =>
          this.toOpenAIMessage(m)
        );

        this.logger.debug(
          {
            step: this.stepCount,
            messageCount: requestMessages.length,
            toolCount: toolDefs.length,
          },
          "Calling LLM"
        );

        // Call the LLM
        const response = await client.chat.completions.create({
          model,
          // biome-ignore lint/suspicious/noExplicitAny: OpenAI SDK message types require flexible casting
          messages: requestMessages as any,
          tools:
            toolDefs.length > 0
              ? (toolDefs as Array<{
                  type: "function";
                  function: {
                    name: string;
                    description: string;
                    parameters: Record<string, unknown>;
                  };
                }>)
              : undefined,
          temperature: 0.2,
          max_tokens: 16_384,
        });

        const choice = response.choices[0];
        if (!choice) {
          this.logger.error("LLM returned no choices");
          break;
        }

        // Track token usage
        if (response.usage) {
          this.tokensUsed.input += response.usage.prompt_tokens || 0;
          this.tokensUsed.output += response.usage.completion_tokens || 0;
        }

        // Base credit cost per LLM call
        this.creditsConsumed += 1;

        const assistantMsg = choice.message;
        const content = assistantMsg.content ?? "";
        const toolCallsRaw = assistantMsg.tool_calls ?? [];

        // Stream content to client if there's text
        if (content) {
          await this.publishEvent("agent_output", {
            type: "text",
            content,
            step: this.stepCount,
          });
        }

        // Add reasoning if present (some models return this)
        const msgAny = assistantMsg as unknown as Record<string, unknown>;
        if (msgAny.reasoning) {
          await this.publishEvent("reasoning", {
            content: msgAny.reasoning,
            step: this.stepCount,
          });
        }

        // No tool calls = agent is done
        if (toolCallsRaw.length === 0) {
          this.addAssistantMessage(content);
          finalOutput = content;
          break;
        }

        // Parse tool calls (filter to function-type tool calls for OpenAI v6 union)
        const toolCalls: ToolCall[] = toolCallsRaw
          .filter((tc) => tc.type === "function")
          .map((tc) => {
            const fn = (
              tc as unknown as { function: { name: string; arguments: string } }
            ).function;
            return { id: tc.id, name: fn.name, arguments: fn.arguments };
          });

        this.addAssistantMessage(content, toolCalls);

        // Execute each tool call
        let allSucceeded = true;
        for (const tc of toolCalls) {
          this.toolCallCount++;

          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(tc.arguments);
          } catch {
            const errMsg = `Failed to parse arguments for tool '${tc.name}': invalid JSON`;
            this.addToolResult(tc.id, errMsg);
            await this.publishEvent("error", {
              message: errMsg,
              toolCall: tc.name,
            });
            allSucceeded = false;
            continue;
          }

          this.logger.info(
            { tool: tc.name, step: this.stepCount },
            "Executing tool"
          );

          await this.publishEvent("agent_output", {
            type: "tool_call",
            tool: tc.name,
            args: parsedArgs,
            step: this.stepCount,
          });

          const result = await this.toolRegistry.execute(
            tc.name,
            parsedArgs,
            toolCtx
          );

          // Track credit cost for the tool
          const toolDef = this.toolRegistry.resolve(tc.name);
          if (toolDef) {
            this.creditsConsumed += toolDef.creditCost;
          }

          // Track file changes
          if (
            parsedArgs.path &&
            (tc.name.includes("write") ||
              tc.name.includes("edit") ||
              tc.name.includes("delete"))
          ) {
            this.filesChanged.add(parsedArgs.path as string);
          }

          // Handle special meta-tool responses
          if (result.output === "__ASK_USER_PENDING__" && result.metadata) {
            askUserPending = {
              question: result.metadata.question as string,
              options: (result.metadata.options as string[]) ?? [],
              context: (result.metadata.context as string) ?? "",
            };

            await this.publishEvent("agent_output", {
              type: "ask_user",
              question: askUserPending.question,
              options: askUserPending.options,
              context: askUserPending.context,
            });

            this.addToolResult(tc.id, "Waiting for user response...");

            // Return with askUserPending so the caller can resume later
            return this.buildResult(
              true,
              "Paused: waiting for user response",
              askUserPending
            );
          }

          if (result.output === "__SPAWN_AGENT__" && result.metadata) {
            this.spawnRequests.push({
              role: result.metadata.role as string,
              task: result.metadata.task as string,
              dependencies: (result.metadata.dependencies as string[]) ?? [],
              priority: (result.metadata.priority as number) ?? 5,
            });
            this.addToolResult(
              tc.id,
              `Agent spawn queued: ${result.metadata.role} agent will handle "${result.metadata.task}"`
            );
            continue;
          }

          if (result.output === "__KILL_AGENT__" && result.metadata) {
            this.killRequests.push({
              agentId: result.metadata.agentId as string,
              reason: result.metadata.reason as string,
            });
            this.addToolResult(
              tc.id,
              `Agent kill queued: ${result.metadata.agentId} (${result.metadata.reason})`
            );
            continue;
          }

          // Publish tool result
          const truncatedOutput = truncateOutput(result.output);

          await this.publishEvent("agent_output", {
            type: "tool_result",
            tool: tc.name,
            success: result.success,
            output: truncatedOutput.slice(0, 2000), // Only send first 2K to UI
            step: this.stepCount,
          });

          if (result.success) {
            this.addToolResult(tc.id, truncatedOutput);
            this.consecutiveFailures = 0;
          } else {
            const errorOutput = `Error: ${result.error ?? "Unknown error"}\n${truncatedOutput}`;
            this.addToolResult(tc.id, errorOutput);
            allSucceeded = false;

            await this.publishEvent("error", {
              tool: tc.name,
              error: result.error,
              step: this.stepCount,
            });
          }
        }

        // Track consecutive failures for blocker detection
        if (!allSucceeded) {
          this.consecutiveFailures++;
        }

        // Escalate if stuck
        if (this.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
          this.logger.warn(
            { consecutiveFailures: this.consecutiveFailures },
            "Blocker detected, escalating"
          );
          await this.publishEvent("error", {
            type: "blocker_detected",
            consecutiveFailures: this.consecutiveFailures,
            message:
              "Agent is stuck: 3 consecutive tool call failures. Escalating.",
          });

          return this.buildResult(
            false,
            `Agent escalated: ${this.consecutiveFailures} consecutive tool failures. Last output: ${finalOutput || "(no output)"}`,
            undefined,
            true
          );
        }

        // Publish credit update periodically
        if (this.stepCount % 5 === 0) {
          await this.publishEvent("credit_update", {
            creditsConsumed: this.creditsConsumed,
            step: this.stepCount,
          });
        }
      }

      // Max steps reached
      if (this.stepCount >= MAX_STEPS) {
        this.logger.warn("Max steps reached");
        await this.publishEvent("error", {
          type: "max_steps_reached",
          steps: this.stepCount,
        });

        return this.buildResult(
          false,
          `Agent reached maximum step limit (${MAX_STEPS}). Last output: ${finalOutput || "(no output)"}`
        );
      }

      await this.publishEvent("agent_output", {
        type: "task_completed",
        role: this.role,
        steps: this.stepCount,
        creditsConsumed: this.creditsConsumed,
      });

      return this.buildResult(true, finalOutput);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, "Agent execution error");

      await this.publishEvent("error", {
        type: "execution_error",
        message,
        step: this.stepCount,
      });

      return this.buildResult(false, "", undefined, false, message);
    }
  }

  // ---------------------------------------------------------------------------
  // Result building
  // ---------------------------------------------------------------------------

  private buildResult(
    success: boolean,
    output: string,
    askUserPending?: AgentExecutionResult["askUserPending"],
    blockerEscalated = false,
    error?: string
  ): AgentExecutionResult {
    return {
      success,
      output,
      filesChanged: [...this.filesChanged],
      tokensUsed: { ...this.tokensUsed },
      toolCalls: this.toolCallCount,
      steps: this.stepCount,
      creditsConsumed: this.creditsConsumed,
      error,
      blockerEscalated: blockerEscalated || undefined,
      askUserPending,
      spawnRequests:
        this.spawnRequests.length > 0 ? this.spawnRequests : undefined,
      killRequests:
        this.killRequests.length > 0 ? this.killRequests : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // OpenAI message format conversion
  // ---------------------------------------------------------------------------

  private toOpenAIMessage(msg: AgentMessage): Record<string, unknown> {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content ?? "",
        tool_call_id: msg.toolCallId,
      };
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      };
    }

    return {
      role: msg.role,
      content: msg.content ?? "",
    };
  }
}
