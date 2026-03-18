import type { AgentToolDefinition, ToolResult } from "./types";

/**
 * Meta-tools that agents use to interact with the PROMETHEUS platform itself:
 * - ask_user: Request human input (blocks the agent until user responds)
 * - spawn_agent: Create a child agent to handle a subtask
 * - kill_agent: Terminate a running agent
 * - read_blueprint: Read the project's Blueprint.md
 * - read_brain: Query the Project Brain for codebase context
 */
export const agentMetaTools: AgentToolDefinition[] = [
  {
    name: "ask_user",
    description: "Ask the user a question and wait for their response. Use this when you need clarification, approval, or a decision from the user. The agent will pause until the user responds.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of predefined options for the user to choose from",
        },
        context: { type: "string", description: "Additional context to help the user understand the question" },
      },
      required: ["question"],
    },
    permissionLevel: "read",
    creditCost: 0,
    execute: async (input, ctx) => {
      // This tool works by publishing an event to the session channel.
      // The orchestrator/queue-worker will detect this event type and pause the agent.
      // When the user responds via the web UI, the response is injected back.
      const question = input.question as string;
      const options = input.options as string[] | undefined;
      const context = input.context as string | undefined;

      // The actual blocking is handled by the BaseAgent.run() loop.
      // Returning a special marker output that the run loop recognizes.
      return {
        success: true,
        output: "__ASK_USER_PENDING__",
        metadata: {
          type: "ask_user",
          question,
          options: options ?? [],
          context: context ?? "",
          sessionId: ctx.sessionId,
        },
      };
    },
  },
  {
    name: "spawn_agent",
    description: "Spawn a specialist agent to handle a subtask. The spawned agent runs concurrently and reports results back. Only the Orchestrator should use this tool.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description: "Agent role to spawn (e.g., 'frontend_coder', 'backend_coder', 'test_engineer')",
          enum: [
            "discovery", "architect", "planner",
            "frontend_coder", "backend_coder", "integration_coder",
            "test_engineer", "ci_loop", "security_auditor", "deploy_engineer",
          ],
        },
        task: { type: "string", description: "Task description for the spawned agent" },
        dependencies: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs this task depends on (agent won't start until dependencies complete)",
        },
        priority: {
          type: "number",
          description: "Priority level (1=highest, 10=lowest, default: 5)",
        },
      },
      required: ["role", "task"],
    },
    permissionLevel: "admin",
    creditCost: 0,
    execute: async (input, ctx) => {
      const role = input.role as string;
      const task = input.task as string;
      const dependencies = (input.dependencies as string[]) ?? [];
      const priority = (input.priority as number) ?? 5;

      // Signal to the orchestrator to spawn a new agent.
      // The run loop publishes this as a fleet event.
      return {
        success: true,
        output: "__SPAWN_AGENT__",
        metadata: {
          type: "spawn_agent",
          role,
          task,
          dependencies,
          priority,
          parentSessionId: ctx.sessionId,
          projectId: ctx.projectId,
        },
      };
    },
  },
  {
    name: "kill_agent",
    description: "Terminate a running agent by its instance ID. Use when an agent is stuck, producing incorrect output, or no longer needed.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "The agent instance ID to terminate" },
        reason: { type: "string", description: "Reason for termination" },
      },
      required: ["agentId", "reason"],
    },
    permissionLevel: "admin",
    creditCost: 0,
    execute: async (input, ctx) => {
      const agentId = input.agentId as string;
      const reason = input.reason as string;

      return {
        success: true,
        output: "__KILL_AGENT__",
        metadata: {
          type: "kill_agent",
          agentId,
          reason,
          sessionId: ctx.sessionId,
        },
      };
    },
  },
  {
    name: "read_blueprint",
    description: "Read the project's Blueprint.md file which contains the immutable tech stack, architecture decisions, API contracts, DB schema, and coding conventions. All agents should consult this before making decisions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    permissionLevel: "read",
    creditCost: 1,
    execute: async (_input, ctx) => {
      const brainUrl = process.env.PROJECT_BRAIN_URL || "http://localhost:4006";
      try {
        const response = await fetch(`${brainUrl}/api/blueprint/${ctx.projectId}`, {
          signal: AbortSignal.timeout(5_000),
        });

        if (!response.ok) {
          // Fallback: try reading from disk
          const { execInSandbox } = await import("./sandbox");
          return execInSandbox('cat Blueprint.md 2>/dev/null || cat blueprint.md 2>/dev/null || echo "No Blueprint.md found"', ctx);
        }

        const data = (await response.json()) as { content: string };
        return {
          success: true,
          output: data.content,
          metadata: { source: "project-brain" },
        };
      } catch {
        const { execInSandbox } = await import("./sandbox");
        return execInSandbox('cat Blueprint.md 2>/dev/null || cat blueprint.md 2>/dev/null || echo "No Blueprint.md found"', ctx);
      }
    },
  },
  {
    name: "read_brain",
    description: "Query the Project Brain for structured codebase context. Returns information about the project's file structure, dependencies, patterns, and conventions that the Brain has indexed.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you want to know about the codebase (e.g., 'project structure', 'database models', 'API routes')" },
        category: {
          type: "string",
          description: "Category of information to retrieve",
          enum: ["structure", "dependencies", "patterns", "conventions", "api", "models", "general"],
        },
      },
      required: ["query"],
    },
    permissionLevel: "read",
    creditCost: 2,
    execute: async (input, ctx) => {
      const query = input.query as string;
      const category = (input.category as string) || "general";
      const brainUrl = process.env.PROJECT_BRAIN_URL || "http://localhost:4006";

      try {
        const response = await fetch(`${brainUrl}/api/context/${ctx.projectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, category }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          return {
            success: false,
            output: "",
            error: `Project Brain returned ${response.status}. The brain may not have indexed this project yet.`,
          };
        }

        const data = (await response.json()) as { context: string; sources: string[] };
        return {
          success: true,
          output: data.context,
          metadata: { sources: data.sources, category },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: "",
          error: `Failed to reach Project Brain: ${message}. Make sure the project-brain service is running.`,
        };
      }
    },
  },
];
