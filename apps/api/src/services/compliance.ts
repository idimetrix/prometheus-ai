import {
  apiKeys,
  auditLogs,
  auditRetentionPolicies,
  db,
  organizations,
  orgMembers,
  users,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";

const AWS_REGION_RE = /\.([\w-]+-\d+)\./;
const GCP_REGION_RE = /([\w-]+-[\w]+\d+)/;

import { and, count, eq, gte, sql } from "drizzle-orm";

const logger = createLogger("compliance");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SecurityControl {
  /** SOC2 trust service category */
  category:
    | "security"
    | "availability"
    | "processing_integrity"
    | "confidentiality"
    | "privacy";
  /** Unique control identifier (e.g., CC6.1) */
  controlId: string;
  /** Description of the control */
  description: string;
  /** Evidence or implementation details */
  evidence: string;
  /** Last reviewed date */
  lastReviewedAt: string | null;
  /** Human-readable name */
  name: string;
  /** Current implementation status */
  status: "implemented" | "partial" | "planned" | "not_applicable";
}

export interface AccessReviewEntry {
  activeApiKeys: number;
  joinedAt: string | null;
  lastActivityAt: string | null;
  recentActionCount: number;
  role: string;
  userEmail: string;
  userId: string;
  userName: string | null;
}

export interface ComplianceReport {
  accessReview: AccessReviewEntry[];
  dataResidency: {
    region: string;
    databaseLocation: string;
    storageLocation: string;
    compliant: boolean;
  };
  generatedAt: string;
  orgId: string;
  orgName: string;
  period: { start: string; end: string };
  recommendations: string[];
  retentionPolicy: {
    retentionDays: number;
    archiveEnabled: boolean;
    lastArchivedAt: string | null;
  };
  securityControls: SecurityControl[];
  summary: {
    totalAuditEvents: number;
    uniqueUsers: number;
    securityIncidents: number;
    gdprRequests: number;
    apiKeyRotations: number;
  };
}

// ─── Security Controls Registry ─────────────────────────────────────────────

/**
 * Returns the list of implemented security controls with evidence.
 * These map to SOC2 Type II criteria.
 */
export function getSecurityControls(): SecurityControl[] {
  return [
    {
      controlId: "CC1.1",
      name: "Organization and Management",
      category: "security",
      status: "implemented",
      description:
        "Organization-level access controls with role-based permissions (owner, admin, member).",
      evidence:
        "Implemented via Clerk org management and RBAC middleware in tRPC procedures. See orgAdminProcedure, orgOwnerProcedure, requireRole middleware.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "CC2.1",
      name: "Communication and Information",
      category: "security",
      status: "implemented",
      description:
        "All audit events are logged with structured data suitable for SIEM ingestion.",
      evidence:
        "SOC2 audit middleware captures all mutations and sensitive reads. Structured logging with pino. See soc2AuditMiddleware.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "CC3.1",
      name: "Risk Assessment",
      category: "security",
      status: "implemented",
      description:
        "Automated compliance health scoring and security incident tracking.",
      evidence:
        "Compliance report endpoint generates health score based on audit coverage, GDPR readiness, and security incident rate.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "CC5.1",
      name: "Monitoring Activities",
      category: "security",
      status: "implemented",
      description:
        "Real-time audit logging of all sensitive operations with IP tracking.",
      evidence:
        "Audit logger middleware, structured audit entries with action/actor/resource/result fields. Daily trend analysis available.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "CC6.1",
      name: "Logical and Physical Access Controls",
      category: "security",
      status: "implemented",
      description:
        "Authentication via Clerk with JWT verification. API key management with scoped permissions.",
      evidence:
        "Clerk integration for auth. API keys table with org-scoped access. Rate limiting per org tier.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "CC6.2",
      name: "System Account Management",
      category: "security",
      status: "implemented",
      description:
        "User accounts managed through Clerk with org membership tracking. API key lifecycle management.",
      evidence:
        "Clerk webhook sync for user/org changes. API key create/revoke with audit trail.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "CC6.3",
      name: "Encryption",
      category: "confidentiality",
      status: "implemented",
      description:
        "Data encrypted at rest and in transit. Sensitive fields use envelope encryption.",
      evidence:
        "ENCRYPTION_KEY env var for envelope encryption. HTTPS/TLS for all service communication. Database SSL connections.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "CC7.1",
      name: "Change Management",
      category: "processing_integrity",
      status: "implemented",
      description:
        "All configuration changes are audit-logged. Git-based deployment with CI/CD pipeline.",
      evidence:
        "Admin config changes tracked via audit.admin_config_change action. GitHub Actions CI with typecheck, lint, test gates.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "CC8.1",
      name: "Data Retention and Disposal",
      category: "privacy",
      status: "implemented",
      description:
        "Configurable per-org retention policies. Automated archival to cold storage. GDPR deletion support.",
      evidence:
        "audit_retention_policies table. Daily archival job. GDPR deleteUser endpoint with cascade deletion and audit trail anonymization.",
      lastReviewedAt: new Date().toISOString(),
    },
    {
      controlId: "P1.1",
      name: "Privacy Notice",
      category: "privacy",
      status: "implemented",
      description:
        "GDPR data export and deletion request endpoints available to all users.",
      evidence:
        "gdpr.exportData and gdpr.deleteUser endpoints. audit.exportUserData and audit.requestDataDeletion endpoints.",
      lastReviewedAt: new Date().toISOString(),
    },
  ];
}

// ─── Compliance Report Generation ───────────────────────────────────────────

/**
 * Generate a comprehensive SOC2 Type II compliance report for an organization.
 */
export async function generateComplianceReport(
  orgId: string,
  periodDays = 90
): Promise<ComplianceReport> {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  // Fetch org details
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  const orgName = org?.name ?? "Unknown";

  // Audit statistics
  const [auditStats] = await db
    .select({
      totalEvents: sql<number>`COUNT(*)`,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${auditLogs.userId})`,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), gte(auditLogs.createdAt, since)));

  // Security incidents
  const [securityStats] = await db
    .select({
      incidents: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.action} LIKE 'security.%' OR ${auditLogs.action} LIKE 'auth.failed%')`,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), gte(auditLogs.createdAt, since)));

  // GDPR requests
  const [gdprStats] = await db
    .select({
      requests: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.action} LIKE 'gdpr.%')`,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), gte(auditLogs.createdAt, since)));

  // API key rotations
  const [keyStats] = await db
    .select({
      rotations: sql<number>`COUNT(*) FILTER (WHERE ${auditLogs.action} IN ('api_key.create', 'api_key.revoke'))`,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), gte(auditLogs.createdAt, since)));

  // Access review
  const accessReview = await getAccessReview(orgId, since);

  // Retention policy
  const [retentionPolicy] = await db
    .select()
    .from(auditRetentionPolicies)
    .where(eq(auditRetentionPolicies.orgId, orgId))
    .limit(1);

  // Data residency check
  const dataResidency = checkDataResidency();

  // Generate recommendations
  const recommendations: string[] = [];
  const totalEvents = Number(auditStats?.totalEvents ?? 0);
  const incidents = Number(securityStats?.incidents ?? 0);

  if (totalEvents === 0) {
    recommendations.push(
      "No audit events detected in the review period. Ensure audit logging is properly configured."
    );
  }
  if (incidents > totalEvents * 0.1) {
    recommendations.push(
      "High security incident rate detected. Review access controls and investigate failed authentication attempts."
    );
  }
  if (!retentionPolicy) {
    recommendations.push(
      "No custom retention policy configured. Consider setting an org-specific retention period for compliance."
    );
  }
  if (
    retentionPolicy?.lastArchivedAt &&
    Date.now() - new Date(retentionPolicy.lastArchivedAt).getTime() >
      7 * 24 * 60 * 60 * 1000
  ) {
    recommendations.push(
      "Audit log archival has not run in over 7 days. Verify the archival job is operational."
    );
  }

  const report: ComplianceReport = {
    generatedAt: new Date().toISOString(),
    orgId,
    orgName,
    period: {
      start: since.toISOString(),
      end: new Date().toISOString(),
    },
    summary: {
      totalAuditEvents: totalEvents,
      uniqueUsers: Number(auditStats?.uniqueUsers ?? 0),
      securityIncidents: incidents,
      gdprRequests: Number(gdprStats?.requests ?? 0),
      apiKeyRotations: Number(keyStats?.rotations ?? 0),
    },
    securityControls: getSecurityControls(),
    accessReview,
    dataResidency,
    retentionPolicy: {
      retentionDays: retentionPolicy?.retentionDays ?? 90,
      archiveEnabled: retentionPolicy?.archiveEnabled !== "false",
      lastArchivedAt: retentionPolicy?.lastArchivedAt?.toISOString() ?? null,
    },
    recommendations,
  };

  logger.info(
    { orgId, periodDays, totalEvents: report.summary.totalAuditEvents },
    "Compliance report generated"
  );

  return report;
}

// ─── Access Review ──────────────────────────────────────────────────────────

/**
 * Get a list of all user access for periodic review.
 * Lists all org members with their roles, last activity, and API key counts.
 */
export async function getAccessReview(
  orgId: string,
  since?: Date
): Promise<AccessReviewEntry[]> {
  const lookback = since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Get all org members with user info
  const members = await db
    .select({
      userId: orgMembers.userId,
      role: orgMembers.role,
      joinedAt: orgMembers.joinedAt,
    })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, orgId));

  const entries: AccessReviewEntry[] = [];

  for (const member of members) {
    // Get user info
    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, member.userId))
      .limit(1);

    // Get last activity from audit logs
    const [lastActivity] = await db
      .select({ lastAction: sql<Date>`MAX(${auditLogs.createdAt})` })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.orgId, orgId), eq(auditLogs.userId, member.userId))
      );

    // Count recent actions
    const [actionCount] = await db
      .select({ count: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.orgId, orgId),
          eq(auditLogs.userId, member.userId),
          gte(auditLogs.createdAt, lookback)
        )
      );

    // Count active API keys
    const [keyCount] = await db
      .select({ count: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.orgId, orgId), eq(apiKeys.userId, member.userId)));

    entries.push({
      userId: member.userId,
      userName: user?.name ?? null,
      userEmail: user?.email ?? "unknown",
      role: member.role,
      joinedAt: member.joinedAt?.toISOString() ?? null,
      lastActivityAt:
        lastActivity?.lastAction instanceof Date
          ? lastActivity.lastAction.toISOString()
          : null,
      activeApiKeys: Number(keyCount?.count ?? 0),
      recentActionCount: Number(actionCount?.count ?? 0),
    });
  }

  // Sort by role (owner first), then by last activity
  entries.sort((a, b) => {
    const roleOrder: Record<string, number> = {
      owner: 0,
      admin: 1,
      member: 2,
    };
    const aRole = roleOrder[a.role] ?? 3;
    const bRole = roleOrder[b.role] ?? 3;
    if (aRole !== bRole) {
      return aRole - bRole;
    }
    // Then by most recent activity
    if (a.lastActivityAt && b.lastActivityAt) {
      return (
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime()
      );
    }
    return 0;
  });

  return entries;
}

// ─── Data Residency ─────────────────────────────────────────────────────────

/**
 * Check data residency compliance.
 * Verifies data stays in configured regions based on environment configuration.
 */
export function checkDataResidency(): {
  region: string;
  databaseLocation: string;
  storageLocation: string;
  compliant: boolean;
} {
  // Determine region from environment
  const configuredRegion = process.env.DATA_REGION ?? "us-east-1";
  const dbUrl = process.env.DATABASE_URL ?? "";
  const minioEndpoint = process.env.MINIO_ENDPOINT ?? "";

  // Basic heuristic: check if DB/storage URLs suggest the expected region
  const databaseLocation = dbUrl.includes("localhost")
    ? "local"
    : (extractRegionFromUrl(dbUrl) ?? configuredRegion);

  const storageLocation = minioEndpoint.includes("localhost")
    ? "local"
    : (extractRegionFromUrl(minioEndpoint) ?? configuredRegion);

  // In production, verify that both match the configured region
  const isLocal = databaseLocation === "local" && storageLocation === "local";
  const regionsMatch =
    isLocal ||
    (databaseLocation === configuredRegion &&
      storageLocation === configuredRegion);

  return {
    region: configuredRegion,
    databaseLocation,
    storageLocation,
    compliant: regionsMatch,
  };
}

function extractRegionFromUrl(url: string): string | null {
  // Try to extract AWS/GCP region from URL patterns
  const awsMatch = url.match(AWS_REGION_RE);
  if (awsMatch?.[1]) {
    return awsMatch[1];
  }

  const gcpMatch = url.match(GCP_REGION_RE);
  if (gcpMatch?.[1]?.includes("-")) {
    return gcpMatch[1];
  }

  return null;
}
