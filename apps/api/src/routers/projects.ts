import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { createProjectSchema, updateProjectSchema } from "@prometheus/validators";
import { projects, projectSettings, projectMembers } from "@prometheus/db";
import { generateId } from "@prometheus/utils";

export const projectsRouter = router({
  create: protectedProcedure
    .input(createProjectSchema)
    .mutation(async ({ input, ctx }) => {
      const id = generateId("proj");
      const [project] = await ctx.db.insert(projects).values({
        id,
        orgId: ctx.orgId,
        name: input.name,
        description: input.description ?? null,
        repoUrl: input.repoUrl ?? null,
        techStackPreset: input.techStackPreset ?? null,
        status: "setup",
      }).returning();

      await ctx.db.insert(projectSettings).values({
        projectId: id,
      });

      await ctx.db.insert(projectMembers).values({
        id: generateId("pm"),
        projectId: id,
        userId: ctx.auth.userId,
        role: "owner",
      });

      return project;
    }),

  get: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId),
        ),
        with: {
          settings: true,
          members: true,
        },
      });
      return project ?? null;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.enum(["active", "archived", "setup"]).optional(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(projects.orgId, ctx.orgId)];
      if (input.status) {
        conditions.push(eq(projects.status, input.status));
      }

      const results = await ctx.db.query.projects.findMany({
        where: and(...conditions),
        orderBy: [desc(projects.createdAt)],
        limit: input.limit,
        with: { settings: true },
      });

      return { projects: results };
    }),

  update: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      data: updateProjectSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db.update(projects)
        .set({ ...input.data, updatedAt: new Date() })
        .where(and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId),
        ))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db.update(projects)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId),
        ))
        .returning();
      return { success: !!updated };
    }),
});
