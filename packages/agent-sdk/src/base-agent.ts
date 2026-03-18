import type { AgentRole } from "@prometheus/types";
import type { ModelConfig } from "@prometheus/ai";
import { createLogger, type Logger } from "@prometheus/logger";
import type { AgentToolDefinition, ToolResult } from "./tools/types";
import { TOOL_REGISTRY } from "./tools/registry";

export function resolveTools(names: string[]): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = [];
  for (const name of names) {
    const tool = TOOL_REGISTRY[name];
    if (tool) tools.push(tool);
  }
  return tools;
}

export interface AgentContext {
  sessionId: string;
  projectId: string;
  orgId: string;
  userId: string;
  blueprintContent: string | null;
  projectContext: string | null;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AgentExecutionResult {
  success: boolean;
  output: string;
  filesChanged: string[];
  tokensUsed: { input: number; output: number };
  toolCalls: number;
  error?: string;
}

export abstract class BaseAgent {
  protected readonly role: AgentRole;
  protected readonly logger: Logger;
  protected readonly tools: AgentToolDefinition[];
  protected messages: AgentMessage[] = [];
  protected context: AgentContext | null = null;

  constructor(role: AgentRole, tools: AgentToolDefinition[] = []) {
    this.role = role;
    this.logger = createLogger(`agent:${role}`);
    this.tools = tools;
  }

  abstract getSystemPrompt(context: AgentContext): string;
  abstract getPreferredModel(): string;

  initialize(context: AgentContext): void {
    this.context = context;
    this.messages = [
      { role: "system", content: this.getSystemPrompt(context) },
    ];
    this.logger.info({ sessionId: context.sessionId }, "Agent initialized");
  }

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
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return this.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
}
