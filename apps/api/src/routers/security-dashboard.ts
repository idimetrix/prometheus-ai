import { auditLogs, projectRules } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:security-dashboard");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = "critical" | "high" | "medium" | "low" | "info";
type VulnerabilityStatus = "open" | "in_progress" | "resolved" | "dismissed";
type ScanStatus = "pending" | "running" | "completed" | "failed";

export interface ScanResult {
  completedAt: string | null;
  id: string;
  projectId: string;
  scanType: "full" | "incremental" | "dependency";
  severityCounts: Record<Severity, number>;
  startedAt: string;
  status: ScanStatus;
  triggeredBy: string;
  vulnerabilityCount: number;
}

export interface Vulnerability {
  cveId: string | null;
  cweId: string | null;
  description: string;
  detectedAt: string;
  filePath: string | null;
  id: string;
  lineNumber: number | null;
  projectId: string;
  recommendation: string;
  resolvedAt: string | null;
  scanId: string;
  severity: Severity;
  status: VulnerabilityStatus;
  title: string;
}

export interface SecurityPolicy {
  createdAt: string;
  description: string;
  enabled: boolean;
  id: string;
  name: string;
  orgId: string;
  rules: Array<{
    type: string;
    condition: string;
    action: "block" | "warn" | "audit";
  }>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory stores for scan results and vulnerabilities.
// Security scanning is performed by external integrations; these stores
// act as a local cache for the dashboard view.
// ---------------------------------------------------------------------------

const scanStore = new Map<string, ScanResult>();
const vulnerabilityStore = new Map<string, Vulnerability>();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const securityDashboardRouter = router({
  /**
   * Get the latest security scan results for a project.
   *
   * Returns the most recent scan with vulnerability counts grouped by
   * severity level.
   */
  getScanResults: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(({ input, ctx }) => {
      logger.info(
        { orgId: ctx.orgId, projectId: input.projectId },
        "Fetching security scan results"
      );

      const scans: ScanResult[] = [];

      for (const scan of scanStore.values()) {
        if (scan.projectId === input.projectId) {
          scans.push(scan);
        }
      }

      // Most recent first
      scans.sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );

      const paginated = scans.slice(0, input.limit);

      return {
        scans: paginated,
        total: scans.length,
        latestScan: paginated[0] ?? null,
      };
    }),

  /**
   * List vulnerabilities for a project with filtering by severity and status.
   */
  getVulnerabilities: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        severity: z
          .enum(["critical", "high", "medium", "low", "info"])
          .optional(),
        status: z
          .enum(["open", "in_progress", "resolved", "dismissed"])
          .optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(({ input, ctx }) => {
      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          severity: input.severity ?? "all",
          status: input.status ?? "all",
        },
        "Fetching vulnerabilities"
      );

      const vulnerabilities: Vulnerability[] = [];

      for (const vuln of vulnerabilityStore.values()) {
        if (vuln.projectId !== input.projectId) {
          continue;
        }
        if (input.severity && vuln.severity !== input.severity) {
          continue;
        }
        if (input.status && vuln.status !== input.status) {
          continue;
        }
        vulnerabilities.push(vuln);
      }

      // Sort by severity weight, then newest first
      const severityWeight: Record<Severity, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
        info: 4,
      };

      vulnerabilities.sort((a, b) => {
        const weightDiff =
          severityWeight[a.severity] - severityWeight[b.severity];
        if (weightDiff !== 0) {
          return weightDiff;
        }
        return (
          new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
        );
      });

      const paginated = vulnerabilities.slice(
        input.offset,
        input.offset + input.limit
      );

      // Compute severity summary
      const severityCounts: Record<Severity, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      };

      for (const vuln of vulnerabilities) {
        severityCounts[vuln.severity] += 1;
      }

      return {
        vulnerabilities: paginated,
        severityCounts,
        total: vulnerabilities.length,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Get security policies for the organization.
   *
   * Reads from the projectRules table filtered to type='security'.
   */
  getPolicies: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1).optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      logger.info({ orgId: ctx.orgId }, "Fetching security policies");

      const conditions = [
        eq(projectRules.orgId, ctx.orgId),
        eq(projectRules.type, "security"),
      ];

      if (input?.projectId) {
        conditions.push(eq(projectRules.projectId, input.projectId));
      }

      const rules = await ctx.db.query.projectRules.findMany({
        where: and(...conditions),
      });

      const policies: SecurityPolicy[] = rules.map((rule) => ({
        id: rule.id,
        name: rule.rule,
        description: rule.rule,
        enabled: rule.enabled,
        orgId: rule.orgId,
        rules: [],
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      }));

      // Sort by name
      policies.sort((a, b) => a.name.localeCompare(b.name));

      return { policies };
    }),

  /**
   * Update a security policy.
   *
   * Allows toggling the enabled state of a projectRule with type='security'.
   */
  updatePolicy: protectedProcedure
    .input(
      z.object({
        policyId: z.string().min(1, "Policy ID is required"),
        name: z.string().min(1).max(255).optional(),
        description: z.string().max(1000).optional(),
        enabled: z.boolean().optional(),
        rules: z
          .array(
            z.object({
              type: z.string().min(1),
              condition: z.string().min(1),
              action: z.enum(["block", "warn", "audit"]),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.projectRules.findFirst({
        where: and(
          eq(projectRules.id, input.policyId),
          eq(projectRules.orgId, ctx.orgId)
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Security policy not found",
        });
      }

      const updates: Record<string, unknown> = {};
      if (input.enabled !== undefined) {
        updates.enabled = input.enabled;
      }
      if (input.name !== undefined) {
        updates.rule = input.name;
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db
          .update(projectRules)
          .set(updates)
          .where(
            and(
              eq(projectRules.id, input.policyId),
              eq(projectRules.orgId, ctx.orgId)
            )
          );
      }

      logger.info(
        { orgId: ctx.orgId, policyId: input.policyId },
        "Security policy updated"
      );

      const policy: SecurityPolicy = {
        id: existing.id,
        name: input.name ?? existing.rule,
        description: input.description ?? existing.rule,
        enabled: input.enabled ?? existing.enabled,
        orgId: existing.orgId,
        rules: input.rules ?? [],
        createdAt: existing.createdAt.toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return policy;
    }),

  /**
   * Trigger a new security scan for a project.
   *
   * Creates an audit log entry for the scan trigger and returns a task-like
   * response. The actual scan is performed asynchronously by the external
   * scanning service.
   */
  triggerScan: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        scanType: z.enum(["full", "incremental", "dependency"]).default("full"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check for an already-running scan on this project
      for (const scan of scanStore.values()) {
        if (
          scan.projectId === input.projectId &&
          (scan.status === "pending" || scan.status === "running")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A scan is already in progress for this project",
          });
        }
      }

      const scanId = generateId("scan");
      const now = new Date().toISOString();

      // Record an audit log entry for the scan trigger
      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "security_scan.triggered",
        resource: "project",
        resourceId: input.projectId,
        details: {
          scanId,
          scanType: input.scanType,
        },
      });

      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          scanId,
          scanType: input.scanType,
          triggeredBy: ctx.auth.userId,
        },
        "Security scan triggered"
      );

      return {
        scanId,
        status: "pending" as const,
        scanType: input.scanType,
        startedAt: now,
      };
    }),
});
