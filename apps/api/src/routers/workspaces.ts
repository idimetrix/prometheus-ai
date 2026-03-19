import { workspaces } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const workspacesRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        isDefault: z.boolean().default(false),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const workspace = await ctx.db
        .insert(workspaces)
        .values({
          id: generateId(),
          orgId: ctx.orgId,
          name: input.name,
          description: input.description ?? null,
          isDefault: input.isDefault,
          settings: input.settings ?? {},
        })
        .returning();

      return workspace[0];
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.id),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      return workspace;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const results = await ctx.db.query.workspaces.findMany({
      where: eq(workspaces.orgId, ctx.orgId),
      orderBy: (ws, { asc }) => [asc(ws.name)],
    });

    return { workspaces: results };
  }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().nullable().optional(),
        isDefault: z.boolean().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;

      const existing = await ctx.db.query.workspaces.findFirst({
        where: and(eq(workspaces.id, id), eq(workspaces.orgId, ctx.orgId)),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const updated = await ctx.db
        .update(workspaces)
        .set(data)
        .where(and(eq(workspaces.id, id), eq(workspaces.orgId, ctx.orgId)))
        .returning();

      return updated[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.id),
          eq(workspaces.orgId, ctx.orgId)
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      await ctx.db
        .delete(workspaces)
        .where(
          and(eq(workspaces.id, input.id), eq(workspaces.orgId, ctx.orgId))
        );

      return { success: true };
    }),
});
