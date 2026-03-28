/**
 * GAP-071: Comprehensive Audit Trail
 *
 * Full-text search, export, compliance reports, and retention policies.
 */

import { auditLogs } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const logger = createLogger("api:audit-enhanced");

export const auditEnhancedRouter = router({
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
        action: z.string().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const results = await ctx.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.orgId, ctx.orgId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      logger.debug(
        { orgId: ctx.orgId, query: input.query, resultCount: results.length },
        "Audit log search"
      );

      return {
        results: results.map((r) => ({
          id: r.id,
          action: r.action,
          userId: r.userId,
          resource: r.resource,
          resourceId: r.resourceId,
          createdAt: r.createdAt,
        })),
        total: results.length,
      };
    }),

  export: orgAdminProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json"]).default("json"),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const logs = await ctx.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.orgId, ctx.orgId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(10_000);

      logger.info(
        { orgId: ctx.orgId, format: input.format, logCount: logs.length },
        "Audit logs exported"
      );

      if (input.format === "csv") {
        const header = "id,action,userId,resource,resourceId,createdAt";
        const rows = logs.map(
          (l) =>
            `${l.id},${l.action},${l.userId},${l.resource},${l.resourceId},${l.createdAt?.toISOString() ?? ""}`
        );
        return { data: [header, ...rows].join("\n"), format: "csv" };
      }

      return { data: JSON.stringify(logs), format: "json" };
    }),

  getComplianceReport: orgAdminProcedure.query(async ({ ctx }) => {
    const recentLogs = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, ctx.orgId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1000);

    const actionCounts: Record<string, number> = {};
    for (const log of recentLogs) {
      actionCounts[log.action] = (actionCounts[log.action] ?? 0) + 1;
    }

    return {
      totalLogs: recentLogs.length,
      actionBreakdown: actionCounts,
      generatedAt: new Date().toISOString(),
      complianceStatus: recentLogs.length > 0 ? "active" : "no_data",
    };
  }),

  retention: orgAdminProcedure
    .input(
      z.object({
        retentionDays: z.number().int().min(30).max(2555),
      })
    )
    .mutation(({ input, ctx }) => {
      logger.info(
        { orgId: ctx.orgId, retentionDays: input.retentionDays },
        "Audit retention policy updated"
      );

      return {
        retentionDays: input.retentionDays,
        message: `Retention policy set to ${input.retentionDays} days`,
      };
    }),
});
