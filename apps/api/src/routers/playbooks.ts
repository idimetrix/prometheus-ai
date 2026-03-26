import { playbookRuns, playbooks, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import {
  createPlaybookSchema,
  deletePlaybookSchema,
  getPlaybookSchema,
  listPlaybookRunsSchema,
  listPlaybooksSchema,
  runPlaybookSchema,
  updatePlaybookSchema,
} from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("playbooks-router");

export const playbooksRouter = router({
  // ─── List Playbooks ──────────────────────────────────────────────────
  list: protectedProcedure
    .input(listPlaybooksSchema)
    .query(async ({ input, ctx }) => {
      const conditions = [
        or(
          eq(playbooks.orgId, ctx.orgId),
          eq(playbooks.isBuiltin, true),
          eq(playbooks.isPublic, true)
        ),
      ];

      if (input.category) {
        conditions.push(eq(playbooks.category, input.category));
      }

      if (input.search) {
        conditions.push(
          or(
            ilike(playbooks.name, `%${input.search}%`),
            ilike(playbooks.description, `%${input.search}%`)
          )
        );
      }

      if (input.builtinOnly) {
        conditions.push(eq(playbooks.isBuiltin, true));
      }

      if (input.cursor) {
        const cursorPlaybook = await ctx.db.query.playbooks.findFirst({
          where: eq(playbooks.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cursorPlaybook) {
          conditions.push(lt(playbooks.createdAt, cursorPlaybook.createdAt));
        }
      }

      const results = await ctx.db.query.playbooks.findMany({
        where: and(...conditions),
        orderBy: [desc(playbooks.usageCount), desc(playbooks.createdAt)],
        limit: input.limit + 1,
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        playbooks: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Get Single Playbook ─────────────────────────────────────────────
  get: protectedProcedure
    .input(getPlaybookSchema)
    .query(async ({ input, ctx }) => {
      const playbook = await ctx.db.query.playbooks.findFirst({
        where: eq(playbooks.id, input.playbookId),
        with: { runs: { limit: 5, orderBy: [desc(playbookRuns.createdAt)] } },
      });

      if (!playbook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      // Allow access if it's the org's playbook, builtin, or public
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

      return playbook;
    }),

  // ─── Create Custom Playbook ──────────────────────────────────────────
  create: protectedProcedure
    .input(createPlaybookSchema)
    .mutation(async ({ input, ctx }) => {
      const id = generateId("pb");

      const [playbook] = await ctx.db
        .insert(playbooks)
        .values({
          id,
          orgId: ctx.orgId,
          name: input.name,
          description: input.description ?? null,
          category: input.category,
          steps: input.steps,
          parameters: input.parameters,
          isBuiltin: false,
          isPublic: input.isPublic,
          tags: input.tags,
        })
        .returning();

      logger.info({ playbookId: id, orgId: ctx.orgId }, "Playbook created");

      return playbook;
    }),

  // ─── Update Playbook ─────────────────────────────────────────────────
  update: protectedProcedure
    .input(updatePlaybookSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.playbooks.findFirst({
        where: eq(playbooks.id, input.playbookId),
      });

      if (!existing || existing.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      if (existing.isBuiltin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot modify built-in playbooks",
        });
      }

      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) {
        updateData.name = input.name;
      }
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.category !== undefined) {
        updateData.category = input.category;
      }
      if (input.steps !== undefined) {
        updateData.steps = input.steps;
      }
      if (input.parameters !== undefined) {
        updateData.parameters = input.parameters;
      }
      if (input.isPublic !== undefined) {
        updateData.isPublic = input.isPublic;
      }
      if (input.tags !== undefined) {
        updateData.tags = input.tags;
      }

      if (Object.keys(updateData).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No fields to update",
        });
      }

      const [updated] = await ctx.db
        .update(playbooks)
        .set(updateData)
        .where(
          and(
            eq(playbooks.id, input.playbookId),
            eq(playbooks.orgId, ctx.orgId)
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      logger.info({ playbookId: input.playbookId }, "Playbook updated");

      return updated;
    }),

  // ─── Delete Playbook ─────────────────────────────────────────────────
  delete: protectedProcedure
    .input(deletePlaybookSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.playbooks.findFirst({
        where: eq(playbooks.id, input.playbookId),
      });

      if (!existing || existing.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playbook not found",
        });
      }

      if (existing.isBuiltin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot delete built-in playbooks",
        });
      }

      await ctx.db
        .delete(playbooks)
        .where(
          and(
            eq(playbooks.id, input.playbookId),
            eq(playbooks.orgId, ctx.orgId)
          )
        );

      logger.info({ playbookId: input.playbookId }, "Playbook deleted");

      return { success: true };
    }),

  // ─── Run Playbook ────────────────────────────────────────────────────
  run: protectedProcedure
    .input(runPlaybookSchema)
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
        columns: { id: true },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
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
          status: "pending",
        })
        .returning();

      // Increment usage count
      await ctx.db
        .update(playbooks)
        .set({
          usageCount: sql`${playbooks.usageCount} + 1`,
        })
        .where(eq(playbooks.id, input.playbookId));

      logger.info(
        {
          runId,
          playbookId: input.playbookId,
          projectId: input.projectId,
          orgId: ctx.orgId,
        },
        "Playbook run started"
      );

      return {
        run,
        playbook: {
          id: playbook.id,
          name: playbook.name,
          steps: playbook.steps,
        },
      };
    }),

  // ─── List Playbook Runs ──────────────────────────────────────────────
  runs: protectedProcedure
    .input(listPlaybookRunsSchema)
    .query(async ({ input, ctx }) => {
      const conditions = [eq(playbookRuns.orgId, ctx.orgId)];

      if (input.playbookId) {
        conditions.push(eq(playbookRuns.playbookId, input.playbookId));
      }
      if (input.projectId) {
        conditions.push(eq(playbookRuns.projectId, input.projectId));
      }
      if (input.status) {
        conditions.push(eq(playbookRuns.status, input.status));
      }

      if (input.cursor) {
        const cursorRun = await ctx.db.query.playbookRuns.findFirst({
          where: eq(playbookRuns.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cursorRun) {
          conditions.push(lt(playbookRuns.createdAt, cursorRun.createdAt));
        }
      }

      const results = await ctx.db.query.playbookRuns.findMany({
        where: and(...conditions),
        orderBy: [desc(playbookRuns.createdAt)],
        limit: input.limit + 1,
        with: {
          playbook: { columns: { id: true, name: true, category: true } },
        },
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        runs: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── List Built-in Playbooks ─────────────────────────────────────────
  builtins: protectedProcedure.query(async ({ ctx }) => {
    const results = await ctx.db.query.playbooks.findMany({
      where: eq(playbooks.isBuiltin, true),
      orderBy: [desc(playbooks.usageCount)],
    });

    return results;
  }),
});
