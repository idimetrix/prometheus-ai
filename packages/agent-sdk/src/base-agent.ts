import { createLogger, type Logger } from "@prometheus/logger";
import type { AgentRole } from "@prometheus/types";
import { TOOL_REGISTRY, ToolRegistry } from "./tools/registry";
import type { AgentToolDefinition } from "./tools/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentContext {
  agentRole: AgentRole;
  blueprintContent: string | null;
  mcpTools?: Record<string, unknown>;
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

/**
 * Structured reasoning protocol injected into every agent's system prompt.
 * Forces agents to think before acting — OBSERVE, ANALYZE, PLAN, then ACT.
 */
const DEFAULT_REASONING_PROTOCOL = `## STRUCTURED REASONING PROTOCOL

Before taking ANY action (tool call or response), you MUST follow this reasoning framework:

### 1. OBSERVE
- What is the current state? What files exist, what has changed?
- What does the user/task actually ask for?
- What context do I have from the blueprint, memory, and previous steps?

### 2. ANALYZE
- What are the requirements and constraints?
- What patterns exist in the codebase that I should follow?
- What could go wrong? What are the edge cases?
- Are there any conflicts with existing code?

### 3. PLAN
- What specific steps will I take?
- What files will I read before modifying?
- What is my verification strategy?
- What is the minimal change needed?

### 4. RISK ASSESSMENT
- Could this break existing functionality?
- Am I following project conventions?
- Have I considered security implications?
- Should I ask for clarification before proceeding?

Include your reasoning in your response before making tool calls. Be explicit about your analysis.`;

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
  protected _mcpTools: Record<string, unknown> = {};

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
   * Return role-specific reasoning directives that are prepended to every system prompt.
   * Subclasses can override to add domain-specific reasoning steps.
   */
  getReasoningProtocol(): string {
    return DEFAULT_REASONING_PROTOCOL;
  }

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

    // If additional tools are specified in context, merge them
    if (context.tools && context.tools.length > 0) {
      const additional = resolveTools(context.tools);
      for (const tool of additional) {
        if (!this.toolRegistry.resolve(tool.name)) {
          this.toolRegistry.register(tool);
        }
      }
    }

    // Store MCP tools for AI SDK 6 integration
    if (context.mcpTools) {
      this._mcpTools = context.mcpTools;
      this.logger.info(
        { mcpToolCount: Object.keys(context.mcpTools).length },
        "MCP tools loaded into agent context"
      );
    }

    // Build initial message history with reasoning protocol prepended
    const systemPrompt = `${this.getReasoningProtocol()}\n\n${this.getSystemPrompt(context)}`;
    this.messages = [{ role: "system", content: systemPrompt }];

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
  // Accessors
  // ---------------------------------------------------------------------------

  getRole(): AgentRole {
    return this.role;
  }

  getContext(): AgentContext | null {
    return this.context;
  }

  /**
   * Get MCP tools loaded via AI SDK 6 MCPClient.
   * These can be merged into the AI SDK tool set for generateText/streamText.
   */
  getMcpTools(): Record<string, unknown> {
    return this._mcpTools;
  }
}
