import {
  auditArchiveIndex,
  auditLogs,
  auditRetentionPolicies,
  projects,
  users,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  archiveOrgAuditLogs,
  retrieveArchivedLogs,
} from "../services/audit-archival";
import {
  checkDataResidency,
  generateComplianceReport,
  getAccessReview,
  getSecurityControls,
} from "../services/compliance";
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

  // ─── Full-Text Search Across Audit Logs ────────────────────────────────
  search: orgAdminProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        action: z.string().optional(),
        userId: z.string().optional(),
        resourceType: z.string().optional(),
        dateFrom: z.string().datetime().optional(),
        dateTo: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [eq(auditLogs.orgId, ctx.orgId)];

      // Full-text search across action, resource, resourceId, and details
      const searchPattern = `%${input.query}%`;
      conditions.push(
        or(
          ilike(auditLogs.action, searchPattern),
          ilike(auditLogs.resource, searchPattern),
          ilike(auditLogs.resourceId, searchPattern),
          sql`${auditLogs.details}::text ILIKE ${searchPattern}`
        ) ?? sql`true`
      );

      if (input.action) {
        conditions.push(eq(auditLogs.action, input.action));
      }
      if (input.userId) {
        conditions.push(eq(auditLogs.userId, input.userId));
      }
      if (input.resourceType) {
        conditions.push(eq(auditLogs.resource, input.resourceType));
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

      // Resolve user names
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
        { orgId: ctx.orgId, query: input.query, resultCount: items.length },
        "Audit log search completed"
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

  // ─── Set Retention Policy ──────────────────────────────────────────────
  setRetentionPolicy: orgAdminProcedure
    .input(
      z.object({
        retentionDays: z
          .number()
          .int()
          .min(7, "Minimum retention is 7 days")
          .max(2555, "Maximum retention is 7 years"),
        archiveEnabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const policyId = generateId("arp");

      // Upsert the retention policy
      const [existing] = await ctx.db
        .select({ id: auditRetentionPolicies.id })
        .from(auditRetentionPolicies)
        .where(eq(auditRetentionPolicies.orgId, ctx.orgId))
        .limit(1);

      if (existing) {
        await ctx.db
          .update(auditRetentionPolicies)
          .set({
            retentionDays: input.retentionDays,
            archiveEnabled: input.archiveEnabled ? "true" : "false",
            updatedBy: ctx.auth.userId,
          })
          .where(eq(auditRetentionPolicies.id, existing.id));
      } else {
        await ctx.db.insert(auditRetentionPolicies).values({
          id: policyId,
          orgId: ctx.orgId,
          retentionDays: input.retentionDays,
          archiveEnabled: input.archiveEnabled ? "true" : "false",
          updatedBy: ctx.auth.userId,
        });
      }

      // Record in audit log
      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "audit.retention_policy_updated",
        resource: "audit_retention_policy",
        details: {
          retentionDays: input.retentionDays,
          archiveEnabled: input.archiveEnabled,
          updatedBy: ctx.auth.userId,
        },
      });

      logger.info(
        {
          orgId: ctx.orgId,
          retentionDays: input.retentionDays,
          archiveEnabled: input.archiveEnabled,
        },
        "Retention policy updated"
      );

      return {
        retentionDays: input.retentionDays,
        archiveEnabled: input.archiveEnabled,
        updatedAt: new Date().toISOString(),
      };
    }),

  // ─── Get Retention Policy ──────────────────────────────────────────────
  getRetentionPolicy: orgAdminProcedure.query(async ({ ctx }) => {
    const [policy] = await ctx.db
      .select()
      .from(auditRetentionPolicies)
      .where(eq(auditRetentionPolicies.orgId, ctx.orgId))
      .limit(1);

    return {
      retentionDays: policy?.retentionDays ?? 90,
      archiveEnabled: policy?.archiveEnabled !== "false",
      lastArchivedAt: policy?.lastArchivedAt?.toISOString() ?? null,
      updatedBy: policy?.updatedBy ?? null,
      updatedAt: policy?.updatedAt?.toISOString() ?? null,
    };
  }),

  // ─── Archive Old Logs ──────────────────────────────────────────────────
  archiveOldLogs: orgAdminProcedure.mutation(async ({ ctx }) => {
    const result = await archiveOrgAuditLogs(ctx.orgId);

    // Record the archival action
    await ctx.db.insert(auditLogs).values({
      id: generateId("audit"),
      orgId: ctx.orgId,
      userId: ctx.auth.userId,
      action: "audit.manual_archive",
      resource: "audit_log",
      details: {
        archivedCount: result.archivedCount,
        archiveId: result.archiveId,
        triggeredBy: ctx.auth.userId,
      },
    });

    logger.info(
      {
        orgId: ctx.orgId,
        archivedCount: result.archivedCount,
        archiveId: result.archiveId,
      },
      "Manual audit log archival completed"
    );

    return result;
  }),

  // ─── List Archives ─────────────────────────────────────────────────────
  listArchives: orgAdminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [eq(auditArchiveIndex.orgId, ctx.orgId)];

      if (input.cursor) {
        const [cursorArchive] = await ctx.db
          .select({ createdAt: auditArchiveIndex.createdAt })
          .from(auditArchiveIndex)
          .where(eq(auditArchiveIndex.id, input.cursor))
          .limit(1);
        if (cursorArchive) {
          conditions.push(
            lt(auditArchiveIndex.createdAt, cursorArchive.createdAt)
          );
        }
      }

      const results = await ctx.db
        .select()
        .from(auditArchiveIndex)
        .where(and(...conditions))
        .orderBy(desc(auditArchiveIndex.createdAt))
        .limit(input.limit + 1);

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        archives: items.map((a) => ({
          id: a.id,
          periodStart: a.periodStart.toISOString(),
          periodEnd: a.periodEnd.toISOString(),
          recordCount: a.recordCount,
          sizeBytes: a.sizeBytes,
          checksumSha256: a.checksumSha256,
          createdAt: a.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Retrieve Archived Logs ────────────────────────────────────────────
  getArchivedLogs: orgAdminProcedure
    .input(
      z.object({
        archiveId: z.string().min(1),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const logs = await retrieveArchivedLogs(input.archiveId, ctx.orgId);

        logger.info(
          {
            orgId: ctx.orgId,
            archiveId: input.archiveId,
            recordCount: logs.length,
          },
          "Archived logs retrieved"
        );

        return { logs, recordCount: logs.length };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Failed to retrieve archive: ${message}`,
        });
      }
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

      // Retention policy
      const [retentionPolicy] = await ctx.db
        .select()
        .from(auditRetentionPolicies)
        .where(eq(auditRetentionPolicies.orgId, ctx.orgId))
        .limit(1);

      // Compute compliance health score
      const totalEvents = Number(auditStats?.totalEvents ?? 0);
      const hasAuditCoverage = totalEvents > 0;
      const hasGdprProcess = Number(gdprStats?.exportRequests ?? 0) >= 0;
      const lowSecurityIncidents =
        Number(securityStats?.failedAttempts ?? 0) < totalEvents * 0.05;
      const hasRetentionPolicy = retentionPolicy !== undefined;

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
        {
          name: "Retention Policy Configured",
          passed: hasRetentionPolicy,
          description:
            "A data retention policy is configured for audit log lifecycle management",
        },
        {
          name: "Archive Enabled",
          passed: retentionPolicy?.archiveEnabled !== "false",
          description:
            "Old audit logs are archived to cold storage before deletion",
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
        retentionPolicy: {
          retentionDays: retentionPolicy?.retentionDays ?? 90,
          archiveEnabled: retentionPolicy?.archiveEnabled !== "false",
          lastArchivedAt:
            retentionPolicy?.lastArchivedAt?.toISOString() ?? null,
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

  // ─── Enhanced Compliance Report (SOC2 Type II) ─────────────────────────
  getFullComplianceReport: orgAdminProcedure
    .input(
      z.object({
        periodDays: z.number().int().min(7).max(365).default(90),
      })
    )
    .query(async ({ input, ctx }) => {
      const report = await generateComplianceReport(
        ctx.orgId,
        input.periodDays
      );

      // Record the report generation in audit log
      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "audit.compliance_report_generated",
        resource: "compliance_report",
        details: {
          periodDays: input.periodDays,
          healthScore:
            (report.securityControls.filter((c) => c.status === "implemented")
              .length /
              report.securityControls.length) *
            100,
          totalEvents: report.summary.totalAuditEvents,
        },
      });

      return report;
    }),

  // ─── Security Controls ─────────────────────────────────────────────────
  getSecurityControls: orgAdminProcedure.query(() => {
    return { controls: getSecurityControls() };
  }),

  // ─── Data Residency Check ──────────────────────────────────────────────
  checkDataResidency: orgAdminProcedure.query(() => {
    return checkDataResidency();
  }),

  // ─── Access Review ─────────────────────────────────────────────────────
  getAccessReview: orgAdminProcedure
    .input(
      z.object({
        periodDays: z.number().int().min(7).max(365).default(90),
      })
    )
    .query(async ({ input, ctx }) => {
      const since = new Date(
        Date.now() - input.periodDays * 24 * 60 * 60 * 1000
      );
      const review = await getAccessReview(ctx.orgId, since);

      // Record the access review in audit log
      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "audit.access_review",
        resource: "access_review",
        details: {
          periodDays: input.periodDays,
          userCount: review.length,
          reviewedBy: ctx.auth.userId,
        },
      });

      return { entries: review, reviewedAt: new Date().toISOString() };
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
