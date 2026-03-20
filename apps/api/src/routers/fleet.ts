import { agents, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import type { AgentRole } from "@prometheus/types";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("fleet-router");

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";

export const fleetRouter = router({
  dispatch: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        tasks: z
          .array(
            z.object({
              title: z.string().min(1, "Task title is required").max(500),
              description: z.string().max(10_000).optional(),
              agentRole: z.string().max(100).optional(),
            })
          )
          .min(1, "At least one task is required")
          .max(10, "Maximum 10 tasks per dispatch"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });
      if (!session || session.project.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const dispatched: (typeof tasks.$inferSelect)[] = [];

      for (const task of input.tasks) {
        const taskId = generateId("task");
        const [created] = await ctx.db
          .insert(tasks)
          .values({
            id: taskId,
            sessionId: input.sessionId,
            projectId: session.projectId,
            orgId: ctx.orgId,
            title: task.title,
            description: task.description ?? null,
            status: "queued",
            agentRole: task.agentRole ?? null,
            priority: 50,
          })
          .returning();

        await agentTaskQueue.add(
          "agent-task",
          {
            taskId,
            sessionId: input.sessionId,
            projectId: session.projectId,
            orgId: ctx.orgId,
            userId: ctx.auth.userId,
            title: task.title,
            description: task.description ?? null,
            mode: "fleet",
            agentRole: (task.agentRole as AgentRole) ?? null,
            planTier: "hobby",
            creditsReserved: 0,
          },
          {
            priority: 50,
            jobId: taskId,
          }
        );

        dispatched.push(created as NonNullable<typeof created>);
      }

      return { dispatched };
    }),

  status: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1, "Session ID is required") }))
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

  pause: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        agentId: z.string().min(1, "Agent ID is required"),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });
      if (!session || session.project.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const agent = await ctx.db.query.agents.findFirst({
        where: and(
          eq(agents.id, input.agentId),
          eq(agents.sessionId, input.sessionId)
        ),
      });
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }

      // Notify orchestrator to pause the agent
      const res = await fetch(`${ORCHESTRATOR_URL}/fleet/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: input.agentId,
          sessionId: input.sessionId,
          orgId: ctx.orgId,
          reason: input.reason ?? null,
        }),
      });

      if (!res.ok) {
        logger.error(
          { agentId: input.agentId, status: res.status },
          "Failed to pause agent via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to pause agent",
        });
      }

      await ctx.db
        .update(agents)
        .set({ status: "idle" })
        .where(eq(agents.id, input.agentId));

      logger.info(
        { agentId: input.agentId, sessionId: input.sessionId },
        "Fleet agent paused"
      );
      return { success: true };
    }),

  resume: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        agentId: z.string().min(1, "Agent ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });
      if (!session || session.project.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const agent = await ctx.db.query.agents.findFirst({
        where: and(
          eq(agents.id, input.agentId),
          eq(agents.sessionId, input.sessionId)
        ),
      });
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }

      // Notify orchestrator to resume the agent
      const res = await fetch(`${ORCHESTRATOR_URL}/fleet/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: input.agentId,
          sessionId: input.sessionId,
          orgId: ctx.orgId,
        }),
      });

      if (!res.ok) {
        logger.error(
          { agentId: input.agentId, status: res.status },
          "Failed to resume agent via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to resume agent",
        });
      }

      await ctx.db
        .update(agents)
        .set({ status: "working" })
        .where(eq(agents.id, input.agentId));

      logger.info(
        { agentId: input.agentId, sessionId: input.sessionId },
        "Fleet agent resumed"
      );
      return { success: true };
    }),

  plan: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        taskDescription: z.string().min(1).max(10_000),
        projectContext: z.string().max(50_000).optional(),
        blueprint: z.string().max(50_000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });
      if (!session || session.project.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Call orchestrator to generate a plan
      const res = await fetch(`${ORCHESTRATOR_URL}/fleet/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          projectId: session.projectId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          taskDescription: input.taskDescription,
          projectContext: input.projectContext ?? "",
          blueprint: input.blueprint ?? "",
        }),
      });

      if (!res.ok) {
        logger.error(
          { sessionId: input.sessionId, status: res.status },
          "Failed to generate plan via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate plan",
        });
      }

      const plan = (await res.json()) as {
        id: string;
        subtasks: Array<{
          id: string;
          title: string;
          agentRole: string;
          priority: number;
        }>;
        dependencies: Array<{
          from: string;
          to: string;
          type: string;
        }>;
        estimatedCredits: number;
      };

      logger.info(
        {
          sessionId: input.sessionId,
          planId: plan.id,
          subtaskCount: plan.subtasks.length,
        },
        "Plan generated"
      );

      return { plan };
    }),

  approvePlan: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        planId: z.string().min(1, "Plan ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });
      if (!session || session.project.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      // Call orchestrator to execute the approved plan
      const res = await fetch(`${ORCHESTRATOR_URL}/fleet/approve-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          projectId: session.projectId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          planId: input.planId,
        }),
      });

      if (!res.ok) {
        logger.error(
          {
            sessionId: input.sessionId,
            planId: input.planId,
            status: res.status,
          },
          "Failed to approve plan via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start plan execution",
        });
      }

      logger.info(
        { sessionId: input.sessionId, planId: input.planId },
        "Plan approved and execution started"
      );

      return { success: true, planId: input.planId };
    }),

  stop: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        agentId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.agentId) {
        await ctx.db
          .update(agents)
          .set({ status: "terminated", terminatedAt: new Date() })
          .where(eq(agents.id, input.agentId));
      } else {
        // Stop all agents in session
        await ctx.db
          .update(agents)
          .set({ status: "terminated", terminatedAt: new Date() })
          .where(
            and(
              eq(agents.sessionId, input.sessionId),
              inArray(agents.status, ["idle", "working"])
            )
          );
      }

      return { success: true };
    }),
});
