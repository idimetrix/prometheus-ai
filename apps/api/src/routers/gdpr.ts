import {
  agents,
  auditLogs,
  creditTransactions,
  sessionEvents,
  sessionMessages,
  sessions,
  taskSteps,
  tasks,
  userSettings,
  users,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  orgAdminProcedure,
  orgOwnerProcedure,
  protectedProcedure,
  router,
} from "../trpc";

const logger = createLogger("gdpr-router");

// ─── GDPR Router ──────────────────────────────────────────────────────────────

export const gdprRouter = router({
  /**
   * GDPR — Data Retention Policy
   *
   * Configure auto-deletion schedules for different data types.
   */
  dataRetentionPolicy: orgAdminProcedure
    .input(
      z.object({
        sessionRetentionDays: z.number().int().min(30).max(3650).default(365),
        auditLogRetentionDays: z.number().int().min(90).max(3650).default(730),
        taskRetentionDays: z.number().int().min(30).max(3650).default(365),
        creditHistoryRetentionDays: z
          .number()
          .int()
          .min(90)
          .max(3650)
          .default(730),
      })
    )
    .mutation(async ({ input, ctx }) => {
      logger.info(
        { orgId: ctx.orgId, policy: input },
        "GDPR data retention policy updated"
      );

      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "gdpr.retention_policy_updated",
        resource: "org",
        resourceId: ctx.orgId,
        details: {
          ...input,
          updatedAt: new Date().toISOString(),
        },
      });

      return {
        success: true,
        policy: input,
        updatedAt: new Date().toISOString(),
      };
    }),

  /**
   * GDPR — Consent Management
   *
   * Track and manage user consent for data processing purposes.
   */
  consentManagement: protectedProcedure
    .input(
      z.object({
        consents: z.array(
          z.object({
            purpose: z.enum([
              "analytics",
              "marketing",
              "essential",
              "ai_training",
              "third_party_sharing",
            ]),
            granted: z.boolean(),
          })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const consentRecord = {
        userId: ctx.auth.userId,
        consents: input.consents,
        recordedAt: new Date().toISOString(),
        ipAddress: null as string | null,
      };

      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "gdpr.consent_updated",
        resource: "user",
        resourceId: ctx.auth.userId,
        details: consentRecord,
      });

      logger.info(
        { userId: ctx.auth.userId, consents: input.consents },
        "GDPR consent updated"
      );

      return {
        success: true,
        consents: input.consents,
        recordedAt: consentRecord.recordedAt,
      };
    }),

  /**
   * GDPR — Data Processing Log
   *
   * Log and retrieve all data processing activities for compliance.
   */
  dataProcessingLog: protectedProcedure
    .input(
      z.object({
        action: z.enum(["log", "list"]),
        entry: z
          .object({
            purpose: z.string().min(1),
            dataCategories: z.array(z.string()),
            legalBasis: z.enum([
              "consent",
              "contract",
              "legal_obligation",
              "legitimate_interest",
              "vital_interest",
              "public_task",
            ]),
            recipients: z.array(z.string()).optional(),
            retentionPeriod: z.string().optional(),
          })
          .optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.action === "log" && input.entry) {
        await ctx.db.insert(auditLogs).values({
          id: generateId("audit"),
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          action: "gdpr.data_processing_logged",
          resource: "org",
          resourceId: ctx.orgId,
          details: {
            ...input.entry,
            loggedAt: new Date().toISOString(),
          },
        });

        logger.info(
          { orgId: ctx.orgId, purpose: input.entry.purpose },
          "GDPR data processing activity logged"
        );

        return {
          success: true,
          loggedAt: new Date().toISOString(),
        };
      }

      // List processing logs
      const logs = await ctx.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.orgId, ctx.orgId),
            eq(auditLogs.action, "gdpr.data_processing_logged")
          )
        )
        .limit(input.limit);

      return {
        success: true,
        entries: logs.map((log) => ({
          id: log.id,
          details: log.details,
          createdAt: log.createdAt,
        })),
      };
    }),

  /**
   * GDPR Article 16 — Right to Rectification
   *
   * Allow users to correct their personal data.
   */
  rightToRectification: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        corrections: z.object({
          name: z.string().optional(),
          email: z.string().email().optional(),
          avatarUrl: z.string().url().optional().nullable(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Users can correct their own data; admins can correct others'
      if (
        input.userId !== ctx.auth.userId &&
        ctx.auth.orgRole !== "admin" &&
        ctx.auth.orgRole !== "owner"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can rectify other users' data",
        });
      }

      const [targetUser] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      if (!targetUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const updateData: Record<string, unknown> = {};
      if (input.corrections.name !== undefined) {
        updateData.name = input.corrections.name;
      }
      if (input.corrections.email !== undefined) {
        updateData.email = input.corrections.email;
      }
      if (input.corrections.avatarUrl !== undefined) {
        updateData.avatarUrl = input.corrections.avatarUrl;
      }

      if (Object.keys(updateData).length > 0) {
        await ctx.db
          .update(users)
          .set(updateData)
          .where(eq(users.id, input.userId));
      }

      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "gdpr.data_rectified",
        resource: "user",
        resourceId: input.userId,
        details: {
          correctedFields: Object.keys(updateData),
          requestedBy: ctx.auth.userId,
          rectifiedAt: new Date().toISOString(),
        },
      });

      logger.info(
        {
          orgId: ctx.orgId,
          requestedBy: ctx.auth.userId,
          targetUserId: input.userId,
          fields: Object.keys(updateData),
        },
        "GDPR data rectification completed"
      );

      return {
        success: true,
        userId: input.userId,
        correctedFields: Object.keys(updateData),
        rectifiedAt: new Date().toISOString(),
      };
    }),

  /**
   * GDPR Article 17 — Right to Erasure ("Right to be Forgotten")
   *
   * Cascade-deletes all user data across the platform:
   *   1. Task steps and tasks
   *   2. Agents
   *   3. Session events, messages, and sessions
   *   4. Credit transactions
   *   5. User settings
   *   6. Anonymize audit logs (preserve structure, scrub PII)
   *   7. Delete user record
   *
   * Only the user themselves or an org owner may invoke this.
   */
  deleteUser: orgOwnerProcedure
    .input(
      z.object({
        userId: z.string().min(1, "User ID is required"),
        confirmPhrase: z.string().refine((v) => v === "PERMANENTLY DELETE", {
          message: 'Type "PERMANENTLY DELETE" to confirm',
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const targetUserId = input.userId;

      // Verify the target user exists
      const [targetUser] = await ctx.db
        .select({ id: users.id, email: users.email, clerkId: users.clerkId })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (!targetUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      logger.info(
        {
          orgId: ctx.orgId,
          requestedBy: ctx.auth.userId,
          targetUserId,
        },
        "GDPR user deletion started"
      );

      // Collect all session IDs owned by this user
      const userSessions = await ctx.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, targetUserId));

      const sessionIds = userSessions.map((s) => s.id);

      // Track deletion counts for audit
      const deletionCounts: Record<string, number> = {};

      // 1. Delete task steps and tasks (via sessions)
      if (sessionIds.length > 0) {
        const userTasks = await ctx.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.sessionId, sessionIds));

        const taskIds = userTasks.map((t) => t.id);

        if (taskIds.length > 0) {
          await ctx.db
            .delete(taskSteps)
            .where(inArray(taskSteps.taskId, taskIds));
          deletionCounts.taskSteps = taskIds.length;

          await ctx.db.delete(tasks).where(inArray(tasks.id, taskIds));
          deletionCounts.tasks = taskIds.length;
        }

        // 2. Delete agents
        await ctx.db
          .delete(agents)
          .where(inArray(agents.sessionId, sessionIds));
        deletionCounts.agents = sessionIds.length;

        // 3. Delete session events and messages
        await ctx.db
          .delete(sessionEvents)
          .where(inArray(sessionEvents.sessionId, sessionIds));

        await ctx.db
          .delete(sessionMessages)
          .where(inArray(sessionMessages.sessionId, sessionIds));

        // 4. Delete sessions
        await ctx.db.delete(sessions).where(eq(sessions.userId, targetUserId));
        deletionCounts.sessions = sessionIds.length;
      }

      // 5. Delete credit transactions referencing user tasks
      // Credit transactions are org-scoped, but we clean up those linked to the user's tasks
      await ctx.db
        .delete(creditTransactions)
        .where(
          and(
            eq(creditTransactions.orgId, ctx.orgId),
            sql`${creditTransactions.description} LIKE ${`%${targetUserId}%`}`
          )
        );

      // 6. Delete user settings
      await ctx.db
        .delete(userSettings)
        .where(eq(userSettings.userId, targetUserId));
      deletionCounts.userSettings = 1;

      // 7. Anonymize audit logs — preserve audit trail structure but scrub PII
      await ctx.db
        .update(auditLogs)
        .set({
          userId: null,
          ipAddress: null,
          details: sql`jsonb_set(
            COALESCE(${auditLogs.details}::jsonb, '{}'::jsonb),
            '{anonymized}',
            'true'::jsonb
          ) - 'email' - 'name' - 'avatarUrl' - 'requestedBy' - 'targetEmail'`,
        })
        .where(eq(auditLogs.userId, targetUserId));

      // 8. Record the deletion itself in the audit log (with requester info, not target)
      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "gdpr.user_deleted",
        resource: "user",
        resourceId: targetUserId,
        details: {
          deletedUserEmail: "[redacted]",
          deletionCounts,
          deletedAt: new Date().toISOString(),
        },
      });

      // 9. Delete the user record itself
      await ctx.db.delete(users).where(eq(users.id, targetUserId));
      deletionCounts.user = 1;

      logger.info(
        {
          orgId: ctx.orgId,
          requestedBy: ctx.auth.userId,
          targetUserId,
          deletionCounts,
        },
        "GDPR user deletion completed"
      );

      return {
        success: true,
        userId: targetUserId,
        deletionCounts,
        completedAt: new Date().toISOString(),
      };
    }),

  /**
   * GDPR Article 20 — Right to Data Portability
   *
   * Exports all user data as structured JSON:
   *   - User profile and settings
   *   - Sessions with events and messages
   *   - Tasks and steps
   *   - Credit transaction history
   *   - Audit log entries
   */
  exportData: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1, "User ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const targetUserId = input.userId;

      // Users can export their own data; admins/owners can export others'
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

      // Fetch user settings
      const [settings] = await ctx.db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, targetUserId))
        .limit(1);

      // Fetch all sessions
      const userSessions = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, targetUserId));

      const sessionIds = userSessions.map((s) => s.id);

      // Fetch session events and messages
      let allEvents: (typeof sessionEvents.$inferSelect)[] = [];
      let allMessages: (typeof sessionMessages.$inferSelect)[] = [];
      let allTasks: (typeof tasks.$inferSelect)[] = [];
      let allTaskSteps: (typeof taskSteps.$inferSelect)[] = [];
      let allAgents: (typeof agents.$inferSelect)[] = [];

      if (sessionIds.length > 0) {
        allEvents = await ctx.db
          .select()
          .from(sessionEvents)
          .where(inArray(sessionEvents.sessionId, sessionIds));

        allMessages = await ctx.db
          .select()
          .from(sessionMessages)
          .where(inArray(sessionMessages.sessionId, sessionIds));

        allTasks = await ctx.db
          .select()
          .from(tasks)
          .where(inArray(tasks.sessionId, sessionIds));

        const taskIds = allTasks.map((t) => t.id);
        if (taskIds.length > 0) {
          allTaskSteps = await ctx.db
            .select()
            .from(taskSteps)
            .where(inArray(taskSteps.taskId, taskIds));
        }

        allAgents = await ctx.db
          .select()
          .from(agents)
          .where(inArray(agents.sessionId, sessionIds));
      }

      // Fetch credit history (org-scoped)
      const creditHistory = await ctx.db
        .select()
        .from(creditTransactions)
        .where(eq(creditTransactions.orgId, ctx.orgId))
        .limit(10_000);

      // Fetch audit log entries for this user
      const userAuditLogs = await ctx.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.orgId, ctx.orgId),
            eq(auditLogs.userId, targetUserId)
          )
        )
        .limit(10_000);

      // Record the export action
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
            sessions: userSessions.length,
            events: allEvents.length,
            messages: allMessages.length,
            tasks: allTasks.length,
            taskSteps: allTaskSteps.length,
            agents: allAgents.length,
            creditTransactions: creditHistory.length,
            auditLogs: userAuditLogs.length,
          },
        },
      });

      logger.info(
        {
          orgId: ctx.orgId,
          requestedBy: ctx.auth.userId,
          targetUserId,
          sessionCount: userSessions.length,
          taskCount: allTasks.length,
        },
        "GDPR data export completed"
      );

      return {
        exportVersion: "1.0",
        exportedAt: new Date().toISOString(),
        exportedBy: ctx.auth.userId,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        settings: settings
          ? {
              theme: settings.theme,
              defaultModel: settings.defaultModel,
              notificationsEnabled: settings.notificationsEnabled,
            }
          : null,
        sessions: userSessions.map((s) => ({
          ...s,
          events: allEvents.filter((e) => e.sessionId === s.id),
          messages: allMessages.filter((m) => m.sessionId === s.id),
          agents: allAgents.filter((a) => a.sessionId === s.id),
        })),
        tasks: allTasks.map((t) => ({
          ...t,
          steps: allTaskSteps.filter((s) => s.taskId === t.id),
        })),
        creditHistory,
        auditLogs: userAuditLogs.map((log) => ({
          id: log.id,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          details: log.details,
          createdAt: log.createdAt,
        })),
      };
    }),
});
