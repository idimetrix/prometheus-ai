import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("custom-agents-router");

/* -------------------------------------------------------------------------- */
/*  In-memory store (replace with DB table in production)                      */
/* -------------------------------------------------------------------------- */

interface CustomAgentRecord {
  createdAt: Date;
  createdBy: string;
  description: string;
  id: string;
  isShared: boolean;
  modelPreference: string;
  name: string;
  orgId: string;
  systemPrompt: string;
  tools: string[];
  updatedAt: Date;
}

const agentStore = new Map<string, CustomAgentRecord>();

/* -------------------------------------------------------------------------- */
/*  Available tools for selection                                              */
/* -------------------------------------------------------------------------- */

const AVAILABLE_TOOLS = [
  "file_read",
  "file_write",
  "file_search",
  "terminal_exec",
  "browser_navigate",
  "browser_screenshot",
  "code_search",
  "code_analysis",
  "git_commit",
  "git_push",
  "test_run",
  "deploy",
  "database_query",
  "api_request",
] as const;

const AVAILABLE_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-2.0-flash",
  "deepseek-v3",
] as const;

/* -------------------------------------------------------------------------- */
/*  Router                                                                     */
/* -------------------------------------------------------------------------- */

export const customAgentsRouter = router({
  /**
   * Create a custom agent.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).default(""),
        systemPrompt: z.string().min(1).max(10_000),
        tools: z.array(z.string()).default([]),
        modelPreference: z.string().default("claude-sonnet-4-20250514"),
        isShared: z.boolean().default(false),
      })
    )
    .mutation(({ input, ctx }) => {
      const id = generateId();
      const now = new Date();

      const agent: CustomAgentRecord = {
        id,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        tools: input.tools,
        modelPreference: input.modelPreference,
        orgId: ctx.orgId,
        createdBy: ctx.auth.userId,
        isShared: input.isShared,
        createdAt: now,
        updatedAt: now,
      };

      agentStore.set(id, agent);

      logger.info(
        { id, name: input.name, orgId: ctx.orgId },
        "Custom agent created"
      );

      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        tools: agent.tools,
        modelPreference: agent.modelPreference,
        isShared: agent.isShared,
        createdAt: agent.createdAt.toISOString(),
      };
    }),

  /**
   * List custom agents for the org.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
        .default({ limit: 50, offset: 0 })
    )
    .query(({ input, ctx }) => {
      const agents: CustomAgentRecord[] = [];

      for (const agent of agentStore.values()) {
        if (agent.orgId === ctx.orgId) {
          agents.push(agent);
        }
      }

      agents.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      const items = agents
        .slice(input.offset, input.offset + input.limit)
        .map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          tools: a.tools,
          modelPreference: a.modelPreference,
          isShared: a.isShared,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        }));

      return { items, total: agents.length };
    }),

  /**
   * Get a custom agent by ID.
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input, ctx }) => {
      const agent = agentStore.get(input.id);

      if (!agent || agent.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom agent not found",
        });
      }

      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
        modelPreference: agent.modelPreference,
        isShared: agent.isShared,
        createdBy: agent.createdBy,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
      };
    }),

  /**
   * Update a custom agent.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        systemPrompt: z.string().min(1).max(10_000).optional(),
        tools: z.array(z.string()).optional(),
        modelPreference: z.string().optional(),
        isShared: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const agent = agentStore.get(input.id);

      if (!agent || agent.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom agent not found",
        });
      }

      if (input.name !== undefined) {
        agent.name = input.name;
      }
      if (input.description !== undefined) {
        agent.description = input.description;
      }
      if (input.systemPrompt !== undefined) {
        agent.systemPrompt = input.systemPrompt;
      }
      if (input.tools !== undefined) {
        agent.tools = input.tools;
      }
      if (input.modelPreference !== undefined) {
        agent.modelPreference = input.modelPreference;
      }
      if (input.isShared !== undefined) {
        agent.isShared = input.isShared;
      }
      agent.updatedAt = new Date();

      agentStore.set(input.id, agent);

      logger.info({ id: input.id, orgId: ctx.orgId }, "Custom agent updated");

      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        tools: agent.tools,
        modelPreference: agent.modelPreference,
        isShared: agent.isShared,
        updatedAt: agent.updatedAt.toISOString(),
      };
    }),

  /**
   * Delete a custom agent.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const agent = agentStore.get(input.id);

      if (!agent || agent.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom agent not found",
        });
      }

      agentStore.delete(input.id);

      logger.info({ id: input.id, orgId: ctx.orgId }, "Custom agent deleted");

      return { success: true };
    }),

  /**
   * Test a custom agent with a message.
   * Returns a simulated response for validation purposes.
   */
  test: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        message: z.string().min(1).max(5000),
      })
    )
    .mutation(({ input, ctx }) => {
      const agent = agentStore.get(input.id);

      if (!agent || agent.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom agent not found",
        });
      }

      logger.info(
        { agentId: input.id, messageLength: input.message.length },
        "Custom agent test invoked"
      );

      // In production, this would forward to the model router
      // with the agent's system prompt and tools
      return {
        agentId: agent.id,
        agentName: agent.name,
        model: agent.modelPreference,
        tools: agent.tools,
        response: `[Test mode] Agent "${agent.name}" received: "${input.message.slice(0, 100)}..."`,
        systemPromptLength: agent.systemPrompt.length,
        timestamp: new Date().toISOString(),
      };
    }),

  /**
   * List available tools and models for the agent builder UI.
   */
  availableOptions: protectedProcedure.query(() => ({
    tools: AVAILABLE_TOOLS.map((t) => ({ id: t, name: t.replace(/_/g, " ") })),
    models: AVAILABLE_MODELS.map((m) => ({ id: m, name: m })),
  })),
});
