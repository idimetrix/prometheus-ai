import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { agents, sessions, tasks, projects } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { agentTaskQueue } from "@prometheus/queue";

export const fleetRouter = router({
  dispatch: protectedProcedure
    .input(z.object({
      sessionId: z.string(),
      tasks: z.array(z.object({
        title: z.string(),
        description: z.string().optional(),
        agentRole: z.string().optional(),
      })).min(1).max(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });
      if (!session || session.project.orgId !== ctx.orgId) {
        throw new Error("Session not found");
      }

      const dispatched = [];

      for (const task of input.tasks) {
        const taskId = generateId("task");
        const [created] = await ctx.db.insert(tasks).values({
          id: taskId,
          sessionId: input.sessionId,
          projectId: session.projectId,
          title: task.title,
          description: task.description ?? null,
          status: "queued",
          agentRole: task.agentRole ?? null,
          priority: 50,
        }).returning();

        await agentTaskQueue.add("agent-task", {
          taskId,
          sessionId: input.sessionId,
          projectId: session.projectId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          title: task.title,
          description: task.description ?? null,
          mode: "fleet",
          agentRole: (task.agentRole as any) ?? null,
          planTier: "hobby",
          creditsReserved: 0,
        }, {
          priority: 50,
          jobId: taskId,
        });

        dispatched.push(created);
      }

      return { dispatched };
    }),

  status: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input, ctx }) => {
      const activeAgents = await ctx.db.query.agents.findMany({
        where: eq(agents.sessionId, input.sessionId),
        orderBy: [desc(agents.startedAt)],
      });

      const sessionTasks = await ctx.db.query.tasks.findMany({
        where: eq(tasks.sessionId, input.sessionId),
        orderBy: [desc(tasks.createdAt)],
      });

      return {
        agents: activeAgents.map((a) => ({
          id: a.id,
          role: a.role,
          status: a.status,
          tokensIn: a.tokensIn,
          tokensOut: a.tokensOut,
          stepsCompleted: a.stepsCompleted,
          startedAt: a.startedAt,
        })),
        tasks: sessionTasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          agentRole: t.agentRole,
          creditsConsumed: t.creditsConsumed,
        })),
      };
    }),

  stop: protectedProcedure
    .input(z.object({
      sessionId: z.string(),
      agentId: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.agentId) {
        await ctx.db.update(agents)
          .set({ status: "terminated", terminatedAt: new Date() })
          .where(eq(agents.id, input.agentId));
      } else {
        // Stop all agents in session
        await ctx.db.update(agents)
          .set({ status: "terminated", terminatedAt: new Date() })
          .where(and(
            eq(agents.sessionId, input.sessionId),
            inArray(agents.status, ["idle", "working"]),
          ));
      }

      return { success: true };
    }),
});
