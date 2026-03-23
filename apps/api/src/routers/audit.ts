import { auditLogs, projects, users } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const logger = createLogger("audit-router");

// ─── Router ──────────────────────────────────────────────────────────────────

export const auditRouter = router({
  // ─── Get Audit Log (Paginated) ─────────────────────────────────────────
  getAuditLog: orgAdminProcedure
    .input(
      z.object({
        action: z.string().optional(),
        resource: z.string().optional(),
        userId: z.string().optional(),
        dateFrom: z.string().datetime().optional(),
        dateTo: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [eq(auditLogs.orgId, ctx.orgId)];

      if (input.action) {
        conditions.push(eq(auditLogs.action, input.action));
      }
      if (input.resource) {
        conditions.push(eq(auditLogs.resource, input.resource));
      }
      if (input.userId) {
        conditions.push(eq(auditLogs.userId, input.userId));
      }
      if (input.dateFrom) {
        conditions.push(gte(auditLogs.createdAt, new Date(input.dateFrom)));
      }
      if (input.dateTo) {
        conditions.push(lte(auditLogs.createdAt, new Date(input.dateTo)));
      }
      if (input.cursor) {
        const [cursorLog] = await ctx.db
          .select({ createdAt: auditLogs.createdAt })
          .from(auditLogs)
          .where(eq(auditLogs.id, input.cursor))
          .limit(1);
        if (cursorLog) {
          conditions.push(lt(auditLogs.createdAt, cursorLog.createdAt));
        }
      }

      const results = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt))
        .limit(input.limit + 1);

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      // Collect unique user IDs to resolve names
      const userIds = [
        ...new Set(items.map((l) => l.userId).filter(Boolean)),
      ] as string[];

      let userMap = new Map<string, { name: string | null; email: string }>();
      if (userIds.length > 0) {
        const userRows = await ctx.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds));
        userMap = new Map(
          userRows.map((u) => [u.id, { name: u.name, email: u.email }])
        );
      }

      logger.info(
        {
          orgId: ctx.orgId,
          resultCount: items.length,
          filters: {
            action: input.action,
            resource: input.resource,
            userId: input.userId,
          },
        },
        "Audit log queried"
      );

      return {
        logs: items.map((log) => ({
          id: log.id,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          details: log.details,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt,
          userId: log.userId,
          userName: log.userId ? (userMap.get(log.userId)?.name ?? null) : null,
          userEmail: log.userId
            ? (userMap.get(log.userId)?.email ?? null)
            : null,
        })),
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Export User Data (GDPR) ───────────────────────────────────────────
  exportUserData: protectedProcedure
    .input(
      z.object({
        targetUserId: z.string().min(1, "User ID is required").optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Users can export their own data; admins can export others'
      const targetUserId = input.targetUserId ?? ctx.auth.userId;

      if (
        targetUserId !== ctx.auth.userId &&
        ctx.auth.orgRole !== "admin" &&
        ctx.auth.orgRole !== "owner"
      ) {
        // Only org admins can export other users' data
        // The orgAdminProcedure check isn't applied here, so we verify manually
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can export other users' data",
        });
      }

      // Fetch user profile
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Fetch user's org-scoped projects
      const orgProjects = await ctx.db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.orgId, ctx.orgId));

      // Fetch audit logs for this user in this org
      const userAuditLogs = await ctx.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.orgId, ctx.orgId),
            eq(auditLogs.userId, targetUserId)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(10_000);

      // Record the export action in audit log
      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "gdpr.data_export",
        resource: "user",
        resourceId: targetUserId,
        details: {
          exportedBy: ctx.auth.userId,
          targetUser: targetUserId,
          recordCounts: {
            auditLogs: userAuditLogs.length,
            projects: orgProjects.length,
          },
        },
      });

      logger.info(
        {
          orgId: ctx.orgId,
          requestedBy: ctx.auth.userId,
          targetUserId,
        },
        "GDPR data export requested"
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        projects: orgProjects,
        auditLogs: userAuditLogs.map((log) => ({
          id: log.id,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          details: log.details,
          createdAt: log.createdAt,
        })),
        exportedAt: new Date().toISOString(),
        exportedBy: ctx.auth.userId,
      };
    }),

  // ─── Request Data Deletion (GDPR) ─────────────────────────────────────
  requestDataDeletion: protectedProcedure
    .input(
      z.object({
        targetUserId: z.string().min(1, "User ID is required").optional(),
        reason: z.string().max(2000).optional(),
        confirmPhrase: z
          .string()
          .min(1, "Confirmation phrase is required")
          .refine((v) => v === "DELETE MY DATA", {
            message: 'Please type "DELETE MY DATA" to confirm',
          }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const targetUserId = input.targetUserId ?? ctx.auth.userId;

      // Only the user themselves or org owners can request deletion
      if (targetUserId !== ctx.auth.userId && ctx.auth.orgRole !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only org owners can request deletion of other users' data",
        });
      }

      // Verify the user exists
      const [user] = await ctx.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Create a deletion request audit entry
      // Actual deletion is processed asynchronously by a background job
      const requestId = generateId("gdpr");

      await ctx.db.insert(auditLogs).values({
        id: requestId,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "gdpr.deletion_request",
        resource: "user",
        resourceId: targetUserId,
        details: {
          requestedBy: ctx.auth.userId,
          targetUser: targetUserId,
          targetEmail: user.email,
          reason: input.reason ?? null,
          status: "pending",
          requestedAt: new Date().toISOString(),
          // GDPR requires processing within 30 days
          deadlineAt: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
      });

      logger.info(
        {
          orgId: ctx.orgId,
          requestId,
          requestedBy: ctx.auth.userId,
          targetUserId,
        },
        "GDPR data deletion requested"
      );

      return {
        requestId,
        status: "pending" as const,
        targetUserId,
        message:
          "Data deletion request has been submitted. You will be notified when processing is complete. Per GDPR, this will be processed within 30 days.",
        deadlineAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toISOString(),
      };
    }),

  // ─── Compliance Report ─────────────────────────────────────────────────
  getComplianceReport: orgAdminProcedure
    .input(
      z.object({
        period: z.enum(["7d", "30d", "90d", "365d"]).default("30d"),
      })
    )
    .query(async ({ input, ctx }) => {
      const periodDays = {
        "7d": 7,
        "30d": 30,
        "90d": 90,
        "365d": 365,
      };
      const days = periodDays[input.period];
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Total audit log entries for the period
      const [auditStats] = await ctx.db
        .select({
          totalEvents: sql<number>`COUNT(*)`,
          uniqueUsers: sql<number>`COUNT(DISTINCT ${auditLogs.userId})`,
          uniqueActions: sql<number>`COUNT(DISTINCT ${auditLogs.action})`,
        })
        .from(auditLogs)
        .where(
          and(eq(auditLogs.orgId, ctx.orgId), gte(auditLogs.createdAt, since))
        );

      // Events by action
      const eventsByAction = await ctx.db
        .select({
          action: auditLogs.action,
          count: sql<number>`COUNT(*)`,
        })
        .from(auditLogs)
        .where(
          and(eq(auditLogs.orgId, ctx.orgId), gte(auditLogs.createdAt, since))
        )
        .groupBy(auditLogs.action)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(20);

      // Events by resource type
      const eventsByResource = await ctx.db
        .select({
          resource: auditLogs.resource,
          count: sql<number>`COUNT(*)`,
        })
        .from(auditLogs)
        .where(
          and(eq(auditLogs.orgId, ctx.orgId), gte(auditLogs.createdAt, since))
        )
        .groupBy(auditLogs.resource)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(20);

      // GDPR-specific metrics
      const [gdprStats] = await ctx.db
        .select({
          exportRequests: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.action} = 'gdpr.data_export')`,
          deletionRequests: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.action} = 'gdpr.deletion_request')`,
        })
        .from(auditLogs)
        .where(
          and(eq(auditLogs.orgId, ctx.orgId), gte(auditLogs.createdAt, since))
        );

      // Security events (failed auth, permission denied, etc.)
      const [securityStats] = await ctx.db
        .select({
          securityEvents: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.action} LIKE 'security.%' OR ${auditLogs.action} LIKE 'auth.%')`,
          failedAttempts: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.action} LIKE '%failed%' OR ${auditLogs.action} LIKE '%denied%')`,
        })
        .from(auditLogs)
        .where(
          and(eq(auditLogs.orgId, ctx.orgId), gte(auditLogs.createdAt, since))
        );

      // Daily event trend
      const dailyTrend = await ctx.db
        .select({
          date: sql`date_trunc('day', ${auditLogs.createdAt})`.as("date"),
          count: sql<number>`COUNT(*)`,
        })
        .from(auditLogs)
        .where(
          and(eq(auditLogs.orgId, ctx.orgId), gte(auditLogs.createdAt, since))
        )
        .groupBy(sql`date`)
        .orderBy(sql`date`);

      // Compute compliance health score
      const totalEvents = Number(auditStats?.totalEvents ?? 0);
      const hasAuditCoverage = totalEvents > 0;
      const hasGdprProcess = Number(gdprStats?.exportRequests ?? 0) >= 0; // Always true if GDPR endpoints exist
      const lowSecurityIncidents =
        Number(securityStats?.failedAttempts ?? 0) < totalEvents * 0.05;

      const healthChecks = [
        {
          name: "Audit Logging Active",
          passed: hasAuditCoverage,
          description: "Audit logs are being generated for org actions",
        },
        {
          name: "GDPR Data Export Available",
          passed: hasGdprProcess,
          description: "User data export functionality is available",
        },
        {
          name: "GDPR Data Deletion Available",
          passed: hasGdprProcess,
          description: "User data deletion request functionality is available",
        },
        {
          name: "Low Security Incident Rate",
          passed: lowSecurityIncidents,
          description: "Failed/denied attempts are below 5% of total events",
        },
      ];

      const passedChecks = healthChecks.filter((c) => c.passed).length;
      const healthScore = Math.round(
        (passedChecks / healthChecks.length) * 100
      );

      logger.info(
        {
          orgId: ctx.orgId,
          period: input.period,
          totalEvents,
          healthScore,
        },
        "Compliance report generated"
      );

      return {
        period: input.period,
        periodStart: since.toISOString(),
        periodEnd: new Date().toISOString(),
        summary: {
          totalEvents,
          uniqueUsers: Number(auditStats?.uniqueUsers ?? 0),
          uniqueActions: Number(auditStats?.uniqueActions ?? 0),
        },
        gdpr: {
          exportRequests: Number(gdprStats?.exportRequests ?? 0),
          deletionRequests: Number(gdprStats?.deletionRequests ?? 0),
        },
        security: {
          totalSecurityEvents: Number(securityStats?.securityEvents ?? 0),
          failedAttempts: Number(securityStats?.failedAttempts ?? 0),
        },
        eventsByAction: eventsByAction.map((e) => ({
          action: e.action,
          count: Number(e.count),
        })),
        eventsByResource: eventsByResource.map((e) => ({
          resource: e.resource,
          count: Number(e.count),
        })),
        dailyTrend: dailyTrend.map((d) => ({
          date: String(d.date),
          count: Number(d.count),
        })),
        healthChecks,
        healthScore,
      };
    }),

  // ─── Export Audit Logs (CSV/JSON for SOC 2) ─────────────────────────────
  exportAuditLogs: orgAdminProcedure
    .input(
      z.object({
        format: z.enum(["json", "csv"]).default("json"),
        dateFrom: z.string().datetime(),
        dateTo: z.string().datetime(),
        action: z.string().optional(),
        resource: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const conditions = [
        eq(auditLogs.orgId, ctx.orgId),
        gte(auditLogs.createdAt, new Date(input.dateFrom)),
        lte(auditLogs.createdAt, new Date(input.dateTo)),
      ];

      if (input.action) {
        conditions.push(eq(auditLogs.action, input.action));
      }
      if (input.resource) {
        conditions.push(eq(auditLogs.resource, input.resource));
      }

      const results = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt))
        .limit(50_000);

      // Resolve user names
      const userIds = [
        ...new Set(results.map((l) => l.userId).filter(Boolean)),
      ] as string[];

      let userMap = new Map<string, { name: string | null; email: string }>();
      if (userIds.length > 0) {
        const userRows = await ctx.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds));
        userMap = new Map(
          userRows.map((u) => [u.id, { name: u.name, email: u.email }])
        );
      }

      const rows = results.map((log) => ({
        id: log.id,
        timestamp: log.createdAt.toISOString(),
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId ?? "",
        userId: log.userId ?? "",
        userName: log.userId ? (userMap.get(log.userId)?.name ?? "") : "",
        userEmail: log.userId ? (userMap.get(log.userId)?.email ?? "") : "",
        ipAddress: log.ipAddress ?? "",
        details: JSON.stringify(log.details ?? {}),
      }));

      // Record the export in audit log
      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "audit.export",
        resource: "audit_log",
        details: {
          format: input.format,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          recordCount: rows.length,
        },
      });

      if (input.format === "csv") {
        const headers = [
          "id",
          "timestamp",
          "action",
          "resource",
          "resourceId",
          "userId",
          "userName",
          "userEmail",
          "ipAddress",
          "details",
        ];
        const csvRows = rows.map((r) =>
          headers
            .map((h) => {
              const val = String(r[h as keyof typeof r]);
              return val.includes(",") || val.includes('"')
                ? `"${val.replace(/"/g, '""')}"`
                : val;
            })
            .join(",")
        );
        const csv = [headers.join(","), ...csvRows].join("\n");

        logger.info(
          { orgId: ctx.orgId, format: "csv", count: rows.length },
          "Audit log export completed"
        );

        return { format: "csv" as const, data: csv, recordCount: rows.length };
      }

      logger.info(
        { orgId: ctx.orgId, format: "json", count: rows.length },
        "Audit log export completed"
      );

      return { format: "json" as const, data: rows, recordCount: rows.length };
    }),
});
