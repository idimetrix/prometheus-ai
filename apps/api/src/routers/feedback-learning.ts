import { sessionEvents, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("feedback-learning-router");

const correctionCategoryEnum = z.enum([
  "style",
  "logic",
  "performance",
  "security",
  "naming",
  "library",
  "pattern",
]);

export const feedbackLearningRouter = router({
  /**
   * Submit a user correction during a session.
   */
  submitCorrection: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        projectId: z.string().min(1),
        userMessage: z.string().min(1).max(5000),
        category: correctionCategoryEnum,
        before: z.string().max(10_000),
        after: z.string().max(10_000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify session belongs to caller's org
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

      const eventId = generateId("evt");

      // Store as a session event for replay and persistence
      await ctx.db.insert(sessionEvents).values({
        id: eventId,
        sessionId: input.sessionId,
        type: "agent_output",
        data: {
          correctionType: "user_feedback",
          userMessage: input.userMessage,
          category: input.category,
          before: input.before,
          after: input.after,
          projectId: input.projectId,
          userId: ctx.auth.userId,
        },
        agentRole: null,
      });

      logger.info(
        {
          eventId,
          sessionId: input.sessionId,
          projectId: input.projectId,
          category: input.category,
        },
        "User correction submitted"
      );

      return { id: eventId, success: true };
    }),

  /**
   * List learned conventions for a project.
   */
  getLearnedConventions: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      // Fetch correction events for this project
      const events = await ctx.db.query.sessionEvents.findMany({
        where: eq(sessionEvents.type, "agent_output"),
        orderBy: [desc(sessionEvents.timestamp)],
        limit: input.limit * 5, // overfetch since we filter in-memory
      });

      interface CorrectionData {
        after: string;
        before: string;
        category: string;
        correctionType: string;
        projectId: string;
        userMessage: string;
      }

      const conventions = events
        .filter((e) => {
          const data = e.data as CorrectionData;
          return (
            data.correctionType === "user_feedback" &&
            data.projectId === input.projectId
          );
        })
        .slice(0, input.limit)
        .map((e) => {
          const data = e.data as CorrectionData;
          return {
            id: e.id,
            rule: data.userMessage,
            category: data.category,
            before: data.before?.slice(0, 200) ?? "",
            after: data.after?.slice(0, 200) ?? "",
            confidence: 0.8,
            timestamp: e.timestamp.toISOString(),
          };
        });

      return { conventions };
    }),

  /**
   * Delete a learned convention.
   */
  deleteConvention: protectedProcedure
    .input(z.object({ eventId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.db.query.sessionEvents.findFirst({
        where: eq(sessionEvents.id, input.eventId),
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Convention not found",
        });
      }

      // Verify org access
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, event.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });

      if (!session || session.project.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Convention not found",
        });
      }

      await ctx.db
        .delete(sessionEvents)
        .where(eq(sessionEvents.id, input.eventId));

      logger.info({ eventId: input.eventId }, "Learned convention deleted");

      return { success: true };
    }),

  /**
   * Force-apply a convention to future sessions for a project.
   */
  applyConvention: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        rule: z.string().min(1).max(5000),
        category: correctionCategoryEnum,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const eventId = generateId("evt");

      // Create a synthetic correction event that will be picked up by future sessions
      await ctx.db.insert(sessionEvents).values({
        id: eventId,
        sessionId: input.projectId, // Use projectId as a synthetic session reference
        type: "agent_output",
        data: {
          correctionType: "user_feedback",
          userMessage: input.rule,
          category: input.category,
          before: "",
          after: "",
          projectId: input.projectId,
          userId: ctx.auth.userId,
          applied: true,
        },
        agentRole: null,
      });

      logger.info(
        {
          eventId,
          projectId: input.projectId,
          category: input.category,
        },
        "Convention applied to future sessions"
      );

      return { id: eventId, success: true };
    }),
});
