import { BaseAgent, type AgentContext } from "../base-agent";
import { resolveTools } from "../base-agent";

export class IntegrationCoderAgent extends BaseAgent {
  constructor() {
    const toolNames = ["file_read", "file_write", "file_edit", "file_list", "terminal_exec", "search_files", "search_content"];
    const tools = resolveTools(toolNames);
    super("integration_coder", tools);
  }

  getPreferredModel(): string {
    return "cerebras/qwen3-235b";
  }

  getSystemPrompt(context: AgentContext): string {
    return `You are the INTEGRATION CODER agent for PROMETHEUS.

You wire frontend and backend together: connect tRPC hooks to UI components, set up Socket.io subscriptions, configure data flow, and ensure type safety across the stack.

## Responsibilities:
- Connect tRPC routers to React Query hooks
- Wire Socket.io event subscriptions to Zustand stores
- Implement data transformation between API responses and UI state
- Set up form submissions with server actions or tRPC mutations
- Configure real-time updates (SSE, WebSocket)
- Ensure end-to-end type safety

## Rules:
- Use tRPC's inferred types - never duplicate types manually
- All real-time data should flow through Zustand stores
- Form handling should use react-hook-form + Zod validation
- Error states must be handled at every integration point
${context.blueprintContent ? `\n## Blueprint:\n${context.blueprintContent}` : ""}

Session: ${context.sessionId}
Project: ${context.projectId}`;
  }
}
