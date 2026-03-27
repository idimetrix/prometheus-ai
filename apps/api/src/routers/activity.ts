import { auditLogs, sessionEvents, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:activity");

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const activityTypeSchema = z.enum([
  "task_started",
  "task_completed",
  "task_failed",
  "session_started",
  "session_completed",
  "session_cancelled",
  "pr_created",
  "pr_merged",
  "pr_closed",
  "deployment_started",
  "deployment_succeeded",
  "deployment_failed",
  "settings_changed",
  "member_added",
  "member_removed",
  "secret_updated",
  "branch_created",
  "branch_deleted",
]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const activityRouter = router({
  /**
   * Get chronological activity for a specific project.
   *
   * Supports cursor-based pagination and optional type filtering.
   * Queries audit_logs, tasks, and session_events tables.
   */
  getProjectTimeline: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional(),
        types: z.array(activityTypeSchema).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          limit: input.limit,
          cursor: input.cursor ?? null,
        },
        "Fetching project timeline"
      );

      // Build audit log conditions
      const auditConditions = [
        eq(auditLogs.orgId, ctx.orgId),
        eq(auditLogs.resourceId, input.projectId),
      ];

      if (input.cursor) {
        auditConditions.push(lt(auditLogs.createdAt, new Date(input.cursor)));
      }

      if (input.types && input.types.length > 0) {
        auditConditions.push(
          sql`${auditLogs.action} IN (${sql.join(
            input.types.map((t) => sql`${t}`),
            sql`, `
          )})`
        );
      }

      // Build task conditions
      const taskConditions = [
        eq(tasks.orgId, ctx.orgId),
        eq(tasks.projectId, input.projectId),
      ];

      if (input.cursor) {
        taskConditions.push(lt(tasks.createdAt, new Date(input.cursor)));
      }

      // Query audit logs and tasks in parallel
      const [auditRows, taskRows] = await Promise.all([
        ctx.db
          .select({
            id: auditLogs.id,
            type: auditLogs.action,
            userId: auditLogs.userId,
            title: auditLogs.resource,
            description: sql<string>`COALESCE(${auditLogs.details}->>'description', ${auditLogs.action})`,
            metadata: auditLogs.details,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .where(and(...auditConditions))
          .orderBy(desc(auditLogs.createdAt))
          .limit(input.limit + 1),

        ctx.db
          .select({
            id: tasks.id,
            type: sql<string>`CASE
              WHEN ${tasks.status} = 'completed' THEN 'task_completed'
              WHEN ${tasks.status} = 'failed' THEN 'task_failed'
              ELSE 'task_started'
            END`,
            userId: tasks.assignedUserId,
            title: tasks.title,
            description: tasks.description,
            metadata: sql<
              Record<string, unknown>
            >`jsonb_build_object('status', ${tasks.status}, 'sessionId', ${tasks.sessionId})`,
            createdAt: tasks.createdAt,
          })
          .from(tasks)
          .where(and(...taskConditions))
          .orderBy(desc(tasks.createdAt))
          .limit(input.limit + 1),
      ]);

      // Merge, sort, and paginate
      const merged = [...auditRows, ...taskRows].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const hasMore = merged.length > input.limit;
      const items = hasMore ? merged.slice(0, input.limit) : merged;
      const nextCursor = hasMore
        ? (items.at(-1)?.createdAt?.toISOString() ?? null)
        : null;

      // Get total count
      const [totalResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.orgId, ctx.orgId),
            eq(auditLogs.resourceId, input.projectId)
          )
        );

      return {
        events: items.map((e) => ({
          id: e.id,
          type: e.type,
          userId: e.userId,
          displayName: e.userId ?? "system",
          title: e.title ?? "",
          description: (e.description as string) ?? "",
          metadata: (e.metadata as Record<string, unknown>) ?? {},
          createdAt: e.createdAt.toISOString(),
        })),
        nextCursor,
        total: totalResult?.count ?? 0,
      };
    }),

  /**
   * Get organization-wide activity feed.
   *
   * Aggregates events across all projects in the org. Supports cursor-based
   * pagination and optional type filtering.
   */
  getOrgTimeline: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(25),
          cursor: z.string().optional(),
          types: z.array(activityTypeSchema).optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 25;
      const cursor = input?.cursor ?? null;

      logger.info({ orgId: ctx.orgId, limit, cursor }, "Fetching org timeline");

      const conditions = [eq(auditLogs.orgId, ctx.orgId)];

      if (cursor) {
        conditions.push(lt(auditLogs.createdAt, new Date(cursor)));
      }

      if (input?.types && input.types.length > 0) {
        conditions.push(
          sql`${auditLogs.action} IN (${sql.join(
            input.types.map((t) => sql`${t}`),
            sql`, `
          )})`
        );
      }

      const results = await ctx.db
        .select({
          id: auditLogs.id,
          type: auditLogs.action,
          resourceId: auditLogs.resourceId,
          userId: auditLogs.userId,
          title: auditLogs.resource,
          description: sql<string>`COALESCE(${auditLogs.details}->>'description', ${auditLogs.action})`,
          metadata: auditLogs.details,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit + 1);

      const hasMore = results.length > limit;
      const items = hasMore ? results.slice(0, limit) : results;
      const nextCursor = hasMore
        ? (items.at(-1)?.createdAt?.toISOString() ?? null)
        : null;

      const [totalResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.orgId, ctx.orgId));

      return {
        events: items.map((e) => ({
          id: e.id,
          type: e.type,
          projectId: e.resourceId,
          sessionId: (e.metadata as Record<string, unknown>)?.sessionId ?? null,
          userId: e.userId,
          displayName: e.userId ?? "system",
          title: e.title ?? "",
          description: (e.description as string) ?? "",
          metadata: (e.metadata as Record<string, unknown>) ?? {},
          createdAt: e.createdAt.toISOString(),
        })),
        nextCursor,
        total: totalResult?.count ?? 0,
      };
    }),

  /**
   * Get all events for a specific session, ordered chronologically.
   */
  getSessionTimeline: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      logger.info(
        {
          orgId: ctx.orgId,
          sessionId: input.sessionId,
          limit: input.limit,
        },
        "Fetching session timeline"
      );

      const conditions = [eq(sessionEvents.sessionId, input.sessionId)];

      if (input.cursor) {
        conditions.push(lt(sessionEvents.timestamp, new Date(input.cursor)));
      }

      const results = await ctx.db
        .select({
          id: sessionEvents.id,
          type: sessionEvents.type,
          data: sessionEvents.data,
          agentRole: sessionEvents.agentRole,
          createdAt: sessionEvents.timestamp,
        })
        .from(sessionEvents)
        .where(and(...conditions))
        .orderBy(desc(sessionEvents.timestamp))
        .limit(input.limit + 1);

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;
      const nextCursor = hasMore
        ? (items.at(-1)?.createdAt?.toISOString() ?? null)
        : null;

      const [totalResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, input.sessionId));

      return {
        events: items.map((e) => ({
          id: e.id,
          type: e.type,
          userId: e.agentRole,
          displayName: e.agentRole ?? "agent",
          title: e.type,
          description: e.type,
          metadata: (e.data as Record<string, unknown>) ?? {},
          createdAt: e.createdAt.toISOString(),
        })),
        nextCursor,
        total: totalResult?.count ?? 0,
      };
    }),
});
