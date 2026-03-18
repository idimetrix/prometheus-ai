import type { Database } from "@prometheus/db";
import {
  projects,
  sessionEvents,
  sessionMessages,
  sessions,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import {
  cancelSessionSchema,
  createSessionSchema,
  getSessionSchema,
  listSessionsSchema,
  pauseSessionSchema,
  resumeSessionSchema,
  sendMessageSchema,
} from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("sessions-router");

const ORCHESTRATOR_URL = "http://localhost:4002";

/**
 * Verify that a session belongs to the caller's org.
 * Returns the session row or throws TRPC NOT_FOUND.
 */
async function verifySessionAccess(
  db: Database,
  sessionId: string,
  orgId: string
) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    with: { project: { columns: { id: true, orgId: true } } },
  });

  if (!session || session.project.orgId !== orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  }

  return session;
}

export const sessionsRouter = router({
  // ─── Create Session ──────────────────────────────────────────────────
  create: protectedProcedure
    .input(createSessionSchema)
    .mutation(async ({ input, ctx }) => {
      // Verify project belongs to org
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const id = generateId("ses");
      const [session] = await ctx.db
        .insert(sessions)
        .values({
          id,
          projectId: input.projectId,
          userId: ctx.auth.userId,
          status: "active",
          mode: input.mode,
        })
        .returning();

      logger.info(
        { sessionId: id, projectId: input.projectId, mode: input.mode },
        "Session created"
      );

      // If there's a prompt, queue the initial task
      if (input.prompt) {
        const taskId = generateId("task");
        await agentTaskQueue.add(
          "agent-task",
          {
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
          },
          {
            priority: 50,
          }
        );
      }

      return session as NonNullable<typeof session>;
    }),

  // ─── Get Session with Events (paginated) ─────────────────────────────
  get: protectedProcedure
    .input(
      getSessionSchema.extend({
        eventsLimit: z.number().int().min(1).max(200).default(50),
        eventsCursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const session = await verifySessionAccess(
        ctx.db,
        input.sessionId,
        ctx.orgId
      );

      // Fetch events with cursor-based pagination
      const eventConditions = [eq(sessionEvents.sessionId, input.sessionId)];
      if (input.eventsCursor) {
        const cursorEvent = await ctx.db.query.sessionEvents.findFirst({
          where: eq(sessionEvents.id, input.eventsCursor),
          columns: { timestamp: true },
        });
        if (cursorEvent) {
          eventConditions.push(
            lt(sessionEvents.timestamp, cursorEvent.timestamp)
          );
        }
      }

      const events = await ctx.db.query.sessionEvents.findMany({
        where: and(...eventConditions),
        orderBy: [desc(sessionEvents.timestamp)],
        limit: input.eventsLimit + 1,
      });

      const hasMoreEvents = events.length > input.eventsLimit;
      const eventItems = hasMoreEvents
        ? events.slice(0, input.eventsLimit)
        : events;

      // Fetch messages
      const messages = await ctx.db.query.sessionMessages.findMany({
        where: eq(sessionMessages.sessionId, input.sessionId),
        orderBy: [desc(sessionMessages.createdAt)],
        limit: 100,
      });

      // Fetch project info
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
        columns: { id: true, name: true, orgId: true },
      });

      return {
        ...session,
        project,
        events: eventItems,
        eventsNextCursor: hasMoreEvents ? eventItems.at(-1)?.id : null,
        messages,
      };
    }),

  // ─── List Sessions by Project ─────────────────────────────────────────
  list: protectedProcedure
    .input(
      listSessionsSchema.extend({
        dateFrom: z.string().datetime().optional(),
        dateTo: z.string().datetime().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Build org-scoped project IDs for RLS
      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.orgId, ctx.orgId),
        columns: { id: true },
      });
      const projectIds = orgProjects.map((p) => p.id);
      if (projectIds.length === 0) {
        return { sessions: [], nextCursor: null };
      }

      const conditions = [inArray(sessions.projectId, projectIds)];

      if (input.projectId) {
        // Validate the project belongs to org
        if (!projectIds.includes(input.projectId)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }
        conditions.push(eq(sessions.projectId, input.projectId));
      }
      if (input.status) {
        conditions.push(eq(sessions.status, input.status));
      }
      if (input.mode) {
        conditions.push(eq(sessions.mode, input.mode));
      }
      if (input.dateFrom) {
        conditions.push(gte(sessions.startedAt, new Date(input.dateFrom)));
      }
      if (input.dateTo) {
        conditions.push(lte(sessions.startedAt, new Date(input.dateTo)));
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
        where: and(...conditions),
        orderBy: [desc(sessions.startedAt)],
        limit: input.limit + 1,
        with: { project: { columns: { id: true, name: true } } },
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        sessions: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Pause Session ────────────────────────────────────────────────────
  pause: protectedProcedure
    .input(pauseSessionSchema)
    .mutation(async ({ input, ctx }) => {
      await verifySessionAccess(ctx.db, input.sessionId, ctx.orgId);

      const [updated] = await ctx.db
        .update(sessions)
        .set({ status: "paused" })
        .where(
          and(eq(sessions.id, input.sessionId), eq(sessions.status, "active"))
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Session is not active and cannot be paused",
        });
      }

      // Record event
      await ctx.db.insert(sessionEvents).values({
        id: generateId("evt"),
        sessionId: input.sessionId,
        type: "checkpoint",
        data: { action: "paused", reason: input.reason ?? null },
      });

      logger.info({ sessionId: input.sessionId }, "Session paused");
      return { success: true, session: updated };
    }),

  // ─── Resume Session ───────────────────────────────────────────────────
  resume: protectedProcedure
    .input(resumeSessionSchema)
    .mutation(async ({ input, ctx }) => {
      await verifySessionAccess(ctx.db, input.sessionId, ctx.orgId);

      const [updated] = await ctx.db
        .update(sessions)
        .set({ status: "active" })
        .where(
          and(eq(sessions.id, input.sessionId), eq(sessions.status, "paused"))
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Session is not paused and cannot be resumed",
        });
      }

      // Record event
      await ctx.db.insert(sessionEvents).values({
        id: generateId("evt"),
        sessionId: input.sessionId,
        type: "checkpoint",
        data: { action: "resumed" },
      });

      // If a prompt is provided on resume, queue a new task
      if (input.prompt) {
        const taskId = generateId("task");
        await agentTaskQueue.add(
          "agent-task",
          {
            taskId,
            sessionId: input.sessionId,
            projectId: updated.projectId,
            orgId: ctx.orgId,
            userId: ctx.auth.userId,
            title: input.prompt.slice(0, 200),
            description: input.prompt,
            mode: updated.mode,
            agentRole: null,
            planTier: "hobby",
            creditsReserved: 0,
          },
          { priority: 50 }
        );
      }

      logger.info({ sessionId: input.sessionId }, "Session resumed");
      return { success: true, session: updated };
    }),

  // ─── Cancel Session ───────────────────────────────────────────────────
  cancel: protectedProcedure
    .input(cancelSessionSchema)
    .mutation(async ({ input, ctx }) => {
      await verifySessionAccess(ctx.db, input.sessionId, ctx.orgId);

      const [updated] = await ctx.db
        .update(sessions)
        .set({ status: "cancelled", endedAt: new Date() })
        .where(
          and(
            eq(sessions.id, input.sessionId),
            inArray(sessions.status, ["active", "paused"])
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Session is already ended and cannot be cancelled",
        });
      }

      // Record event
      await ctx.db.insert(sessionEvents).values({
        id: generateId("evt"),
        sessionId: input.sessionId,
        type: "checkpoint",
        data: { action: "cancelled", reason: input.reason ?? null },
      });

      logger.info({ sessionId: input.sessionId }, "Session cancelled");
      return { success: true, session: updated };
    }),

  // ─── Send Message to Session ──────────────────────────────────────────
  sendMessage: protectedProcedure
    .input(sendMessageSchema)
    .mutation(async ({ input, ctx }) => {
      const session = await verifySessionAccess(
        ctx.db,
        input.sessionId,
        ctx.orgId
      );

      if (session.status !== "active") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot send message to a ${session.status} session`,
        });
      }

      const messageId = generateId("msg");
      const [message] = await ctx.db
        .insert(sessionMessages)
        .values({
          id: messageId,
          sessionId: input.sessionId,
          role: "user",
          content: input.content,
        })
        .returning();

      // Queue the message as a task for the agent to process
      const taskId = generateId("task");
      await agentTaskQueue.add(
        "agent-task",
        {
          taskId,
          sessionId: input.sessionId,
          projectId: session.projectId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          title: input.content.slice(0, 200),
          description: input.content,
          mode: session.mode,
          agentRole: null,
          planTier: "hobby",
          creditsReserved: 0,
        },
        { priority: 50 }
      );

      logger.info(
        { sessionId: input.sessionId, messageId },
        "Message sent to session"
      );
      return { message: message as NonNullable<typeof message>, taskId };
    }),

  // ─── Get Session Timeline (all events) ────────────────────────────────
  timeline: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        types: z
          .array(
            z.enum([
              "agent_output",
              "file_change",
              "plan_update",
              "task_status",
              "queue_position",
              "credit_update",
              "checkpoint",
              "error",
              "reasoning",
              "terminal_output",
              "browser_screenshot",
            ])
          )
          .optional(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifySessionAccess(ctx.db, input.sessionId, ctx.orgId);

      const conditions = [eq(sessionEvents.sessionId, input.sessionId)];

      if (input.types && input.types.length > 0) {
        conditions.push(inArray(sessionEvents.type, input.types));
      }

      if (input.cursor) {
        const cursorEvent = await ctx.db.query.sessionEvents.findFirst({
          where: eq(sessionEvents.id, input.cursor),
          columns: { timestamp: true },
        });
        if (cursorEvent) {
          conditions.push(lt(sessionEvents.timestamp, cursorEvent.timestamp));
        }
      }

      const events = await ctx.db.query.sessionEvents.findMany({
        where: and(...conditions),
        orderBy: [desc(sessionEvents.timestamp)],
        limit: input.limit + 1,
      });

      const hasMore = events.length > input.limit;
      const items = hasMore ? events.slice(0, input.limit) : events;

      // Also include messages interleaved by time
      const messages = await ctx.db.query.sessionMessages.findMany({
        where: eq(sessionMessages.sessionId, input.sessionId),
        orderBy: [desc(sessionMessages.createdAt)],
        limit: input.limit,
      });

      return {
        events: items,
        messages,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Approve Plan Checkpoint ─────────────────────────────────────────
  approvePlan: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        checkpointId: z.string().min(1, "Checkpoint ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifySessionAccess(ctx.db, input.sessionId, ctx.orgId);

      const res = await fetch(`${ORCHESTRATOR_URL}/sessions/approve-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          checkpointId: input.checkpointId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
        }),
      });

      if (!res.ok) {
        logger.error(
          {
            sessionId: input.sessionId,
            checkpointId: input.checkpointId,
            status: res.status,
          },
          "Failed to approve plan via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to approve plan",
        });
      }

      await ctx.db.insert(sessionEvents).values({
        id: generateId("evt"),
        sessionId: input.sessionId,
        type: "checkpoint",
        data: {
          action: "plan_approved",
          checkpointId: input.checkpointId,
          userId: ctx.auth.userId,
        },
      });

      logger.info(
        { sessionId: input.sessionId, checkpointId: input.checkpointId },
        "Plan approved"
      );
      return { success: true };
    }),

  // ─── Reject Plan Checkpoint ──────────────────────────────────────────
  rejectPlan: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        checkpointId: z.string().min(1, "Checkpoint ID is required"),
        reason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifySessionAccess(ctx.db, input.sessionId, ctx.orgId);

      const res = await fetch(`${ORCHESTRATOR_URL}/sessions/reject-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          checkpointId: input.checkpointId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          reason: input.reason ?? null,
        }),
      });

      if (!res.ok) {
        logger.error(
          {
            sessionId: input.sessionId,
            checkpointId: input.checkpointId,
            status: res.status,
          },
          "Failed to reject plan via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to reject plan",
        });
      }

      await ctx.db.insert(sessionEvents).values({
        id: generateId("evt"),
        sessionId: input.sessionId,
        type: "checkpoint",
        data: {
          action: "plan_rejected",
          checkpointId: input.checkpointId,
          userId: ctx.auth.userId,
          reason: input.reason ?? null,
        },
      });

      logger.info(
        { sessionId: input.sessionId, checkpointId: input.checkpointId },
        "Plan rejected"
      );
      return { success: true };
    }),

  // ─── Modify Plan Steps ───────────────────────────────────────────────
  modifyPlan: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        checkpointId: z.string().min(1, "Checkpoint ID is required"),
        steps: z
          .array(
            z.object({
              id: z.string().optional(),
              title: z.string().min(1).max(500),
              description: z.string().max(5000).optional(),
              status: z
                .enum(["pending", "approved", "rejected", "skipped"])
                .optional(),
            })
          )
          .min(1, "At least one step is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifySessionAccess(ctx.db, input.sessionId, ctx.orgId);

      const res = await fetch(`${ORCHESTRATOR_URL}/sessions/modify-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          checkpointId: input.checkpointId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          steps: input.steps,
        }),
      });

      if (!res.ok) {
        logger.error(
          {
            sessionId: input.sessionId,
            checkpointId: input.checkpointId,
            status: res.status,
          },
          "Failed to modify plan via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to modify plan",
        });
      }

      await ctx.db.insert(sessionEvents).values({
        id: generateId("evt"),
        sessionId: input.sessionId,
        type: "plan_update",
        data: {
          action: "plan_modified",
          checkpointId: input.checkpointId,
          userId: ctx.auth.userId,
          stepCount: input.steps.length,
        },
      });

      logger.info(
        {
          sessionId: input.sessionId,
          checkpointId: input.checkpointId,
          stepCount: input.steps.length,
        },
        "Plan modified"
      );
      return { success: true };
    }),

  // ─── Takeover Session (User Takes Control) ───────────────────────────
  takeover: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const session = await verifySessionAccess(
        ctx.db,
        input.sessionId,
        ctx.orgId
      );

      if (session.status !== "active") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot take over a ${session.status} session`,
        });
      }

      const res = await fetch(`${ORCHESTRATOR_URL}/sessions/takeover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
        }),
      });

      if (!res.ok) {
        logger.error(
          { sessionId: input.sessionId, status: res.status },
          "Failed to takeover session via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to take over session",
        });
      }

      await ctx.db.insert(sessionEvents).values({
        id: generateId("evt"),
        sessionId: input.sessionId,
        type: "checkpoint",
        data: { action: "takeover", userId: ctx.auth.userId },
      });

      logger.info(
        { sessionId: input.sessionId, userId: ctx.auth.userId },
        "Session taken over by user"
      );
      return { success: true };
    }),

  // ─── Release Session (Return Control to Agent) ───────────────────────
  release: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifySessionAccess(ctx.db, input.sessionId, ctx.orgId);

      const res = await fetch(`${ORCHESTRATOR_URL}/sessions/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
        }),
      });

      if (!res.ok) {
        logger.error(
          { sessionId: input.sessionId, status: res.status },
          "Failed to release session via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to release session",
        });
      }

      await ctx.db.insert(sessionEvents).values({
        id: generateId("evt"),
        sessionId: input.sessionId,
        type: "checkpoint",
        data: { action: "released", userId: ctx.auth.userId },
      });

      logger.info(
        { sessionId: input.sessionId, userId: ctx.auth.userId },
        "Session control released back to agent"
      );
      return { success: true };
    }),
});
