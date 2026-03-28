import { playbookRuns, playbooks, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("playbook-engine-router");

const parameterDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["string", "number", "boolean", "select"]),
  description: z.string().max(500).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

export const playbookEngineRouter = router({
  // ---------------------------------------------------------------------------
  // Execute a playbook with parameters
  // ---------------------------------------------------------------------------
  execute: protectedProcedure
    .input(
      z.object({
        playbookId: z.string(),
        parameters: z.record(z.string(), z.string()),
        projectId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify playbook access
      const playbook = await ctx.db.query.playbooks.findFirst({
        where: eq(playbooks.id, input.playbookId),
      });

      if (!playbook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      if (
        playbook.orgId !== ctx.orgId &&
        !playbook.isBuiltin &&
        !playbook.isPublic
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      // Verify project access
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
        columns: { id: true, name: true },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      // Populate the template with parameters
      let populatedTemplate = playbook.description ?? "";
      for (const [key, value] of Object.entries(input.parameters)) {
        populatedTemplate = populatedTemplate.replace(
          new RegExp(`\\{\\{${key}\\}\\}`, "g"),
          value
        );
      }

      const runId = generateId("pbr");

      const [run] = await ctx.db
        .insert(playbookRuns)
        .values({
          id: runId,
          playbookId: input.playbookId,
          projectId: input.projectId,
          orgId: ctx.orgId,
          parameters: input.parameters,
          status: "running",
        })
        .returning();

      // Increment usage count
      await ctx.db
        .update(playbooks)
        .set({ usageCount: sql`${playbooks.usageCount} + 1` })
        .where(eq(playbooks.id, input.playbookId));

      logger.info(
        {
          runId,
          playbookId: input.playbookId,
          projectId: input.projectId,
          orgId: ctx.orgId,
        },
        "Playbook execution started"
      );

      return {
        run,
        populatedTemplate,
        playbook: {
          id: playbook.id,
          name: playbook.name,
          steps: playbook.steps,
        },
      };
    }),

  // ---------------------------------------------------------------------------
  // Get execution history for a playbook
  // ---------------------------------------------------------------------------
  getRunHistory: protectedProcedure
    .input(
      z.object({
        playbookId: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const runs = await ctx.db.query.playbookRuns.findMany({
        where: and(
          eq(playbookRuns.playbookId, input.playbookId),
          eq(playbookRuns.orgId, ctx.orgId)
        ),
        orderBy: [desc(playbookRuns.createdAt)],
        limit: input.limit,
        with: {
          playbook: { columns: { id: true, name: true, category: true } },
        },
      });

      return { runs };
    }),

  // ---------------------------------------------------------------------------
  // Create a custom playbook
  // ---------------------------------------------------------------------------
  createCustom: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        category: z.enum([
          "code_quality",
          "feature",
          "devops",
          "testing",
          "security",
          "refactoring",
          "custom",
        ]),
        template: z.string().min(1).max(10_000),
        parameters: z.array(parameterDefinitionSchema).max(20),
        tags: z.array(z.string().max(50)).max(10).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = generateId("pb");

      // Build steps from the template (single-step for custom playbooks)
      const steps = [
        {
          order: 1,
          title: "Execute template",
          description: input.template,
          expectedOutput: "Template execution completed",
        },
      ];

      const [playbook] = await ctx.db
        .insert(playbooks)
        .values({
          id,
          orgId: ctx.orgId,
          name: input.name,
          description: input.description ?? null,
          category: input.category,
          steps,
          parameters: input.parameters,
          isBuiltin: false,
          isPublic: false,
          tags: input.tags ?? [],
        })
        .returning();

      logger.info(
        { playbookId: id, orgId: ctx.orgId },
        "Custom playbook created"
      );

      return { playbook };
    }),

  // ---------------------------------------------------------------------------
  // Duplicate an existing playbook for customization
  // ---------------------------------------------------------------------------
  duplicate: protectedProcedure
    .input(z.object({ playbookId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const original = await ctx.db.query.playbooks.findFirst({
        where: eq(playbooks.id, input.playbookId),
      });

      if (!original) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      if (
        original.orgId !== ctx.orgId &&
        !original.isBuiltin &&
        !original.isPublic
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      const id = generateId("pb");

      const [duplicated] = await ctx.db
        .insert(playbooks)
        .values({
          id,
          orgId: ctx.orgId,
          name: `${original.name} (Copy)`,
          description: original.description,
          category: original.category,
          steps: original.steps,
          parameters: original.parameters,
          isBuiltin: false,
          isPublic: false,
          tags: original.tags,
        })
        .returning();

      logger.info(
        { playbookId: id, originalId: input.playbookId, orgId: ctx.orgId },
        "Playbook duplicated"
      );

      return { playbook: duplicated };
    }),
});
