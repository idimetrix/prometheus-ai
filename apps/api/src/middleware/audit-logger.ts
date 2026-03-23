import { auditLogs, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { Context, Next } from "hono";

const logger = createLogger("api:audit-logger");

// ─── Audit Action Enum ────────────────────────────────────────────────────────

export const AuditAction = {
  // Authentication events
  USER_LOGIN: "user.login",
  USER_LOGOUT: "user.logout",
  AUTH_FAILED: "auth.failed",
  AUTH_TOKEN_REFRESH: "auth.token_refresh",

  // Admin / config changes
  ADMIN_CONFIG_CHANGE: "admin.config_change",
  ADMIN_ROLE_CHANGE: "admin.role_change",
  ADMIN_MEMBER_INVITE: "admin.member_invite",
  ADMIN_MEMBER_REMOVE: "admin.member_remove",

  // Data access events
  DATA_ACCESS: "data.access",
  DATA_EXPORT: "data.export",
  DATA_DELETE: "data.delete",
  DATA_BULK_ACCESS: "data.bulk_access",

  // Agent lifecycle
  AGENT_CREATE: "agent.create",
  AGENT_TERMINATE: "agent.terminate",
  AGENT_STATUS_CHANGE: "agent.status_change",

  // Session lifecycle
  SESSION_CREATE: "session.create",
  SESSION_END: "session.end",

  // Task lifecycle
  TASK_SUBMIT: "task.submit",
  TASK_COMPLETE: "task.complete",
  TASK_CANCEL: "task.cancel",

  // API key management
  API_KEY_CREATE: "api_key.create",
  API_KEY_REVOKE: "api_key.revoke",

  // GDPR events
  GDPR_DATA_EXPORT: "gdpr.data_export",
  GDPR_DELETION_REQUEST: "gdpr.deletion_request",
  GDPR_USER_DELETED: "gdpr.user_deleted",

  // Security events
  SECURITY_RATE_LIMIT: "security.rate_limit",
  SECURITY_PERMISSION_DENIED: "security.permission_denied",
  SECURITY_SUSPICIOUS_ACTIVITY: "security.suspicious_activity",
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

// ─── Structured Audit Entry ───────────────────────────────────────────────────

export interface AuditEntry {
  action: AuditActionType;
  actor: string; // userId or "system"
  details?: Record<string, unknown>;
  ip: string | null;
  orgId: string;
  resource: string; // Resource type (e.g., "user", "session", "agent")
  resourceId?: string;
  result: "success" | "failure" | "denied";
  timestamp: string;
}

// ─── tRPC Procedure to Audit Action Mapping ───────────────────────────────────

const PROCEDURE_ACTION_MAP: Record<string, AuditActionType> = {
  "sessions.create": AuditAction.SESSION_CREATE,
  "sessions.end": AuditAction.SESSION_END,
  "tasks.create": AuditAction.TASK_SUBMIT,
  "tasks.cancel": AuditAction.TASK_CANCEL,
  "fleet.terminateAgent": AuditAction.AGENT_TERMINATE,
  "fleet.spawnAgent": AuditAction.AGENT_CREATE,
  "apiKeys.create": AuditAction.API_KEY_CREATE,
  "apiKeys.revoke": AuditAction.API_KEY_REVOKE,
  "gdpr.deleteUser": AuditAction.GDPR_USER_DELETED,
  "gdpr.exportData": AuditAction.GDPR_DATA_EXPORT,
  "audit.requestDataDeletion": AuditAction.GDPR_DELETION_REQUEST,
  "settings.update": AuditAction.ADMIN_CONFIG_CHANGE,
  "user.updateProfile": AuditAction.ADMIN_CONFIG_CHANGE,
};

// Procedures that represent sensitive data access (read operations worth logging)
const SENSITIVE_READ_PROCEDURES = new Set([
  "audit.getAuditLog",
  "audit.exportUserData",
  "audit.getComplianceReport",
  "billing.getUsage",
  "billing.getInvoices",
]);

// ─── Extract tRPC Path ────────────────────────────────────────────────────────

function extractTrpcPath(urlPath: string): string | undefined {
  const trpcIdx = urlPath.indexOf("/trpc/");
  if (trpcIdx === -1) {
    return undefined;
  }
  return urlPath.slice(trpcIdx + 6).split("?")[0] || undefined;
}

function extractResourceFromProcedure(procedure: string): string {
  return procedure.split(".")[0] ?? "unknown";
}

// ─── Write Audit Log (Fire-and-Forget) ────────────────────────────────────────

function persistAuditEntry(entry: AuditEntry): void {
  db.insert(auditLogs)
    .values({
      id: generateId("audit"),
      orgId: entry.orgId,
      userId: entry.actor === "system" ? null : entry.actor,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      details: {
        result: entry.result,
        ...entry.details,
      },
      ipAddress: entry.ip,
    })
    .then(() => {
      logger.debug({ action: entry.action }, "Audit entry persisted");
    })
    .catch((err: unknown) => {
      logger.error(
        { err, action: entry.action },
        "Failed to persist audit entry"
      );
    });
}

// ─── Public API for Programmatic Audit Logging ────────────────────────────────

/**
 * Log an audit event programmatically (for use in tRPC procedures, webhooks, etc.).
 */
export function logAuditEvent(entry: AuditEntry): void {
  logger.info(
    {
      action: entry.action,
      actor: entry.actor,
      resource: entry.resource,
      resourceId: entry.resourceId,
      orgId: entry.orgId,
      result: entry.result,
    },
    "Audit event"
  );
  persistAuditEntry(entry);
}

// ─── Audit Resolution Helpers ─────────────────────────────────────────────────

function resolveAuditAction(
  procedure: string | undefined,
  isSensitiveRead: boolean,
  statusCode: number
): AuditActionType {
  if (statusCode === 401) {
    return AuditAction.AUTH_FAILED;
  }
  if (statusCode === 403) {
    return AuditAction.SECURITY_PERMISSION_DENIED;
  }
  if (procedure && PROCEDURE_ACTION_MAP[procedure]) {
    return PROCEDURE_ACTION_MAP[procedure];
  }
  if (isSensitiveRead) {
    return AuditAction.DATA_ACCESS;
  }
  return AuditAction.DATA_ACCESS;
}

function resolveAuditResult(statusCode: number): AuditEntry["result"] {
  if (statusCode >= 200 && statusCode < 300) {
    return "success";
  }
  if (statusCode === 403 || statusCode === 401) {
    return "denied";
  }
  return "failure";
}

// ─── SOC 2 Audit Logger Middleware ────────────────────────────────────────────

/**
 * Extended audit logging middleware for Hono/tRPC.
 *
 * Captures:
 * - All mutation requests (POST/PUT/PATCH/DELETE)
 * - Sensitive read operations (data exports, compliance reports)
 * - Auth events (login, logout, failures)
 * - Admin actions (config changes, role changes)
 *
 * Produces structured log entries suitable for SOC 2 audit requirements.
 */
export function soc2AuditMiddleware(): (
  c: Context,
  next: Next
) => Promise<undefined | Response | undefined> {
  return async (
    c: Context,
    next: Next
  ): Promise<undefined | Response | undefined> => {
    const method = c.req.method;
    const procedure = extractTrpcPath(c.req.path);
    const isMutation =
      method === "POST" ||
      method === "PUT" ||
      method === "PATCH" ||
      method === "DELETE";
    const isSensitiveRead = procedure
      ? SENSITIVE_READ_PROCEDURES.has(procedure)
      : false;

    // Only audit mutations and sensitive reads
    if (!(isMutation || isSensitiveRead)) {
      await next();
      return;
    }

    const startTime = Date.now();

    await next();

    const userId = (c.get("userId") as string | undefined) ?? "system";
    const orgId = c.get("orgId") as string | undefined;

    // Skip if no org context (public endpoints)
    if (!orgId) {
      return;
    }

    const statusCode = c.res.status;
    const duration = Date.now() - startTime;
    const clientIp =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    const action = resolveAuditAction(procedure, isSensitiveRead, statusCode);
    const result = resolveAuditResult(statusCode);

    const entry: AuditEntry = {
      action,
      actor: userId,
      resource: procedure ? extractResourceFromProcedure(procedure) : "unknown",
      resourceId: procedure,
      timestamp: new Date().toISOString(),
      orgId,
      ip: clientIp,
      result,
      details: {
        method,
        path: c.req.path,
        procedure,
        statusCode,
        durationMs: duration,
        userAgent: c.req.header("user-agent"),
      },
    };

    // Structured log output for SIEM ingestion
    logger.info(
      {
        action: entry.action,
        actor: entry.actor,
        resource: entry.resource,
        resourceId: entry.resourceId,
        orgId: entry.orgId,
        ip: entry.ip,
        result: entry.result,
        statusCode,
        durationMs: duration,
      },
      "SOC2 audit event"
    );

    persistAuditEntry(entry);
  };
}
