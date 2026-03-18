import { z } from "zod";
import type { AgentToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const askUserSchema = z
  .object({
    question: z.string().describe("The question to ask the user"),
    options: z
      .array(z.string())
      .optional()
      .describe(
        "Optional list of predefined options for the user to choose from"
      ),
    context: z
      .string()
      .optional()
      .describe("Additional context to help the user understand the question"),
  })
  .strict();

export const spawnAgentSchema = z
  .object({
    role: z
      .enum([
        "discovery",
        "architect",
        "planner",
        "frontend_coder",
        "backend_coder",
        "integration_coder",
        "test_engineer",
        "ci_loop",
        "security_auditor",
        "deploy_engineer",
      ])
      .describe("Agent role to spawn"),
    task: z.string().describe("Task description for the spawned agent"),
    dependencies: z
      .array(z.string())
      .optional()
      .describe("Task IDs this task depends on"),
    priority: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Priority level (1=highest, 10=lowest, default: 5)"),
  })
  .strict();

export const killAgentSchema = z
  .object({
    agentId: z.string().describe("The agent instance ID to terminate"),
    reason: z.string().describe("Reason for termination"),
  })
  .strict();

export const readBlueprintSchema = z.object({}).strict();

export const readBrainSchema = z
  .object({
    query: z.string().describe("What you want to know about the codebase"),
    category: z
      .enum([
        "structure",
        "dependencies",
        "patterns",
        "conventions",
        "api",
        "models",
        "general",
      ])
      .optional()
      .describe("Category of information to retrieve"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

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
    description:
      "Ask the user a question and wait for their response. Use this when you need clarification, approval, or a decision from the user. The agent will pause until the user responds.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of predefined options for the user to choose from",
        },
        context: {
          type: "string",
          description:
            "Additional context to help the user understand the question",
        },
      },
      required: ["question"],
    },
    zodSchema: askUserSchema,
    permissionLevel: "read",
    creditCost: 0,
    execute: (input, ctx) => {
      const parsed = askUserSchema.parse(input);

      // This tool works by publishing an event to the session channel.
      // The orchestrator/queue-worker will detect this event type and pause the agent.
      // When the user responds via the web UI, the response is injected back.
      // The actual blocking is handled by the BaseAgent.run() loop.
      // Returning a special marker output that the run loop recognizes.
      return Promise.resolve({
        success: true,
        output: "__ASK_USER_PENDING__",
        metadata: {
          type: "ask_user",
          question: parsed.question,
          options: parsed.options ?? [],
          context: parsed.context ?? "",
          sessionId: ctx.sessionId,
        },
      });
    },
  },
  {
    name: "spawn_agent",
    description:
      "Spawn a specialist agent to handle a subtask. The spawned agent runs concurrently and reports results back. Only the Orchestrator should use this tool.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description:
            "Agent role to spawn (e.g., 'frontend_coder', 'backend_coder', 'test_engineer')",
          enum: [
            "discovery",
            "architect",
            "planner",
            "frontend_coder",
            "backend_coder",
            "integration_coder",
            "test_engineer",
            "ci_loop",
            "security_auditor",
            "deploy_engineer",
          ],
        },
        task: {
          type: "string",
          description: "Task description for the spawned agent",
        },
        dependencies: {
          type: "array",
          items: { type: "string" },
          description:
            "Task IDs this task depends on (agent won't start until dependencies complete)",
        },
        priority: {
          type: "number",
          description: "Priority level (1=highest, 10=lowest, default: 5)",
        },
      },
      required: ["role", "task"],
    },
    zodSchema: spawnAgentSchema,
    permissionLevel: "admin",
    creditCost: 0,
    execute: (input, ctx) => {
      const parsed = spawnAgentSchema.parse(input);

      // Signal to the orchestrator to spawn a new agent.
      // The run loop publishes this as a fleet event.
      return Promise.resolve({
        success: true,
        output: "__SPAWN_AGENT__",
        metadata: {
          type: "spawn_agent",
          role: parsed.role,
          task: parsed.task,
          dependencies: parsed.dependencies ?? [],
          priority: parsed.priority ?? 5,
          parentSessionId: ctx.sessionId,
          projectId: ctx.projectId,
        },
      });
    },
  },
  {
    name: "kill_agent",
    description:
      "Terminate a running agent by its instance ID. Use when an agent is stuck, producing incorrect output, or no longer needed.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "The agent instance ID to terminate",
        },
        reason: { type: "string", description: "Reason for termination" },
      },
      required: ["agentId", "reason"],
    },
    zodSchema: killAgentSchema,
    permissionLevel: "admin",
    creditCost: 0,
    execute: (input, ctx) => {
      const parsed = killAgentSchema.parse(input);

      return Promise.resolve({
        success: true,
        output: "__KILL_AGENT__",
        metadata: {
          type: "kill_agent",
          agentId: parsed.agentId,
          reason: parsed.reason,
          sessionId: ctx.sessionId,
        },
      });
    },
  },
  {
    name: "read_blueprint",
    description:
      "Read the project's Blueprint.md file which contains the immutable tech stack, architecture decisions, API contracts, DB schema, and coding conventions. All agents should consult this before making decisions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    zodSchema: readBlueprintSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (_input, ctx) => {
      const brainUrl = process.env.PROJECT_BRAIN_URL || "http://localhost:4006";
      try {
        const response = await fetch(
          `${brainUrl}/api/blueprint/${ctx.projectId}`,
          {
            signal: AbortSignal.timeout(5000),
          }
        );

        if (!response.ok) {
          // Fallback: try reading from disk
          const { execInSandbox } = await import("./sandbox");
          return execInSandbox(
            'cat Blueprint.md 2>/dev/null || cat blueprint.md 2>/dev/null || echo "No Blueprint.md found"',
            ctx
          );
        }

        const data = (await response.json()) as { content: string };
        return {
          success: true,
          output: data.content,
          metadata: { source: "project-brain" },
        };
      } catch {
        const { execInSandbox } = await import("./sandbox");
        return execInSandbox(
          'cat Blueprint.md 2>/dev/null || cat blueprint.md 2>/dev/null || echo "No Blueprint.md found"',
          ctx
        );
      }
    },
  },
  {
    name: "read_brain",
    description:
      "Query the Project Brain for structured codebase context. Returns information about the project's file structure, dependencies, patterns, and conventions that the Brain has indexed.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What you want to know about the codebase (e.g., 'project structure', 'database models', 'API routes')",
        },
        category: {
          type: "string",
          description: "Category of information to retrieve",
          enum: [
            "structure",
            "dependencies",
            "patterns",
            "conventions",
            "api",
            "models",
            "general",
          ],
        },
      },
      required: ["query"],
    },
    zodSchema: readBrainSchema,
    permissionLevel: "read",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = readBrainSchema.parse(input);
      const category = parsed.category || "general";
      const brainUrl = process.env.PROJECT_BRAIN_URL || "http://localhost:4006";

      try {
        const response = await fetch(
          `${brainUrl}/api/context/${ctx.projectId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: parsed.query, category }),
            signal: AbortSignal.timeout(10_000),
          }
        );

        if (!response.ok) {
          return {
            success: false,
            output: "",
            error: `Project Brain returned ${response.status}. The brain may not have indexed this project yet.`,
          };
        }

        const data = (await response.json()) as {
          context: string;
          sources: string[];
        };
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
