/**
 * Permission Checker.
 *
 * Before each tool execution, checks the permission table to determine
 * whether the agent is allowed to use the tool. Handles three permission
 * levels: allowed, ask (checkpoint), and denied.
 *
 * Supports optional conditions like path patterns and limits.
 */
import { agentPermissions, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq } from "drizzle-orm";
import { minimatch } from "minimatch";

const logger = createLogger("orchestrator:guardian:permission-checker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionLevel = "allowed" | "ask" | "denied";

export interface PermissionCheckResult {
  /** Whether the tool is allowed to execute */
  allowed: boolean;
  /** Whether a condition was evaluated */
  conditionEvaluated: boolean;
  /** The resolved permission level */
  permission: PermissionLevel;
  /** Reason for denial (if denied) */
  reason?: string;
  /** Whether the agent should wait for user approval */
  requiresApproval: boolean;
  /** The tool name that was checked */
  toolName: string;
}

export interface ToolExecutionContext {
  /** Arguments passed to the tool */
  args?: Record<string, unknown>;
  /** File path involved (for file operations) */
  filePath?: string;
  /** Organization ID */
  orgId: string;
  /** Project ID */
  projectId: string;
  /** Name of the tool being executed */
  toolName: string;
}

interface PermissionConditions {
  /** Allowed directories */
  allowedDirs?: string[];
  /** Denied directories */
  deniedDirs?: string[];
  /** Maximum number of files that can be affected */
  maxFiles?: number;
  /** Glob pattern for allowed file paths */
  pathPattern?: string;
}

// ---------------------------------------------------------------------------
// Default Permissions
// ---------------------------------------------------------------------------

const DEFAULT_PERMISSIONS: Record<string, PermissionLevel> = {
  file_read: "allowed",
  file_write: "ask",
  file_delete: "ask",
  terminal: "ask",
  git_commit: "ask",
  git_push: "denied",
  git_create_pr: "ask",
  git_force_push: "denied",
  deployment: "denied",
  env_modify: "denied",
};

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

interface PermissionAuditEntry {
  allowed: boolean;
  conditions?: PermissionConditions;
  orgId: string;
  permission: PermissionLevel;
  projectId: string;
  reason?: string;
  timestamp: Date;
  toolName: string;
}

// ---------------------------------------------------------------------------
// Permission Checker
// ---------------------------------------------------------------------------

export class PermissionChecker {
  private readonly auditLog: PermissionAuditEntry[] = [];
  private readonly cache = new Map<
    string,
    {
      permission: PermissionLevel;
      conditions: PermissionConditions | null;
      expiresAt: number;
    }
  >();

  /** Cache TTL in ms */
  private static readonly CACHE_TTL = 60_000;

  /**
   * Check whether a tool is allowed to execute.
   */
  async check(context: ToolExecutionContext): Promise<PermissionCheckResult> {
    const { toolName, projectId, orgId } = context;

    logger.debug(
      { toolName, projectId },
      "Checking permission for tool execution"
    );

    // Load the permission from DB (with cache)
    const { permission, conditions } = await this.loadPermission(
      projectId,
      orgId,
      toolName
    );

    // Evaluate conditions if present
    let conditionEvaluated = false;
    if (permission === "allowed" && conditions) {
      const conditionResult = this.evaluateConditions(conditions, context);
      conditionEvaluated = true;

      if (!conditionResult.passed) {
        const result: PermissionCheckResult = {
          allowed: false,
          requiresApproval: true,
          reason: conditionResult.reason,
          permission: "ask",
          toolName,
          conditionEvaluated: true,
        };

        this.recordAudit(
          context,
          "ask",
          false,
          conditionResult.reason,
          conditions
        );
        return result;
      }
    }

    const result = this.buildResult(permission, toolName, conditionEvaluated);
    this.recordAudit(context, permission, result.allowed, result.reason);
    return result;
  }

  /**
   * Load permission from database with short-lived cache.
   */
  private async loadPermission(
    projectId: string,
    orgId: string,
    toolName: string
  ): Promise<{
    permission: PermissionLevel;
    conditions: PermissionConditions | null;
  }> {
    const cacheKey = `${projectId}:${orgId}:${toolName}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return { permission: cached.permission, conditions: cached.conditions };
    }

    try {
      const row = await db.query.agentPermissions.findFirst({
        where: and(
          eq(agentPermissions.projectId, projectId),
          eq(agentPermissions.orgId, orgId),
          eq(agentPermissions.toolName, toolName)
        ),
      });

      const permission = (row?.permission ??
        DEFAULT_PERMISSIONS[toolName] ??
        "ask") as PermissionLevel;
      const conditions =
        (row?.conditions as PermissionConditions | null) ?? null;

      // Cache the result
      this.cache.set(cacheKey, {
        permission,
        conditions,
        expiresAt: Date.now() + PermissionChecker.CACHE_TTL,
      });

      return { permission, conditions };
    } catch (error) {
      logger.error(
        { toolName, projectId, error: String(error) },
        "Failed to load permission, falling back to default"
      );

      const defaultPermission = DEFAULT_PERMISSIONS[toolName] ?? "ask";
      return { permission: defaultPermission, conditions: null };
    }
  }

  /**
   * Evaluate conditions against the tool execution context.
   */
  private evaluateConditions(
    conditions: PermissionConditions,
    context: ToolExecutionContext
  ): { passed: boolean; reason?: string } {
    // Check path pattern
    if (
      conditions.pathPattern &&
      context.filePath &&
      !minimatch(context.filePath, conditions.pathPattern)
    ) {
      return {
        passed: false,
        reason: `File path '${context.filePath}' does not match allowed pattern '${conditions.pathPattern}'`,
      };
    }

    // Check denied directories
    if (conditions.deniedDirs && context.filePath) {
      for (const dir of conditions.deniedDirs) {
        if (context.filePath.startsWith(dir)) {
          return {
            passed: false,
            reason: `File path '${context.filePath}' is in denied directory '${dir}'`,
          };
        }
      }
    }

    // Check allowed directories
    if (conditions.allowedDirs && context.filePath) {
      const inAllowedDir = conditions.allowedDirs.some((dir) =>
        context.filePath?.startsWith(dir)
      );
      if (!inAllowedDir) {
        return {
          passed: false,
          reason: `File path '${context.filePath}' is not in any allowed directory`,
        };
      }
    }

    return { passed: true };
  }

  /**
   * Build the permission check result from the resolved permission level.
   */
  private buildResult(
    permission: PermissionLevel,
    toolName: string,
    conditionEvaluated: boolean
  ): PermissionCheckResult {
    switch (permission) {
      case "allowed":
        return {
          allowed: true,
          requiresApproval: false,
          permission: "allowed",
          toolName,
          conditionEvaluated,
        };

      case "ask":
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Tool '${toolName}' requires user approval before execution`,
          permission: "ask",
          toolName,
          conditionEvaluated,
        };

      case "denied":
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Tool '${toolName}' is denied by project permissions`,
          permission: "denied",
          toolName,
          conditionEvaluated,
        };

      default:
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Unknown permission level for tool '${toolName}'`,
          permission: "ask",
          toolName,
          conditionEvaluated,
        };
    }
  }

  /**
   * Record a permission check in the audit log.
   */
  private recordAudit(
    context: ToolExecutionContext,
    permission: PermissionLevel,
    allowed: boolean,
    reason?: string,
    conditions?: PermissionConditions
  ): void {
    const entry: PermissionAuditEntry = {
      timestamp: new Date(),
      toolName: context.toolName,
      projectId: context.projectId,
      orgId: context.orgId,
      permission,
      allowed,
      reason,
      conditions: conditions ?? undefined,
    };

    this.auditLog.push(entry);

    // Trim audit log to prevent unbounded growth
    if (this.auditLog.length > 1000) {
      this.auditLog.splice(0, this.auditLog.length - 1000);
    }

    logger.info(
      {
        toolName: context.toolName,
        projectId: context.projectId,
        permission,
        allowed,
        reason,
      },
      "Permission check recorded"
    );
  }

  /**
   * Get the audit log of all permission checks.
   */
  getAuditLog(): PermissionAuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Clear the permission cache (e.g., when permissions are updated).
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear cache for a specific project.
   */
  clearCacheForProject(projectId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
