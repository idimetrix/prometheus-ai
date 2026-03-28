import { auditLogs } from "@prometheus/db";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

/**
 * In-memory notification preferences store.
 * In production, these would live in a dedicated DB table.
 */
const preferencesStore = new Map<
  string,
  {
    email: boolean;
    slack: boolean;
    discord: boolean;
    inApp: boolean;
    events: Record<string, boolean>;
  }
>();

/** In-memory read-status tracking per user */
const readNotifications = new Map<string, Set<string>>();

const DEFAULT_PREFERENCES = {
  email: true,
  slack: false,
  discord: false,
  inApp: true,
  events: {
    taskCompleted: true,
    taskFailed: true,
    sessionStarted: false,
    sessionEnded: true,
    deploymentCompleted: true,
    prCreated: true,
    reviewRequested: true,
    billingAlert: true,
  },
};

export const notificationPreferencesRouter = router({
  /**
   * Get notification preferences for the current user.
   */
  getPreferences: protectedProcedure.query(({ ctx }) => {
    const key = `${ctx.orgId}:${ctx.auth.userId}`;
    const prefs = preferencesStore.get(key) ?? { ...DEFAULT_PREFERENCES };
    return prefs;
  }),

  /**
   * Update notification preferences.
   */
  updatePreferences: protectedProcedure
    .input(
      z.object({
        email: z.boolean().optional(),
        slack: z.boolean().optional(),
        discord: z.boolean().optional(),
        inApp: z.boolean().optional(),
        events: z.record(z.string(), z.boolean()).optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const key = `${ctx.orgId}:${ctx.auth.userId}`;
      const current = preferencesStore.get(key) ?? { ...DEFAULT_PREFERENCES };

      const updated = {
        email: input.email ?? current.email,
        slack: input.slack ?? current.slack,
        discord: input.discord ?? current.discord,
        inApp: input.inApp ?? current.inApp,
        events: input.events
          ? { ...current.events, ...input.events }
          : current.events,
      };

      preferencesStore.set(key, updated);
      return updated;
    }),

  /**
   * List recent notifications for the current user.
   */
  listRecent: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        unreadOnly: z.boolean().default(false),
      })
    )
    .query(async ({ input, ctx }) => {
      const userReadSet =
        readNotifications.get(ctx.auth.userId) ?? new Set<string>();

      const conditions = [eq(auditLogs.orgId, ctx.orgId)];

      if (input.cursor) {
        conditions.push(lt(auditLogs.id, input.cursor));
      }

      if (input.unreadOnly) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        conditions.push(gte(auditLogs.createdAt, oneDayAgo));
      }

      const results = await ctx.db.query.auditLogs.findMany({
        where: and(...conditions),
        orderBy: [desc(auditLogs.createdAt)],
        limit: input.limit + 1,
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        notifications: items.map((log) => ({
          id: log.id,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          details: log.details,
          createdAt: log.createdAt.toISOString(),
          read: userReadSet.has(log.id),
        })),
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  /**
   * Mark a notification as read.
   */
  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const userId = ctx.auth.userId;
      if (!readNotifications.has(userId)) {
        readNotifications.set(userId, new Set());
      }
      readNotifications.get(userId)?.add(input.notificationId);
      return { success: true };
    }),

  /**
   * Mark all notifications as read.
   */
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.auth.userId;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentLogs = await ctx.db.query.auditLogs.findMany({
      where: and(
        eq(auditLogs.orgId, ctx.orgId),
        gte(auditLogs.createdAt, oneDayAgo)
      ),
      columns: { id: true },
    });

    if (!readNotifications.has(userId)) {
      readNotifications.set(userId, new Set());
    }
    const readSet = readNotifications.get(userId) as Set<string>;
    for (const log of recentLogs) {
      readSet.add(log.id);
    }

    return { success: true, markedCount: recentLogs.length };
  }),
});
