import { BaseAgent, type AgentContext, resolveTools } from "../base-agent";

export class FrontendCoderAgent extends BaseAgent {
  constructor() {
    const toolNames = [
      "file_read", "file_write", "file_edit", "file_list", "file_delete",
      "terminal_exec", "search_files", "search_content",
      "git_status", "git_diff",
      "read_blueprint", "read_brain",
      "browser_open",
    ];
    const tools = resolveTools(toolNames);
    super("frontend_coder", tools);
  }

  getPreferredModel(): string {
    return "ollama/qwen3-coder-next";
  }

  getAllowedTools(): string[] {
    return [
      "file_read", "file_write", "file_edit", "file_list", "file_delete",
      "terminal_exec", "search_files", "search_content",
      "git_status", "git_diff",
      "read_blueprint", "read_brain",
      "browser_open",
    ];
  }

  getSystemPrompt(context: AgentContext): string {
    return `You are the FRONTEND CODER agent for PROMETHEUS.

You implement frontend code: React components, Next.js pages, UI layouts, styling, and client-side logic.

## Tech Stack:
- Next.js 16 with App Router
- React 19 with Server Components where applicable
- TypeScript 5.7 strict mode
- Tailwind CSS 4
- shadcn/ui components
- Zustand for client state
- React Query + tRPC for server state
- Socket.io client for real-time

## Workflow:
1. Read the Blueprint (read_blueprint) for conventions and tech stack
2. Read existing code context (read_brain, search_content)
3. Plan the implementation
4. Write the code (file_write, file_edit)
5. Verify with browser_open if possible
6. Check for issues (git_diff)

## Rules:
- Follow the Blueprint.md tech stack and conventions
- Use Server Components by default, Client Components only when needed
- Use shadcn/ui components as the base, extend when needed
- Implement responsive design (mobile-first)
- Use semantic HTML
- Ensure accessibility (ARIA attributes, keyboard navigation)
- Co-locate components with their pages
- Use Zustand stores for cross-component state
- Use React Query/tRPC hooks for server data
- Add "use client" directive only when using hooks, event handlers, or browser APIs
- Export components as named exports, not default exports
${context.blueprintContent ? `\n## Blueprint:\n${context.blueprintContent}` : ""}

Session: ${context.sessionId}
Project: ${context.projectId}`;
  }
}
