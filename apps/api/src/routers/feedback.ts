import { auditLogs, userCorrections } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:feedback");

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const feedbackRouter = router({
  /**
   * Submit feedback on an agent response or session event.
   *
   * Accepts a thumbs-up / thumbs-down rating and an optional free-text
   * comment. Creates an audit log entry with action "feedback.positive"
   * or "feedback.negative".
   */
  submit: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        eventId: z.string().optional(),
        rating: z.enum(["thumbs_up", "thumbs_down"]),
        comment: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = generateId("fb");
      const action =
        input.rating === "thumbs_up"
          ? "feedback.positive"
          : "feedback.negative";

      await ctx.db.insert(auditLogs).values({
        id,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action,
        resource: "session",
        resourceId: input.sessionId,
        details: {
          eventId: input.eventId ?? null,
          rating: input.rating,
          comment: input.comment ?? null,
        },
      });

      logger.info(
        {
          orgId: ctx.orgId,
          sessionId: input.sessionId,
          feedbackId: id,
          rating: input.rating,
        },
        "Feedback submitted"
      );

      return {
        id,
        rating: input.rating,
        createdAt: new Date().toISOString(),
      };
    }),

  /**
   * Submit a code correction with the original and corrected versions.
   *
   * Used when a user manually fixes agent-generated code. These corrections
   * feed into the self-improvement training loop.
   */
  submitCorrection: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        originalCode: z.string().min(1, "Original code is required"),
        correctedCode: z.string().min(1, "Corrected code is required"),
        filePath: z.string().min(1, "File path is required"),
        correctionType: z.enum(["code", "approach", "style"]),
        explanation: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Reject no-op corrections
      if (input.originalCode === input.correctedCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Corrected code must differ from the original",
        });
      }

      const id = generateId("corr");

      await ctx.db.insert(userCorrections).values({
        id,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        sessionId: input.sessionId,
        correctionType: input.correctionType,
        original: input.originalCode,
        corrected: input.correctedCode,
        context: input.explanation ?? null,
      });

      logger.info(
        {
          orgId: ctx.orgId,
          sessionId: input.sessionId,
          correctionId: id,
          correctionType: input.correctionType,
          filePath: input.filePath,
        },
        "Code correction submitted"
      );

      return {
        id,
        correctionType: input.correctionType,
        filePath: input.filePath,
        createdAt: new Date().toISOString(),
      };
    }),

  /**
   * List all feedback entries for a session, ordered newest first.
   *
   * Queries audit_logs WHERE action starts with "feedback." and
   * resourceId matches the session.
   */
  list: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(auditLogs.orgId, ctx.orgId),
        eq(auditLogs.resourceId, input.sessionId),
        sql`${auditLogs.action} LIKE 'feedback.%'`,
      ];

      const [rows, totalResult] = await Promise.all([
        ctx.db
          .select({
            id: auditLogs.id,
            userId: auditLogs.userId,
            details: auditLogs.details,
            createdAt: auditLogs.createdAt,
            action: auditLogs.action,
          })
          .from(auditLogs)
          .where(and(...conditions))
          .orderBy(desc(auditLogs.createdAt))
          .limit(input.limit)
          .offset(input.offset),

        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLogs)
          .where(and(...conditions)),
      ]);

      const total = totalResult[0]?.count ?? 0;

      logger.info(
        {
          orgId: ctx.orgId,
          sessionId: input.sessionId,
          total,
        },
        "Listed feedback"
      );

      return {
        feedback: rows.map((f) => {
          const details = (f.details ?? {}) as Record<string, unknown>;
          return {
            id: f.id,
            eventId: (details.eventId as string) ?? null,
            userId: f.userId,
            rating: details.rating as string,
            comment: (details.comment as string) ?? null,
            createdAt: f.createdAt.toISOString(),
          };
        }),
        total,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Get aggregate feedback statistics for a project.
   *
   * Sums positive/negative ratings from audit_logs and correction counts
   * from userCorrections, grouped by correction type.
   */
  getStats: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      // Count positive and negative feedback from audit logs
      const [feedbackResult, correctionRows] = await Promise.all([
        ctx.db
          .select({
            action: auditLogs.action,
            count: sql<number>`count(*)::int`,
          })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.orgId, ctx.orgId),
              sql`${auditLogs.action} LIKE 'feedback.%'`
            )
          )
          .groupBy(auditLogs.action),

        ctx.db
          .select({
            correctionType: userCorrections.correctionType,
            count: sql<number>`count(*)::int`,
          })
          .from(userCorrections)
          .where(eq(userCorrections.orgId, ctx.orgId))
          .groupBy(userCorrections.correctionType),
      ]);

      let positiveCount = 0;
      let negativeCount = 0;

      for (const row of feedbackResult) {
        if (row.action === "feedback.positive") {
          positiveCount = row.count;
        } else if (row.action === "feedback.negative") {
          negativeCount = row.count;
        }
      }

      let correctionsCount = 0;
      const correctionsByType: Record<string, number> = {};

      for (const row of correctionRows) {
        correctionsCount += row.count;
        correctionsByType[row.correctionType] = row.count;
      }

      const totalFeedback = positiveCount + negativeCount;
      const satisfactionRate =
        totalFeedback > 0 ? positiveCount / totalFeedback : null;

      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          positiveCount,
          negativeCount,
          correctionsCount,
        },
        "Fetched feedback stats"
      );

      return {
        projectId: input.projectId,
        positiveCount,
        negativeCount,
        correctionsCount,
        correctionsByType,
        satisfactionRate,
        totalFeedback,
      };
    }),
});
