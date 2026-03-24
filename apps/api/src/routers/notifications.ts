import { auditLogs } from "@prometheus/db";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        unreadOnly: z.boolean().default(false),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [eq(auditLogs.orgId, ctx.orgId)];

      if (input.unreadOnly) {
        // For now, use a time-based "unread" heuristic — items from last 24h
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        conditions.push(gte(auditLogs.createdAt, oneDayAgo));
      }

      if (input.cursor) {
        conditions.push(lt(auditLogs.id, input.cursor));
      }

      const results = await ctx.db.query.auditLogs.findMany({
        where: and(...conditions),
        orderBy: [desc(auditLogs.createdAt)],
        limit: input.limit + 1,
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, -1) : results;

      return {
        notifications: items.map((log) => ({
          id: log.id,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          details: log.details,
          createdAt: log.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.orgId, ctx.orgId), gte(auditLogs.createdAt, oneDayAgo))
      );

    return { count: result[0]?.count ?? 0 };
  }),
});
