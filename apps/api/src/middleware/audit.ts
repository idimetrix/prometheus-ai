import { auditLogs, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { Context, Next } from "hono";

const logger = createLogger("api:audit");

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface AuditEntry {
  action: string;
  method: string;
  orgId?: string;
  path: string;
  statusCode: number;
  timestamp: string;
  userId?: string;
}

export function auditMiddleware() {
  return async (c: Context, next: Next) => {
    if (!MUTATION_METHODS.has(c.req.method)) {
      return next();
    }

    await next();

    const entry: AuditEntry = {
      action: `${c.req.method} ${c.req.routePath ?? c.req.path}`,
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      userId: c.get("userId") as string | undefined,
      orgId: c.get("orgId") as string | undefined,
      timestamp: new Date().toISOString(),
    };

    logger.info(entry, "Audit log");

    const orgId = entry.orgId;
    if (orgId) {
      const resourceType = extractResourceType(entry.path);
      const resourceId = extractResourceId(entry.path);

      // Fire-and-forget: write audit log to DB without blocking the response
      db.insert(auditLogs)
        .values({
          id: generateId(),
          orgId,
          userId: entry.userId ?? null,
          action: entry.action,
          resource: resourceType,
          resourceId: resourceId ?? null,
          details: {
            method: entry.method,
            path: entry.path,
            statusCode: entry.statusCode,
          },
          ipAddress: c.req.header("x-forwarded-for") ?? null,
        })
        .then(() => {
          logger.debug({ action: entry.action }, "Audit log persisted");
        })
        .catch((err: unknown) => {
          logger.error(
            { err, action: entry.action },
            "Failed to persist audit log"
          );
        });
    }
  };
}

function extractResourceType(path: string): string {
  const parts = path.split("/").filter(Boolean);
  // /api/trpc/projects.create -> projects
  // /api/settings/keys -> settings
  if (parts.includes("trpc")) {
    const procedurePart = parts[parts.indexOf("trpc") + 1];
    if (procedurePart) {
      return procedurePart.split(".")[0] ?? "unknown";
    }
  }
  return parts[1] ?? "unknown";
}

function extractResourceId(path: string): string | undefined {
  const parts = path.split("/").filter(Boolean);
  // Look for UUID-like segments
  for (const part of parts) {
    if (part.length > 10 && !part.includes(".")) {
      return part;
    }
  }
  return undefined;
}
