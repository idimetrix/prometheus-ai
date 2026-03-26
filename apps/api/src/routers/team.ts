import { projects, sessions, teamAgentQuotas } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import {
  getTeamQuotaSchema,
  listTeamQuotasSchema,
  setTeamQuotaSchema,
} from "@prometheus/validators";
import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const logger = createLogger("team-router");

export const teamRouter = router({
  quotas: router({
    list: orgAdminProcedure
      .input(listTeamQuotasSchema)
      .query(async ({ input, ctx }) => {
        const conditions = [eq(teamAgentQuotas.orgId, ctx.orgId)];

        if (input.cursor) {
          const cursorQuota = await ctx.db.query.teamAgentQuotas.findFirst({
            where: eq(teamAgentQuotas.id, input.cursor),
            columns: { createdAt: true },
          });
          if (cursorQuota) {
            conditions.push(
              lt(teamAgentQuotas.createdAt, cursorQuota.createdAt)
            );
          }
        }

        const results = await ctx.db.query.teamAgentQuotas.findMany({
          where: and(...conditions),
          orderBy: [desc(teamAgentQuotas.createdAt)],
          limit: input.limit + 1,
        });

        const hasMore = results.length > input.limit;
        const items = hasMore ? results.slice(0, input.limit) : results;

        return {
          quotas: items,
          nextCursor: hasMore ? items.at(-1)?.id : null,
        };
      }),

    set: orgAdminProcedure
      .input(setTeamQuotaSchema)
      .mutation(async ({ input, ctx }) => {
        const existing = await ctx.db.query.teamAgentQuotas.findFirst({
          where: and(
            eq(teamAgentQuotas.orgId, ctx.orgId),
            eq(teamAgentQuotas.userId, input.userId)
          ),
        });

        if (existing) {
          const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
          };
          if (input.maxConcurrentSessions !== undefined) {
            updateData.maxConcurrentSessions = input.maxConcurrentSessions;
          }
          if (input.maxDailyCredits !== undefined) {
            updateData.maxDailyCredits = input.maxDailyCredits;
          }

          const [updated] = await ctx.db
            .update(teamAgentQuotas)
            .set(updateData)
            .where(eq(teamAgentQuotas.id, existing.id))
            .returning();

          logger.info(
            { userId: input.userId, orgId: ctx.orgId },
            "Team quota updated"
          );
          return updated as NonNullable<typeof updated>;
        }

        const id = generateId("taq");
        const [created] = await ctx.db
          .insert(teamAgentQuotas)
          .values({
            id,
            orgId: ctx.orgId,
            userId: input.userId,
            maxConcurrentSessions: input.maxConcurrentSessions ?? 2,
            maxDailyCredits: input.maxDailyCredits ?? 100,
          })
          .returning();

        logger.info(
          { userId: input.userId, orgId: ctx.orgId },
          "Team quota created"
        );
        return created as NonNullable<typeof created>;
      }),

    get: protectedProcedure
      .input(getTeamQuotaSchema)
      .query(async ({ input, ctx }) => {
        const userId = input.userId ?? ctx.auth.userId;

        const quota = await ctx.db.query.teamAgentQuotas.findFirst({
          where: and(
            eq(teamAgentQuotas.orgId, ctx.orgId),
            eq(teamAgentQuotas.userId, userId)
          ),
        });

        if (!quota) {
          return {
            userId,
            maxConcurrentSessions: 2,
            maxDailyCredits: 100,
            currentActiveSessions: 0,
            creditsUsedToday: 0,
            lastResetAt: null,
          };
        }

        return quota;
      }),
  }),

  utilization: orgAdminProcedure.query(async ({ ctx }) => {
    const quotas = await ctx.db.query.teamAgentQuotas.findMany({
      where: eq(teamAgentQuotas.orgId, ctx.orgId),
    });

    // Get active sessions count through project membership
    const orgProjectIds = ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.orgId, ctx.orgId));

    const [activeSessionCount] = await ctx.db
      .select({ count: count() })
      .from(sessions)
      .where(
        and(
          inArray(sessions.projectId, orgProjectIds),
          eq(sessions.status, "active")
        )
      );

    const totalCreditsUsed = quotas.reduce(
      (sum, q) => sum + q.creditsUsedToday,
      0
    );
    const totalCreditsAvailable = quotas.reduce(
      (sum, q) => sum + q.maxDailyCredits,
      0
    );

    return {
      totalActiveSessions: Number(activeSessionCount?.count ?? 0),
      totalCreditsUsed,
      totalCreditsAvailable,
      members: quotas.map((q) => ({
        userId: q.userId,
        maxConcurrentSessions: q.maxConcurrentSessions,
        maxDailyCredits: q.maxDailyCredits,
        currentActiveSessions: q.currentActiveSessions,
        creditsUsedToday: q.creditsUsedToday,
      })),
    };
  }),
});
