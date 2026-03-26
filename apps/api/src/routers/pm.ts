/**
 * AI-powered project management router.
 *
 * Provides automated standup generation, blocker detection,
 * timeline prediction, and priority suggestions based on
 * task and session data.
 */
import {
  agents,
  codeReviews,
  creditBalances,
  deployments,
  projects,
  tasks,
} from "@prometheus/db";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const pmRouter = router({
  // ---------------------------------------------------------------------------
  // Generate standup report from the last 24 hours of activity
  // ---------------------------------------------------------------------------
  generateStandup: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
        })
        .default({})
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const conditions = [
        eq(tasks.orgId, ctx.orgId),
        gte(tasks.createdAt, since),
      ];
      if (input.projectId) {
        conditions.push(eq(tasks.projectId, input.projectId));
      }

      const recentTasks = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          agentRole: tasks.agentRole,
          startedAt: tasks.startedAt,
          completedAt: tasks.completedAt,
        })
        .from(tasks)
        .where(and(...conditions))
        .orderBy(desc(tasks.createdAt));

      const completed = recentTasks.filter((t) => t.status === "completed");
      const inProgress = recentTasks.filter((t) => t.status === "running");
      const blocked = recentTasks.filter(
        (t) => t.status === "failed" || t.status === "cancelled"
      );
      const pending = recentTasks.filter((t) => t.status === "pending");

      return {
        period: {
          from: since.toISOString(),
          to: new Date().toISOString(),
        },
        completed: completed.map((t) => ({
          id: t.id,
          title: t.title,
          agentRole: t.agentRole,
        })),
        inProgress: inProgress.map((t) => ({
          id: t.id,
          title: t.title,
          agentRole: t.agentRole,
        })),
        blocked: blocked.map((t) => ({
          id: t.id,
          title: t.title,
          agentRole: t.agentRole,
          status: t.status,
        })),
        nextSteps: pending.slice(0, 5).map((t) => ({
          id: t.id,
          title: t.title,
          agentRole: t.agentRole,
        })),
        summary: {
          totalTasks: recentTasks.length,
          completedCount: completed.length,
          inProgressCount: inProgress.length,
          blockedCount: blocked.length,
          pendingCount: pending.length,
        },
      };
    }),

  // ---------------------------------------------------------------------------
  // Detect tasks that have been stalled for more than 2 hours
  // ---------------------------------------------------------------------------
  detectBlockers: protectedProcedure
    .input(
      z
        .object({
          stallThresholdMinutes: z.number().min(1).default(120),
          projectId: z.string().optional(),
        })
        .default({ stallThresholdMinutes: 120 })
    )
    .query(async ({ ctx, input }) => {
      const threshold = new Date(
        Date.now() - input.stallThresholdMinutes * 60 * 1000
      );

      const conditions = [
        eq(tasks.orgId, ctx.orgId),
        eq(tasks.status, "running"),
        gte(tasks.startedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        sql`${tasks.startedAt} < ${threshold}`,
      ];
      if (input.projectId) {
        conditions.push(eq(tasks.projectId, input.projectId));
      }

      const stalledTasks = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          agentRole: tasks.agentRole,
          startedAt: tasks.startedAt,
          sessionId: tasks.sessionId,
        })
        .from(tasks)
        .where(and(...conditions))
        .orderBy(tasks.startedAt);

      // Check agent status for each stalled task
      const blockers: Array<{
        taskId: string;
        title: string;
        agentRole: string | null;
        stalledMinutes: number;
        reason: string;
        agentStatus: string;
      }> = [];
      for (const task of stalledTasks) {
        const stalledMinutes = task.startedAt
          ? Math.round((Date.now() - task.startedAt.getTime()) / 60_000)
          : 0;

        // Look for the agent working on this session
        const agentRows = await ctx.db
          .select({
            id: agents.id,
            status: agents.status,
            role: agents.role,
          })
          .from(agents)
          .where(eq(agents.sessionId, task.sessionId))
          .limit(1);

        const agent = agentRows[0];

        let reason = "Task running longer than expected";
        if (agent?.status === "error") {
          reason = "Agent encountered an error";
        } else if (!agent) {
          reason = "No agent assigned to session";
        }

        blockers.push({
          taskId: task.id,
          title: task.title,
          agentRole: task.agentRole,
          stalledMinutes,
          reason,
          agentStatus: agent?.status ?? "unknown",
        });
      }

      return {
        thresholdMinutes: input.stallThresholdMinutes,
        blockers,
        count: blockers.length,
      };
    }),

  // ---------------------------------------------------------------------------
  // Predict project completion timeline based on historical velocity
  // ---------------------------------------------------------------------------
  predictTimeline: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        lookbackDays: z.number().min(1).max(90).default(14),
      })
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(
        Date.now() - input.lookbackDays * 24 * 60 * 60 * 1000
      );

      // Count completed tasks in the lookback period
      const [velocityStats] = await ctx.db
        .select({
          completedCount: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, ctx.orgId),
            eq(tasks.projectId, input.projectId),
            gte(tasks.createdAt, since)
          )
        );

      const completedInPeriod = Number(velocityStats?.completedCount ?? 0);
      const tasksPerDay =
        input.lookbackDays > 0 ? completedInPeriod / input.lookbackDays : 0;

      // Count remaining (non-completed) tasks
      const [remainingStats] = await ctx.db
        .select({
          remaining: sql<number>`COUNT(*)`,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, ctx.orgId),
            eq(tasks.projectId, input.projectId),
            sql`${tasks.status} NOT IN ('completed', 'cancelled')`
          )
        );

      const remaining = Number(remainingStats?.remaining ?? 0);
      const estimatedDays =
        tasksPerDay > 0 ? Math.ceil(remaining / tasksPerDay) : null;
      const estimatedDate = estimatedDays
        ? new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000)
        : null;

      return {
        projectId: input.projectId,
        velocity: {
          tasksPerDay: Math.round(tasksPerDay * 100) / 100,
          lookbackDays: input.lookbackDays,
          completedInPeriod,
        },
        remaining,
        estimatedDaysToComplete: estimatedDays,
        estimatedCompletionDate: estimatedDate?.toISOString() ?? null,
      };
    }),

  // ---------------------------------------------------------------------------
  // Suggest task priority reordering based on dependencies and blockers
  // ---------------------------------------------------------------------------
  suggestPriorities: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get all pending/running tasks for the project
      const pendingTasks = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          agentRole: tasks.agentRole,
          createdAt: tasks.createdAt,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, ctx.orgId),
            eq(tasks.projectId, input.projectId),
            sql`${tasks.status} IN ('pending', 'running')`
          )
        )
        .orderBy(desc(tasks.priority), tasks.createdAt);

      // Simple priority scoring:
      // - Running tasks get highest priority (they're already in progress)
      // - Older pending tasks get a bump (avoid starvation)
      // - Tasks with agent roles that match failed tasks get deprioritized
      const [failedStats] = await ctx.db
        .select({
          failedRoles: sql<string>`string_agg(DISTINCT ${tasks.agentRole}, ',')`,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, ctx.orgId),
            eq(tasks.projectId, input.projectId),
            eq(tasks.status, "failed"),
            gte(tasks.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
          )
        );

      const recentlyFailedRoles = new Set(
        (failedStats?.failedRoles ?? "").split(",").filter(Boolean)
      );

      const suggestions = pendingTasks.map((task) => {
        let score = task.priority;
        let reason = "Current priority";

        // Running tasks: boost
        if (task.status === "running") {
          score += 20;
          reason = "Already in progress";
        }

        // Age bonus: tasks older than 1 day get +5, older than 3 days get +10
        const ageHours =
          (Date.now() - task.createdAt.getTime()) / (1000 * 60 * 60);
        if (ageHours > 72) {
          score += 10;
          reason = "Aging task (>3 days old)";
        } else if (ageHours > 24) {
          score += 5;
          reason = "Aging task (>1 day old)";
        }

        // Deprioritize agent roles that recently failed
        if (task.agentRole && recentlyFailedRoles.has(task.agentRole)) {
          score -= 10;
          reason = `Agent role "${task.agentRole}" has recent failures`;
        }

        return {
          taskId: task.id,
          title: task.title,
          currentPriority: task.priority,
          suggestedPriority: Math.max(0, Math.min(100, score)),
          reason,
          status: task.status,
          agentRole: task.agentRole,
        };
      });

      // Sort by suggested priority descending
      suggestions.sort((a, b) => b.suggestedPriority - a.suggestedPriority);

      return {
        projectId: input.projectId,
        suggestions,
        count: suggestions.length,
      };
    }),

  // ---------------------------------------------------------------------------
  // Comprehensive blocker detection: stalled tasks, failed deployments,
  // unreviewed PRs, and resource constraints
  // ---------------------------------------------------------------------------
  detectBlockersComprehensive: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          stallThresholdMinutes: z.number().min(1).default(120),
          prReviewThresholdHours: z.number().min(1).default(24),
        })
        .default({
          stallThresholdMinutes: 120,
          prReviewThresholdHours: 24,
        })
    )
    .query(async ({ ctx, input }) => {
      const blockerCategories: Array<{
        category: string;
        severity: "high" | "medium" | "low";
        items: Array<{
          id: string;
          description: string;
          metadata: Record<string, unknown>;
        }>;
      }> = [];

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // 1. Stalled tasks
      const stallThreshold = new Date(
        Date.now() - input.stallThresholdMinutes * 60 * 1000
      );
      const stalledConditions = [
        eq(tasks.orgId, ctx.orgId),
        eq(tasks.status, "running"),
        sql`${tasks.startedAt} < ${stallThreshold}`,
      ];
      if (input.projectId) {
        stalledConditions.push(eq(tasks.projectId, input.projectId));
      }

      const stalledTasks = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          agentRole: tasks.agentRole,
          startedAt: tasks.startedAt,
        })
        .from(tasks)
        .where(and(...stalledConditions))
        .limit(50);

      if (stalledTasks.length > 0) {
        blockerCategories.push({
          category: "stalled_tasks",
          severity: "high",
          items: stalledTasks.map((t) => ({
            id: t.id,
            description: `Task "${t.title}" stalled for ${
              t.startedAt
                ? Math.round((Date.now() - t.startedAt.getTime()) / 60_000)
                : 0
            } minutes`,
            metadata: {
              agentRole: t.agentRole,
              startedAt: t.startedAt?.toISOString(),
            },
          })),
        });
      }

      // 2. Failed deployments in the last 24h
      const failedDeployConditions = [
        eq(deployments.orgId, ctx.orgId),
        eq(deployments.status, "failed"),
        gte(deployments.createdAt, dayAgo),
      ];
      if (input.projectId) {
        failedDeployConditions.push(eq(deployments.projectId, input.projectId));
      }

      const failedDeploys = await ctx.db
        .select({
          id: deployments.id,
          projectId: deployments.projectId,
          provider: deployments.provider,
          errorMessage: deployments.errorMessage,
          createdAt: deployments.createdAt,
        })
        .from(deployments)
        .where(and(...failedDeployConditions))
        .limit(20);

      if (failedDeploys.length > 0) {
        blockerCategories.push({
          category: "failed_deployments",
          severity: "high",
          items: failedDeploys.map((d) => ({
            id: d.id,
            description: `Deployment ${d.id} failed on ${d.provider}${
              d.errorMessage ? `: ${d.errorMessage}` : ""
            }`,
            metadata: {
              projectId: d.projectId,
              provider: d.provider,
              createdAt: d.createdAt.toISOString(),
            },
          })),
        });
      }

      // 3. Unreviewed PRs (pending code reviews older than threshold)
      const prThreshold = new Date(
        Date.now() - input.prReviewThresholdHours * 60 * 60 * 1000
      );
      const unreviewedConditions = [
        eq(projects.orgId, ctx.orgId),
        eq(codeReviews.status, "pending"),
        lt(codeReviews.createdAt, prThreshold),
      ];
      if (input.projectId) {
        unreviewedConditions.push(eq(codeReviews.projectId, input.projectId));
      }

      const unreviewedPRs = await ctx.db
        .select({
          id: codeReviews.id,
          sessionId: codeReviews.sessionId,
          createdAt: codeReviews.createdAt,
        })
        .from(codeReviews)
        .innerJoin(projects, eq(codeReviews.projectId, projects.id))
        .where(and(...unreviewedConditions))
        .limit(20);

      if (unreviewedPRs.length > 0) {
        blockerCategories.push({
          category: "unreviewed_prs",
          severity: "medium",
          items: unreviewedPRs.map((pr) => ({
            id: pr.id,
            description: `Code review ${pr.id} pending for ${Math.round(
              (Date.now() - pr.createdAt.getTime()) / (60 * 60 * 1000)
            )} hours`,
            metadata: {
              sessionId: pr.sessionId,
              createdAt: pr.createdAt.toISOString(),
            },
          })),
        });
      }

      // 4. Resource constraints (low credit balance)
      const [balance] = await ctx.db
        .select({ balance: creditBalances.balance })
        .from(creditBalances)
        .where(eq(creditBalances.orgId, ctx.orgId))
        .limit(1);

      const currentBalance = Number(balance?.balance ?? 0);
      if (currentBalance <= 0) {
        blockerCategories.push({
          category: "resource_constraints",
          severity: "high",
          items: [
            {
              id: "credits-depleted",
              description: "Credit balance is depleted. Tasks cannot proceed.",
              metadata: { balance: currentBalance },
            },
          ],
        });
      } else if (currentBalance < 100) {
        blockerCategories.push({
          category: "resource_constraints",
          severity: "medium",
          items: [
            {
              id: "credits-low",
              description: `Credit balance is low (${currentBalance} remaining)`,
              metadata: { balance: currentBalance },
            },
          ],
        });
      }

      // 5. Recently failed tasks
      const failedTaskConditions = [
        eq(tasks.orgId, ctx.orgId),
        eq(tasks.status, "failed"),
        gte(tasks.createdAt, dayAgo),
      ];
      if (input.projectId) {
        failedTaskConditions.push(eq(tasks.projectId, input.projectId));
      }

      const failedTasks = await ctx.db
        .select({
          id: tasks.id,
          title: tasks.title,
          agentRole: tasks.agentRole,
        })
        .from(tasks)
        .where(and(...failedTaskConditions))
        .limit(20);

      if (failedTasks.length > 0) {
        blockerCategories.push({
          category: "failed_tasks",
          severity: "medium",
          items: failedTasks.map((t) => ({
            id: t.id,
            description: `Task "${t.title}" failed`,
            metadata: { agentRole: t.agentRole },
          })),
        });
      }

      const totalBlockers = blockerCategories.reduce(
        (sum, cat) => sum + cat.items.length,
        0
      );

      return {
        blockers: blockerCategories,
        totalCount: totalBlockers,
        hasHighSeverity: blockerCategories.some((c) => c.severity === "high"),
        analyzedAt: new Date().toISOString(),
      };
    }),
});
