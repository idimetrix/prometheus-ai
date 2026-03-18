import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { createProjectSchema, updateProjectSchema } from "@prometheus/validators";

export const projectsRouter = router({
  create: protectedProcedure
    .input(createProjectSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Create project in DB
      return {
        id: `proj_placeholder_${Date.now()}`,
        name: input.name,
        description: input.description ?? null,
        techStackPreset: input.techStackPreset ?? null,
        status: "setup" as const,
        createdAt: new Date(),
      };
    }),

  get: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      // TODO: Get project from DB
      return null;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.enum(["active", "archived", "setup"]).optional(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      // TODO: Query projects from DB
      return { projects: [] };
    }),

  update: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      data: updateProjectSchema,
    }))
    .mutation(async ({ input }) => {
      // TODO: Update project in DB
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input }) => {
      // TODO: Soft delete project
      return { success: true };
    }),
});
