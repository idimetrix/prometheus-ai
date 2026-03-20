import { auditLogs, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

const logger = createLogger("api:audit-service");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditSnapshot {
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
}

export interface AuditEventParams {
  action: string;
  actor: string;
  ipAddress?: string | null;
  orgId: string;
  resource: string;
  resourceId?: string;
  sessionId?: string;
  severity: AuditSeverity;
  snapshot?: AuditSnapshot;
  userAgent?: string;
}

export interface AuditLogEntry {
  action: string;
  createdAt: Date;
  details: Record<string, unknown>;
  id: string;
  ipAddress: string | null;
  orgId: string;
  resource: string;
  resourceId: string | null;
  userId: string | null;
}

export interface AuditQueryParams {
  action?: string;
  actor?: string;
  endDate?: Date;
  limit?: number;
  offset?: number;
  orgId: string;
  resource?: string;
  severity?: AuditSeverity;
  startDate?: Date;
}

export interface AuditQueryResult {
  entries: AuditLogEntry[];
  hasMore: boolean;
  total: number;
}

// ---------------------------------------------------------------------------
// Retention Policy
// ---------------------------------------------------------------------------

const RETENTION_DAYS = 90;

// ---------------------------------------------------------------------------
// SOC2 Audit Trail Service
// ---------------------------------------------------------------------------

export class AuditService {
  /**
   * Record an audit event with before/after snapshots.
   */
  async record(params: AuditEventParams): Promise<string> {
    const id = generateId("audit");

    const details: Record<string, unknown> = {
      severity: params.severity,
      sessionId: params.sessionId,
      userAgent: params.userAgent,
    };

    if (params.snapshot) {
      if (params.snapshot.before) {
        details.before = params.snapshot.before;
      }
      if (params.snapshot.after) {
        details.after = params.snapshot.after;
      }
    }

    try {
      await db.insert(auditLogs).values({
        id,
        orgId: params.orgId,
        userId: params.actor === "system" ? null : params.actor,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId ?? null,
        details,
        ipAddress: params.ipAddress ?? null,
      });

      logger.info(
        {
          id,
          action: params.action,
          actor: params.actor,
          resource: params.resource,
          severity: params.severity,
        },
        "Audit event recorded"
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: msg, action: params.action },
        "Failed to record audit event"
      );
    }

    return id;
  }

  /**
   * Record a state change with before/after snapshots.
   */
  recordStateChange(
    params: Omit<AuditEventParams, "snapshot"> & {
      after: Record<string, unknown>;
      before: Record<string, unknown>;
    }
  ): Promise<string> {
    return this.record({
      ...params,
      snapshot: {
        before: params.before,
        after: params.after,
      },
    });
  }

  /**
   * Query audit logs with filtering and pagination.
   * Admin-only API for retrieving audit trail.
   */
  async query(params: AuditQueryParams): Promise<AuditQueryResult> {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const conditions = [eq(auditLogs.orgId, params.orgId)];

    if (params.action) {
      conditions.push(eq(auditLogs.action, params.action));
    }

    if (params.actor) {
      conditions.push(eq(auditLogs.userId, params.actor));
    }

    if (params.resource) {
      conditions.push(eq(auditLogs.resource, params.resource));
    }

    if (params.startDate) {
      conditions.push(gte(auditLogs.createdAt, params.startDate));
    }

    if (params.endDate) {
      conditions.push(lt(auditLogs.createdAt, params.endDate));
    }

    if (params.severity) {
      conditions.push(
        sql`${auditLogs.details}->>'severity' = ${params.severity}`
      );
    }

    const whereClause = and(...conditions);

    const [entries, countResult] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      entries: entries.map((e) => ({
        id: e.id,
        orgId: e.orgId,
        userId: e.userId,
        action: e.action,
        resource: e.resource,
        resourceId: e.resourceId,
        details: (e.details ?? {}) as Record<string, unknown>,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt,
      })),
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Apply 90-day retention policy.
   * Deletes audit log entries older than RETENTION_DAYS days.
   * Should be called on a scheduled basis (e.g., daily cron).
   */
  async applyRetentionPolicy(): Promise<number> {
    const cutoffDate = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    );

    try {
      const deleted = await db
        .delete(auditLogs)
        .where(lt(auditLogs.createdAt, cutoffDate))
        .returning({ id: auditLogs.id });

      const count = deleted.length;

      if (count > 0) {
        logger.info(
          { deletedCount: count, cutoffDate: cutoffDate.toISOString() },
          "Audit log retention policy applied"
        );
      }

      return count;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: msg },
        "Failed to apply audit log retention policy"
      );
      return 0;
    }
  }

  /**
   * Get audit summary statistics for an org within a date range.
   */
  async getSummary(
    orgId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    byAction: Record<string, number>;
    byResource: Record<string, number>;
    bySeverity: Record<string, number>;
    totalEvents: number;
  }> {
    const conditions = [
      eq(auditLogs.orgId, orgId),
      gte(auditLogs.createdAt, startDate),
      lt(auditLogs.createdAt, endDate),
    ];

    const whereClause = and(...conditions);

    const [actionCounts, resourceCounts, entries] = await Promise.all([
      db
        .select({
          action: auditLogs.action,
          count: sql<number>`count(*)::int`,
        })
        .from(auditLogs)
        .where(whereClause)
        .groupBy(auditLogs.action),
      db
        .select({
          resource: auditLogs.resource,
          count: sql<number>`count(*)::int`,
        })
        .from(auditLogs)
        .where(whereClause)
        .groupBy(auditLogs.resource),
      db
        .select({ details: auditLogs.details })
        .from(auditLogs)
        .where(whereClause),
    ]);

    const byAction: Record<string, number> = {};
    for (const row of actionCounts) {
      byAction[row.action] = row.count;
    }

    const byResource: Record<string, number> = {};
    for (const row of resourceCounts) {
      byResource[row.resource] = row.count;
    }

    const bySeverity: Record<string, number> = {};
    for (const entry of entries) {
      const details = entry.details as Record<string, unknown> | null;
      const severity = (details?.severity as string) ?? "info";
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    }

    const totalEvents = entries.length;

    return { totalEvents, byAction, byResource, bySeverity };
  }
}
