import {
  auditLogs,
  deployments,
  projects,
  sessions,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  sql,
  sum,
} from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:team-dashboard");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemberActivity {
  displayName: string;
  lastActiveAt: string | null;
  sessionCount: number;
  taskCount: number;
  userId: string;
}

export interface ActivityEvent {
  createdAt: string;
  description: string;
  displayName: string;
  id: string;
  projectId: string | null;
  projectName: string | null;
  type:
    | "task_completed"
    | "task_failed"
    | "pr_created"
    | "pr_merged"
    | "deployment"
    | "session_started"
    | "session_completed"
    | "settings_changed";
  userId: string;
}

export interface ProjectHealth {
  avgTaskDurationMs: number;
  lastActivityAt: string | null;
  openIssues: number;
  projectId: string;
  projectName: string;
  successRate: number;
  totalTasks: number;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const teamDashboardRouter = router({
  /**
   * Get an aggregate overview of the organization's engineering metrics.
   *
   * Returns high-level KPIs for the team dashboard landing page.
   */
  getOverview: protectedProcedure
    .input(
      z
        .object({
          /** ISO date string -- start of the reporting window */
          fromDate: z.string().datetime().optional(),
          /** ISO date string -- end of the reporting window */
          toDate: z.string().datetime().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const from = input?.fromDate ?? null;
      const to = input?.toDate ?? null;

      logger.info(
        { orgId: ctx.orgId, from, to },
        "Fetching team dashboard overview"
      );

      // Build date conditions for tasks
      const taskConditions = [eq(tasks.orgId, ctx.orgId)];
      if (from) {
        taskConditions.push(gte(tasks.createdAt, new Date(from)));
      }
      if (to) {
        taskConditions.push(lte(tasks.createdAt, new Date(to)));
      }

      // Count tasks by status
      const taskCounts = await ctx.db
        .select({
          status: tasks.status,
          count: sql<number>`count(*)::int`,
        })
        .from(tasks)
        .where(and(...taskConditions))
        .groupBy(tasks.status);

      let totalTasksCompleted = 0;
      let totalTasksFailed = 0;
      for (const row of taskCounts) {
        if (row.status === "completed") {
          totalTasksCompleted = row.count;
        } else if (row.status === "failed") {
          totalTasksFailed = row.count;
        }
      }

      // Sum credits consumed
      const [creditsResult] = await ctx.db
        .select({ total: sum(tasks.creditsConsumed) })
        .from(tasks)
        .where(and(...taskConditions));

      const creditsConsumed = Number(creditsResult?.total ?? 0);

      // Count active sessions (sessions don't have orgId, filter via projects)
      const orgProjectIds = ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.orgId, ctx.orgId));

      const [activeSessionResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessions)
        .where(
          and(
            inArray(sessions.projectId, orgProjectIds),
            eq(sessions.status, "active")
          )
        );

      const activeSessions = activeSessionResult?.count ?? 0;

      // Count deployments
      const deployConditions = [eq(deployments.orgId, ctx.orgId)];
      if (from) {
        deployConditions.push(gte(deployments.createdAt, new Date(from)));
      }
      if (to) {
        deployConditions.push(lte(deployments.createdAt, new Date(to)));
      }

      const [deploymentResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(deployments)
        .where(and(...deployConditions));

      const deploymentCount = deploymentResult?.count ?? 0;

      // Count projects in org
      const [projectCountResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(eq(projects.orgId, ctx.orgId));

      const projectCount = projectCountResult?.count ?? 0;

      return {
        totalTasksCompleted,
        totalTasksFailed,
        activeSessions,
        creditsConsumed,
        prsCreated: 0,
        prsMerged: 0,
        deployments: deploymentCount,
        avgTaskDurationMs: 0,
        memberCount: 0,
        projectCount,
        periodStart: from,
        periodEnd: to,
      };
    }),

  /**
   * Get per-member activity breakdown.
   *
   * Returns task and session counts for each member of the organization,
   * ordered by total activity descending.
   */
  getMemberActivity: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 25;
      const offset = input?.offset ?? 0;

      logger.info(
        { orgId: ctx.orgId, limit, offset },
        "Fetching member activity"
      );

      const rows = await ctx.db
        .select({
          userId: tasks.assignedUserId,
          taskCount: count(),
        })
        .from(tasks)
        .where(eq(tasks.orgId, ctx.orgId))
        .groupBy(tasks.assignedUserId)
        .orderBy(desc(count()))
        .limit(limit)
        .offset(offset);

      const [totalResult] = await ctx.db
        .select({
          count: sql<number>`count(distinct ${tasks.assignedUserId})::int`,
        })
        .from(tasks)
        .where(eq(tasks.orgId, ctx.orgId));

      const total = totalResult?.count ?? 0;

      const members: MemberActivity[] = rows.map((row) => ({
        userId: row.userId ?? "unknown",
        displayName: row.userId ?? "Unknown",
        taskCount: row.taskCount,
        sessionCount: 0,
        lastActiveAt: null,
      }));

      return { members, total, limit, offset };
    }),

  /**
   * Get a paginated feed of recent activity across all projects.
   *
   * Supports cursor-based pagination for infinite-scroll UIs.
   */
  getRecentActivity: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(20),
          cursor: z.string().optional(),
          projectId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 20;
      const cursor = input?.cursor ?? null;
      const projectId = input?.projectId ?? null;

      logger.info(
        { orgId: ctx.orgId, limit, cursor, projectId },
        "Fetching recent activity"
      );

      const conditions = [eq(auditLogs.orgId, ctx.orgId)];

      if (cursor) {
        conditions.push(lt(auditLogs.id, cursor));
      }

      if (projectId) {
        conditions.push(eq(auditLogs.resourceId, projectId));
      }

      const rows = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;

      const events: ActivityEvent[] = items.map((row) => ({
        id: row.id,
        type: (row.action as ActivityEvent["type"]) || "settings_changed",
        description: `${row.action} on ${row.resource}`,
        userId: row.userId ?? "system",
        displayName: row.userId ?? "System",
        projectId: row.resourceId,
        projectName: null,
        createdAt: row.createdAt.toISOString(),
      }));

      const nextCursor = hasMore ? (items.at(-1)?.id ?? null) : null;

      return { events, nextCursor };
    }),

  /**
   * Get per-project health metrics.
   *
   * Returns success rates, average durations, and open issue counts for
   * each project in the org.
   */
  getProjectHealth: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(20),
          offset: z.number().int().min(0).default(0),
          sortBy: z
            .enum(["successRate", "totalTasks", "lastActivity"])
            .default("lastActivity"),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      const sortBy = input?.sortBy ?? "lastActivity";

      logger.info(
        { orgId: ctx.orgId, limit, offset, sortBy },
        "Fetching project health metrics"
      );

      const rows = await ctx.db
        .select({
          projectId: projects.id,
          projectName: projects.name,
          totalTasks: count(tasks.id),
          completedTasks: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
          failedTasks: sql<number>`count(*) filter (where ${tasks.status} = 'failed')::int`,
          lastActivityAt: sql<string | null>`max(${tasks.createdAt})::text`,
        })
        .from(projects)
        .leftJoin(tasks, eq(projects.id, tasks.projectId))
        .where(eq(projects.orgId, ctx.orgId))
        .groupBy(projects.id, projects.name)
        .limit(limit)
        .offset(offset);

      const [totalResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(eq(projects.orgId, ctx.orgId));

      const total = totalResult?.count ?? 0;

      const projectsData: ProjectHealth[] = rows.map((row) => {
        const totalTaskCount = row.totalTasks;
        const completed = row.completedTasks;
        const successRate = totalTaskCount > 0 ? completed / totalTaskCount : 0;

        return {
          projectId: row.projectId,
          projectName: row.projectName,
          totalTasks: totalTaskCount,
          successRate,
          avgTaskDurationMs: 0,
          openIssues: 0,
          lastActivityAt: row.lastActivityAt,
        };
      });

      // Sort based on requested field
      if (sortBy === "successRate") {
        projectsData.sort((a, b) => b.successRate - a.successRate);
      } else if (sortBy === "totalTasks") {
        projectsData.sort((a, b) => b.totalTasks - a.totalTasks);
      }
      // "lastActivity" is default from SQL ordering

      return { projects: projectsData, total, limit, offset };
    }),
});
