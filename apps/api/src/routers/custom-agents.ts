import { customAgents, customAgentVersions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("custom-agents-router");

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
    .mutation(async ({ input, ctx }) => {
      const id = generateId("cag");

      const rows = await ctx.db
        .insert(customAgents)
        .values({
          id,
          orgId: ctx.orgId,
          name: input.name,
          description: input.description,
          systemPrompt: input.systemPrompt,
          tools: input.tools,
          modelPreference: input.modelPreference,
          isShared: input.isShared,
          version: 1,
          createdBy: ctx.auth.userId,
        })
        .returning();

      const agent = rows[0];
      if (!agent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create agent",
        });
      }

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
        version: agent.version,
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
    .query(async ({ input, ctx }) => {
      const agents = await ctx.db.query.customAgents.findMany({
        where: eq(customAgents.orgId, ctx.orgId),
        orderBy: [desc(customAgents.updatedAt)],
        limit: input.limit,
        offset: input.offset,
      });

      const totalResult = await ctx.db
        .select({ count: customAgents.id })
        .from(customAgents)
        .where(eq(customAgents.orgId, ctx.orgId));

      const total = totalResult.length;

      const items = agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        tools: a.tools,
        modelPreference: a.modelPreference,
        isShared: a.isShared,
        version: a.version,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }));

      return { items, total };
    }),

  /**
   * Get a custom agent by ID.
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const agent = await ctx.db.query.customAgents.findFirst({
        where: and(
          eq(customAgents.id, input.id),
          eq(customAgents.orgId, ctx.orgId)
        ),
      });

      if (!agent) {
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
        version: agent.version,
        createdBy: agent.createdBy,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
      };
    }),

  /**
   * Update a custom agent.
   * Saves the current state to customAgentVersions before applying changes.
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
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.customAgents.findFirst({
        where: and(
          eq(customAgents.id, input.id),
          eq(customAgents.orgId, ctx.orgId)
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom agent not found",
        });
      }

      // Save the current state as a version snapshot before applying changes
      await ctx.db.insert(customAgentVersions).values({
        id: generateId("cav"),
        agentId: existing.id,
        version: existing.version ?? 1,
        name: existing.name,
        description: existing.description,
        systemPrompt: existing.systemPrompt,
        tools: existing.tools,
        modelPreference: existing.modelPreference,
        createdBy: ctx.auth.userId,
      });

      // Build the update payload with only provided fields
      const updates: Record<string, unknown> = {
        version: (existing.version ?? 1) + 1,
        updatedAt: new Date(),
      };

      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (input.description !== undefined) {
        updates.description = input.description;
      }
      if (input.systemPrompt !== undefined) {
        updates.systemPrompt = input.systemPrompt;
      }
      if (input.tools !== undefined) {
        updates.tools = input.tools;
      }
      if (input.modelPreference !== undefined) {
        updates.modelPreference = input.modelPreference;
      }
      if (input.isShared !== undefined) {
        updates.isShared = input.isShared;
      }

      const updatedRows = await ctx.db
        .update(customAgents)
        .set(updates)
        .where(eq(customAgents.id, input.id))
        .returning();

      const agent = updatedRows[0];
      if (!agent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update agent",
        });
      }

      logger.info(
        { id: input.id, orgId: ctx.orgId, version: agent.version },
        "Custom agent updated"
      );

      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        tools: agent.tools,
        modelPreference: agent.modelPreference,
        isShared: agent.isShared,
        version: agent.version,
        updatedAt: agent.updatedAt.toISOString(),
      };
    }),

  /**
   * Delete a custom agent and all its versions.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const agent = await ctx.db.query.customAgents.findFirst({
        where: and(
          eq(customAgents.id, input.id),
          eq(customAgents.orgId, ctx.orgId)
        ),
      });

      if (!agent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom agent not found",
        });
      }

      // Versions are cascade-deleted via FK constraint
      await ctx.db.delete(customAgents).where(eq(customAgents.id, input.id));

      logger.info({ id: input.id, orgId: ctx.orgId }, "Custom agent deleted");

      return { success: true };
    }),

  /**
   * Rollback a custom agent to a previous version.
   */
  rollback: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        versionId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const agent = await ctx.db.query.customAgents.findFirst({
        where: and(
          eq(customAgents.id, input.id),
          eq(customAgents.orgId, ctx.orgId)
        ),
      });

      if (!agent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom agent not found",
        });
      }

      const targetVersion = await ctx.db.query.customAgentVersions.findFirst({
        where: and(
          eq(customAgentVersions.id, input.versionId),
          eq(customAgentVersions.agentId, input.id)
        ),
      });

      if (!targetVersion) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found",
        });
      }

      // Save the current state before rollback
      const currentVersion = agent.version ?? 1;
      await ctx.db.insert(customAgentVersions).values({
        id: generateId("cav"),
        agentId: agent.id,
        version: currentVersion,
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
        modelPreference: agent.modelPreference,
        createdBy: ctx.auth.userId,
      });

      // Restore from the target version
      const restoredRows = await ctx.db
        .update(customAgents)
        .set({
          name: targetVersion.name,
          description: targetVersion.description,
          systemPrompt: targetVersion.systemPrompt,
          tools: targetVersion.tools,
          modelPreference: targetVersion.modelPreference,
          version: currentVersion + 1,
          updatedAt: new Date(),
        })
        .where(eq(customAgents.id, input.id))
        .returning();

      const restoredAgent = restoredRows[0];
      if (!restoredAgent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to restore agent version",
        });
      }

      logger.info(
        {
          id: input.id,
          orgId: ctx.orgId,
          restoredFromVersion: targetVersion.version,
          newVersion: restoredAgent.version,
        },
        "Custom agent rolled back"
      );

      return {
        id: restoredAgent.id,
        name: restoredAgent.name,
        description: restoredAgent.description,
        tools: restoredAgent.tools,
        modelPreference: restoredAgent.modelPreference,
        isShared: restoredAgent.isShared,
        version: restoredAgent.version,
        updatedAt: restoredAgent.updatedAt.toISOString(),
        rolledBackFromVersion: targetVersion.version,
      };
    }),

  /**
   * List versions of a custom agent.
   */
  listVersions: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify access to the agent
      const agent = await ctx.db.query.customAgents.findFirst({
        where: and(
          eq(customAgents.id, input.id),
          eq(customAgents.orgId, ctx.orgId)
        ),
        columns: { id: true },
      });

      if (!agent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom agent not found",
        });
      }

      const versions = await ctx.db.query.customAgentVersions.findMany({
        where: eq(customAgentVersions.agentId, input.id),
        orderBy: [desc(customAgentVersions.version)],
        limit: input.limit,
        offset: input.offset,
      });

      return versions.map((v) => ({
        id: v.id,
        version: v.version,
        name: v.name,
        description: v.description,
        tools: v.tools,
        modelPreference: v.modelPreference,
        createdBy: v.createdBy,
        createdAt: v.createdAt.toISOString(),
      }));
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
    .mutation(async ({ input, ctx }) => {
      const agent = await ctx.db.query.customAgents.findFirst({
        where: and(
          eq(customAgents.id, input.id),
          eq(customAgents.orgId, ctx.orgId)
        ),
      });

      if (!agent) {
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
