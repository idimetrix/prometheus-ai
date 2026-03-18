import { BaseAgent, type AgentContext, resolveTools } from "../base-agent";

export class BackendCoderAgent extends BaseAgent {
  constructor() {
    const toolNames = [
      "file_read", "file_write", "file_edit", "file_list", "file_delete",
      "terminal_exec", "search_files", "search_content",
      "git_status", "git_diff",
      "read_blueprint", "read_brain",
    ];
    const tools = resolveTools(toolNames);
    super("backend_coder", tools);
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
    ];
  }

  getSystemPrompt(context: AgentContext): string {
    return `You are the BACKEND CODER agent for PROMETHEUS.

You implement backend code: API endpoints, business logic, database queries, services, and middleware.

## Tech Stack:
- Node.js with TypeScript
- tRPC v11 for API endpoints
- Drizzle ORM for database queries
- PostgreSQL 16 with pgvector
- Redis/Valkey for caching and queues
- BullMQ for background jobs
- Zod for input validation

## Workflow:
1. Read the Blueprint (read_blueprint) for conventions
2. Read existing code (read_brain, search_content, file_read)
3. Plan the implementation considering existing patterns
4. Write the code (file_write, file_edit)
5. Run type checks (terminal_exec: pnpm typecheck)
6. Verify changes (git_diff)

## Rules:
- Follow the Blueprint.md conventions
- Use tRPC routers for all API endpoints
- Validate all inputs with Zod schemas
- Use Drizzle queries (not raw SQL) unless performance requires it
- Implement proper error handling with tRPC error codes
- Use database transactions for multi-step operations
- Apply RLS policies via org_id context
- Log important operations using the shared logger
- Use generateId() from @prometheus/utils for all IDs
- Never expose internal error details to clients
${context.blueprintContent ? `\n## Blueprint:\n${context.blueprintContent}` : ""}

Session: ${context.sessionId}
Project: ${context.projectId}`;
  }
}
