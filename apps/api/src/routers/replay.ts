import { sessionEvents, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("replay-router");

export const replayRouter = router({
  /**
   * Get all session events ordered by timestamp for replay.
   */
  getTimeline: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        limit: z.number().int().min(1).max(5000).default(1000),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
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

      const events = await ctx.db.query.sessionEvents.findMany({
        where: eq(sessionEvents.sessionId, input.sessionId),
        orderBy: [asc(sessionEvents.timestamp)],
        limit: input.limit,
        offset: input.offset,
      });

      logger.info(
        {
          sessionId: input.sessionId,
          eventCount: events.length,
        },
        "Replay timeline fetched"
      );

      return {
        sessionId: input.sessionId,
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          data: e.data,
          agentRole: e.agentRole,
          timestamp: e.timestamp.toISOString(),
        })),
        total: events.length,
      };
    }),

  /**
   * Get full details for a specific event.
   */
  getEventDetails: protectedProcedure
    .input(z.object({ eventId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const event = await ctx.db.query.sessionEvents.findFirst({
        where: eq(sessionEvents.id, input.eventId),
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      // Verify org access through session
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, event.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });

      if (!session || session.project.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      return {
        id: event.id,
        sessionId: event.sessionId,
        type: event.type,
        data: event.data,
        agentRole: event.agentRole,
        timestamp: event.timestamp.toISOString(),
      };
    }),

  /**
   * Get all file change events for a session, ordered by time.
   */
  getFileChanges: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
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

      const events = await ctx.db.query.sessionEvents.findMany({
        where: and(
          eq(sessionEvents.sessionId, input.sessionId),
          eq(sessionEvents.type, "file_change")
        ),
        orderBy: [asc(sessionEvents.timestamp)],
      });

      return {
        changes: events.map((e) => ({
          id: e.id,
          type: e.type,
          data: e.data,
          agentRole: e.agentRole,
          timestamp: e.timestamp.toISOString(),
        })),
      };
    }),

  /**
   * Get all agent reasoning and tool call events for replay.
   */
  getAgentSteps: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
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

      const events = await ctx.db.query.sessionEvents.findMany({
        where: and(
          eq(sessionEvents.sessionId, input.sessionId),
          inArray(sessionEvents.type, ["agent_output", "reasoning"])
        ),
        orderBy: [asc(sessionEvents.timestamp)],
      });

      return {
        steps: events.map((e) => ({
          id: e.id,
          type: e.type,
          data: e.data,
          agentRole: e.agentRole,
          timestamp: e.timestamp.toISOString(),
        })),
      };
    }),
});
