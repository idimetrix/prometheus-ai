/**
 * Enterprise Admin Dashboard router (GAP-071).
 *
 * Provides org-admin endpoints for managing users, projects, usage,
 * and platform-wide configuration.  All procedures require the
 * `orgAdminProcedure` guard (admin or owner role).
 */

import {
  agents,
  apiKeys,
  organizations,
  orgMembers,
  projects,
  sessions,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { orgAdminProcedure, router } from "../trpc";

const logger = createLogger("admin-router");

export const adminRouter = router({
  // ── Organisation overview ───────────────────────────────────────
  overview: orgAdminProcedure.query(async ({ ctx }) => {
    const [projectCount] = await ctx.db
      .select({ value: count() })
      .from(projects)
      .where(eq(projects.orgId, ctx.orgId));

    const [memberCount] = await ctx.db
      .select({ value: count() })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, ctx.orgId));

    const [taskCount] = await ctx.db
      .select({ value: count() })
      .from(tasks)
      .where(eq(tasks.orgId, ctx.orgId));

    logger.debug({ orgId: ctx.orgId }, "Admin overview queried");

    return {
      projects: Number(projectCount?.value ?? 0),
      members: Number(memberCount?.value ?? 0),
      tasks: Number(taskCount?.value ?? 0),
    };
  }),

  // ── List organisation members ───────────────────────────────────
  listMembers: orgAdminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          id: orgMembers.id,
          userId: orgMembers.userId,
          role: orgMembers.role,
          invitedAt: orgMembers.invitedAt,
          joinedAt: orgMembers.joinedAt,
        })
        .from(orgMembers)
        .where(eq(orgMembers.orgId, ctx.orgId))
        .orderBy(desc(orgMembers.invitedAt))
        .limit(input.limit)
        .offset(input.offset);

      const [total] = await ctx.db
        .select({ value: count() })
        .from(orgMembers)
        .where(eq(orgMembers.orgId, ctx.orgId));

      return { members: rows, total: Number(total?.value ?? 0) };
    }),

  // ── Usage summary (last N days) ─────────────────────────────────
  usageSummary: orgAdminProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(365).default(30),
      })
    )
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const [taskStats] = await ctx.db
        .select({
          total: count(),
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed')`,
        })
        .from(tasks)
        .where(and(eq(tasks.orgId, ctx.orgId), gte(tasks.createdAt, since)));

      const [agentStats] = await ctx.db
        .select({
          total: count(),
          totalTokens: sql<number>`COALESCE(SUM(${agents.tokensIn} + ${agents.tokensOut}), 0)`,
        })
        .from(agents)
        .innerJoin(sessions, eq(agents.sessionId, sessions.id))
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(
          and(eq(projects.orgId, ctx.orgId), gte(agents.startedAt, since))
        );

      return {
        period: { days: input.days, since: since.toISOString() },
        tasks: {
          total: Number(taskStats?.total ?? 0),
          completed: Number(taskStats?.completed ?? 0),
          failed: Number(taskStats?.failed ?? 0),
        },
        agents: {
          total: Number(agentStats?.total ?? 0),
          totalTokens: Number(agentStats?.totalTokens ?? 0),
        },
      };
    }),

  // ── List API keys ───────────────────────────────────────────────
  listApiKeys: orgAdminProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        lastUsed: apiKeys.lastUsed,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.orgId, ctx.orgId))
      .orderBy(desc(apiKeys.createdAt));

    return { keys };
  }),

  // ── List projects ──────────────────────────────────────────────
  listProjects: orgAdminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          id: projects.id,
          name: projects.name,
          repoUrl: projects.repoUrl,
          createdAt: projects.createdAt,
        })
        .from(projects)
        .where(eq(projects.orgId, ctx.orgId))
        .orderBy(desc(projects.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [total] = await ctx.db
        .select({ value: count() })
        .from(projects)
        .where(eq(projects.orgId, ctx.orgId));

      return { projects: rows, total: Number(total?.value ?? 0) };
    }),

  // ── Org settings ───────────────────────────────────────────────
  getSettings: orgAdminProcedure.query(async ({ ctx }) => {
    const [org] = await ctx.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);

    if (!org) {
      return { settings: null };
    }

    return {
      settings: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt,
      },
    };
  }),
});
