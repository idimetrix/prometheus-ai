import { z } from "zod";
import { eq, and, desc, lt } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { createSessionSchema } from "@prometheus/validators";
import { sessions, sessionEvents, projects } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { agentTaskQueue } from "@prometheus/queue";

export const sessionsRouter = router({
  create: protectedProcedure
    .input(createSessionSchema)
    .mutation(async ({ input, ctx }) => {
      // Verify project belongs to org
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId),
        ),
      });
      if (!project) {
        throw new Error("Project not found");
      }

      const id = generateId("ses");
      const [session] = await ctx.db.insert(sessions).values({
        id,
        projectId: input.projectId,
        userId: ctx.auth.userId,
        status: "active",
        mode: input.mode,
      }).returning();

      // If there's a prompt, queue the initial task
      if (input.prompt) {
        const taskId = generateId("task");
        await agentTaskQueue.add("agent-task", {
          taskId,
          sessionId: id,
          projectId: input.projectId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          title: input.prompt.slice(0, 200),
          description: input.prompt,
          mode: input.mode,
          agentRole: null,
          planTier: "hobby",
          creditsReserved: 0,
        }, {
          priority: 50,
        });
      }

      return session;
    }),

  get: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input, ctx }) => {
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: {
          events: {
            orderBy: [desc(sessionEvents.timestamp)],
            limit: 50,
          },
          messages: true,
          project: true,
        },
      });
      return session ?? null;
    }),

  list: protectedProcedure
    .input(z.object({
      projectId: z.string().optional(),
      status: z.enum(["active", "paused", "completed", "failed", "cancelled"]).optional(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // Get project IDs for this org
      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.orgId, ctx.orgId),
        columns: { id: true },
      });
      const projectIds = orgProjects.map((p) => p.id);
      if (projectIds.length === 0) {
        return { sessions: [], nextCursor: null };
      }

      const conditions = [];
      if (input.projectId) {
        conditions.push(eq(sessions.projectId, input.projectId));
      }
      if (input.status) {
        conditions.push(eq(sessions.status, input.status));
      }
      if (input.cursor) {
        const cursorSession = await ctx.db.query.sessions.findFirst({
          where: eq(sessions.id, input.cursor),
          columns: { startedAt: true },
        });
        if (cursorSession) {
          conditions.push(lt(sessions.startedAt, cursorSession.startedAt));
        }
      }

      const results = await ctx.db.query.sessions.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(sessions.startedAt)],
        limit: input.limit + 1,
        with: { project: { columns: { id: true, name: true } } },
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        sessions: items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
      };
    }),

  pause: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db.update(sessions)
        .set({ status: "paused" })
        .where(and(
          eq(sessions.id, input.sessionId),
          eq(sessions.status, "active"),
        ))
        .returning();
      return { success: !!updated };
    }),

  resume: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db.update(sessions)
        .set({ status: "active" })
        .where(and(
          eq(sessions.id, input.sessionId),
          eq(sessions.status, "paused"),
        ))
        .returning();
      return { success: !!updated };
    }),

  cancel: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db.update(sessions)
        .set({ status: "cancelled", endedAt: new Date() })
        .where(eq(sessions.id, input.sessionId))
        .returning();
      return { success: !!updated };
    }),
});
