import type { Database } from "@prometheus/db";
import {
  projects,
  sessions,
  syncedIssues,
  syncedPullRequests,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import {
  assignToAgentSchema,
  getSyncStatusSchema,
  listSyncedIssuesSchema,
  listSyncedPRsSchema,
  syncIssuesSchema,
  syncPRsSchema,
  unlinkIssueSchema,
} from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, lt } from "drizzle-orm";
import {
  fetchProviderIssues,
  fetchProviderPRs,
} from "../lib/issue-sync-providers";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:issue-sync");

/**
 * Verify project belongs to org and return it.
 */
async function verifyProjectAccess(
  db: Database,
  projectId: string,
  orgId: string
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
  });

  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }

  return project;
}

export const issueSyncRouter = router({
  // ---------------------------------------------------------------------------
  // List synced issues for a project
  // ---------------------------------------------------------------------------
  listSyncedIssues: protectedProcedure
    .input(listSyncedIssuesSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const conditions = [eq(syncedIssues.projectId, input.projectId)];

      if (input.provider) {
        conditions.push(eq(syncedIssues.provider, input.provider));
      }
      if (input.status) {
        conditions.push(eq(syncedIssues.externalStatus, input.status));
      }
      if (input.assignedToAgent !== undefined) {
        conditions.push(
          eq(syncedIssues.assignedToAgent, input.assignedToAgent)
        );
      }
      if (input.cursor) {
        conditions.push(lt(syncedIssues.createdAt, new Date(input.cursor)));
      }

      const issues = await ctx.db.query.syncedIssues.findMany({
        where: and(...conditions),
        orderBy: desc(syncedIssues.createdAt),
        limit: input.limit,
      });

      const nextCursor =
        issues.length === input.limit
          ? issues.at(-1)?.createdAt?.toISOString()
          : null;

      return {
        items: issues.map((issue) => ({
          id: issue.id,
          projectId: issue.projectId,
          provider: issue.provider,
          externalId: issue.externalId,
          externalUrl: issue.externalUrl,
          title: issue.title,
          body: issue.body,
          externalStatus: issue.externalStatus,
          taskId: issue.taskId,
          sessionId: issue.sessionId,
          assignedToAgent: issue.assignedToAgent,
          lastSyncedAt: issue.lastSyncedAt?.toISOString() ?? null,
          externalUpdatedAt: issue.externalUpdatedAt?.toISOString() ?? null,
          createdAt: issue.createdAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  // ---------------------------------------------------------------------------
  // List synced PRs for a project
  // ---------------------------------------------------------------------------
  listSyncedPRs: protectedProcedure
    .input(listSyncedPRsSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const conditions = [eq(syncedPullRequests.projectId, input.projectId)];

      if (input.provider) {
        conditions.push(eq(syncedPullRequests.provider, input.provider));
      }
      if (input.ciStatus) {
        conditions.push(eq(syncedPullRequests.ciStatus, input.ciStatus));
      }
      if (input.reviewStatus) {
        conditions.push(
          eq(syncedPullRequests.reviewStatus, input.reviewStatus)
        );
      }
      if (input.cursor) {
        conditions.push(
          lt(syncedPullRequests.createdAt, new Date(input.cursor))
        );
      }

      const prs = await ctx.db.query.syncedPullRequests.findMany({
        where: and(...conditions),
        orderBy: desc(syncedPullRequests.createdAt),
        limit: input.limit,
      });

      const nextCursor =
        prs.length === input.limit
          ? prs.at(-1)?.createdAt?.toISOString()
          : null;

      return {
        items: prs.map((pr) => ({
          id: pr.id,
          projectId: pr.projectId,
          provider: pr.provider,
          externalId: pr.externalId,
          externalUrl: pr.externalUrl,
          title: pr.title,
          branch: pr.branch,
          baseBranch: pr.baseBranch,
          sessionId: pr.sessionId,
          ciStatus: pr.ciStatus,
          reviewStatus: pr.reviewStatus,
          lastSyncedAt: pr.lastSyncedAt?.toISOString() ?? null,
          externalUpdatedAt: pr.externalUpdatedAt?.toISOString() ?? null,
          createdAt: pr.createdAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  // ---------------------------------------------------------------------------
  // Trigger issue sync from provider
  // ---------------------------------------------------------------------------
  syncIssues: protectedProcedure
    .input(syncIssuesSchema)
    .mutation(async ({ input, ctx }) => {
      const project = await verifyProjectAccess(
        ctx.db,
        input.projectId,
        ctx.orgId
      );

      logger.info(
        { projectId: input.projectId, provider: input.provider },
        "Syncing issues from provider"
      );

      // Fetch issues from the provider via external API
      const externalIssues = await fetchProviderIssues(
        input.provider,
        project.repoUrl ?? "",
        ctx.db,
        ctx.orgId
      );

      let upsertedCount = 0;

      for (const ext of externalIssues) {
        const existing = await ctx.db.query.syncedIssues.findFirst({
          where: and(
            eq(syncedIssues.projectId, input.projectId),
            eq(syncedIssues.provider, input.provider),
            eq(syncedIssues.externalId, ext.externalId)
          ),
        });

        if (existing) {
          await ctx.db
            .update(syncedIssues)
            .set({
              title: ext.title,
              body: ext.body,
              externalStatus: ext.status,
              externalUrl: ext.url,
              externalUpdatedAt: ext.updatedAt ? new Date(ext.updatedAt) : null,
              lastSyncedAt: new Date(),
            })
            .where(eq(syncedIssues.id, existing.id));
        } else {
          await ctx.db.insert(syncedIssues).values({
            id: generateId("si"),
            projectId: input.projectId,
            orgId: ctx.orgId,
            provider: input.provider,
            externalId: ext.externalId,
            externalUrl: ext.url,
            title: ext.title,
            body: ext.body,
            externalStatus: ext.status,
            externalUpdatedAt: ext.updatedAt ? new Date(ext.updatedAt) : null,
            lastSyncedAt: new Date(),
          });
        }
        upsertedCount++;
      }

      logger.info(
        {
          projectId: input.projectId,
          provider: input.provider,
          count: upsertedCount,
        },
        "Issues synced"
      );

      return { synced: upsertedCount };
    }),

  // ---------------------------------------------------------------------------
  // Trigger PR sync from provider
  // ---------------------------------------------------------------------------
  syncPRs: protectedProcedure
    .input(syncPRsSchema)
    .mutation(async ({ input, ctx }) => {
      const project = await verifyProjectAccess(
        ctx.db,
        input.projectId,
        ctx.orgId
      );

      logger.info(
        { projectId: input.projectId, provider: input.provider },
        "Syncing PRs from provider"
      );

      const externalPRs = await fetchProviderPRs(
        input.provider,
        project.repoUrl ?? "",
        ctx.db,
        ctx.orgId
      );

      let upsertedCount = 0;

      for (const ext of externalPRs) {
        const existing = await ctx.db.query.syncedPullRequests.findFirst({
          where: and(
            eq(syncedPullRequests.projectId, input.projectId),
            eq(syncedPullRequests.provider, input.provider),
            eq(syncedPullRequests.externalId, ext.externalId)
          ),
        });

        if (existing) {
          await ctx.db
            .update(syncedPullRequests)
            .set({
              title: ext.title,
              branch: ext.branch,
              baseBranch: ext.baseBranch,
              externalUrl: ext.url,
              externalUpdatedAt: ext.updatedAt ? new Date(ext.updatedAt) : null,
              lastSyncedAt: new Date(),
            })
            .where(eq(syncedPullRequests.id, existing.id));
        } else {
          await ctx.db.insert(syncedPullRequests).values({
            id: generateId("spr"),
            projectId: input.projectId,
            orgId: ctx.orgId,
            provider: input.provider,
            externalId: ext.externalId,
            externalUrl: ext.url,
            title: ext.title,
            branch: ext.branch,
            baseBranch: ext.baseBranch,
            externalUpdatedAt: ext.updatedAt ? new Date(ext.updatedAt) : null,
            lastSyncedAt: new Date(),
          });
        }
        upsertedCount++;
      }

      logger.info(
        {
          projectId: input.projectId,
          provider: input.provider,
          count: upsertedCount,
        },
        "PRs synced"
      );

      return { synced: upsertedCount };
    }),

  // ---------------------------------------------------------------------------
  // Assign issue to agent for automated resolution
  // ---------------------------------------------------------------------------
  assignToAgent: protectedProcedure
    .input(assignToAgentSchema)
    .mutation(async ({ input, ctx }) => {
      const issue = await ctx.db.query.syncedIssues.findFirst({
        where: eq(syncedIssues.id, input.issueId),
      });

      if (!issue || issue.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Issue not found",
        });
      }

      if (issue.assignedToAgent) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Issue is already assigned to an agent",
        });
      }

      // Create a session and task for agent resolution
      const sessionId = generateId("ses");
      const taskId = generateId("task");

      await ctx.db.insert(sessions).values({
        id: sessionId,
        projectId: issue.projectId,
        userId: ctx.auth.userId,
        status: "active",
        mode: "task",
      });

      await ctx.db.insert(tasks).values({
        id: taskId,
        sessionId,
        projectId: issue.projectId,
        orgId: ctx.orgId,
        title: `Resolve: ${issue.title ?? issue.externalId}`,
        description: issue.body ?? `Resolve external issue ${issue.externalId}`,
        status: "queued",
        priority: 50,
      });

      // Link issue to session and task
      await ctx.db
        .update(syncedIssues)
        .set({
          assignedToAgent: true,
          taskId,
          sessionId,
        })
        .where(eq(syncedIssues.id, input.issueId));

      // Enqueue agent task
      await agentTaskQueue.add(`issue-resolve-${issue.externalId}`, {
        taskId,
        sessionId,
        projectId: issue.projectId,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        title: `Resolve: ${issue.title ?? issue.externalId}`,
        description: issue.body ?? "",
        mode: "task",
        agentRole: null,
        creditsReserved: 100,
        planTier: "pro",
      });

      logger.info(
        { issueId: input.issueId, taskId, sessionId },
        "Issue assigned to agent for resolution"
      );

      return { taskId, sessionId };
    }),

  // ---------------------------------------------------------------------------
  // Unlink issue from agent
  // ---------------------------------------------------------------------------
  unlinkIssue: protectedProcedure
    .input(unlinkIssueSchema)
    .mutation(async ({ input, ctx }) => {
      const issue = await ctx.db.query.syncedIssues.findFirst({
        where: eq(syncedIssues.id, input.issueId),
      });

      if (!issue || issue.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Issue not found",
        });
      }

      await ctx.db
        .update(syncedIssues)
        .set({
          assignedToAgent: false,
          taskId: null,
          sessionId: null,
        })
        .where(eq(syncedIssues.id, input.issueId));

      logger.info({ issueId: input.issueId }, "Issue unlinked from agent");

      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // Get sync status for a project
  // ---------------------------------------------------------------------------
  getSyncStatus: protectedProcedure
    .input(getSyncStatusSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const [issueCountResult] = await ctx.db
        .select({ value: count() })
        .from(syncedIssues)
        .where(eq(syncedIssues.projectId, input.projectId));

      const [prCountResult] = await ctx.db
        .select({ value: count() })
        .from(syncedPullRequests)
        .where(eq(syncedPullRequests.projectId, input.projectId));

      const lastSyncedIssue = await ctx.db.query.syncedIssues.findFirst({
        where: eq(syncedIssues.projectId, input.projectId),
        orderBy: desc(syncedIssues.lastSyncedAt),
        columns: { lastSyncedAt: true },
      });

      const lastSyncedPR = await ctx.db.query.syncedPullRequests.findFirst({
        where: eq(syncedPullRequests.projectId, input.projectId),
        orderBy: desc(syncedPullRequests.lastSyncedAt),
        columns: { lastSyncedAt: true },
      });

      const issueLastSync = lastSyncedIssue?.lastSyncedAt;
      const prLastSync = lastSyncedPR?.lastSyncedAt;

      let lastSyncedAt: string | null = null;
      if (issueLastSync && prLastSync) {
        lastSyncedAt = (
          issueLastSync > prLastSync ? issueLastSync : prLastSync
        ).toISOString();
      } else if (issueLastSync) {
        lastSyncedAt = issueLastSync.toISOString();
      } else if (prLastSync) {
        lastSyncedAt = prLastSync.toISOString();
      }

      return {
        issueCount: issueCountResult?.value ?? 0,
        prCount: prCountResult?.value ?? 0,
        lastSyncedAt,
      };
    }),
});
