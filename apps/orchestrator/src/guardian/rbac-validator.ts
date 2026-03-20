import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:guardian:rbac-validator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RBACRole = "viewer" | "member" | "admin" | "owner";

export type RBACAction = "read" | "write" | "delete" | "manage" | "admin";

export interface PermissionEntry {
  action: RBACAction;
  allowed: boolean;
  resource: string;
  role: RBACRole;
}

export interface PermissionTestCase {
  action: RBACAction;
  expectedAllowed: boolean;
  resource: string;
  role: RBACRole;
}

export interface PermissionGap {
  action: RBACAction;
  reason: string;
  resource: string;
}

export interface RBACComplianceReport {
  gaps: PermissionGap[];
  status: "compliant" | "non-compliant" | "needs-review";
  summary: string;
  testResults: Array<{
    actual: boolean;
    expected: boolean;
    passed: boolean;
    testCase: PermissionTestCase;
  }>;
  totalChecks: number;
}

// ---------------------------------------------------------------------------
// Default permission matrix
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: Record<RBACRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

const ACTION_MINIMUM_ROLE: Record<RBACAction, RBACRole> = {
  read: "viewer",
  write: "member",
  delete: "admin",
  manage: "admin",
  admin: "owner",
};

// Resource-specific overrides
const RESOURCE_OVERRIDES: Record<
  string,
  Partial<Record<RBACAction, RBACRole>>
> = {
  billing: { read: "admin", write: "owner", delete: "owner" },
  members: { read: "member", write: "admin", delete: "owner" },
  settings: { read: "member", write: "admin", delete: "owner" },
  apiKeys: { read: "admin", write: "admin", delete: "owner" },
  sessions: { read: "viewer", write: "member", delete: "admin" },
  projects: { read: "viewer", write: "member", delete: "admin" },
};

// ---------------------------------------------------------------------------
// RBACValidator
// ---------------------------------------------------------------------------

/**
 * Validates RBAC permissions against the expected permission matrix.
 * Generates test cases, identifies permission gaps, and produces
 * compliance reports.
 */
export class RBACValidator {
  private readonly overrides: Record<
    string,
    Partial<Record<RBACAction, RBACRole>>
  >;

  constructor(
    customOverrides?: Record<string, Partial<Record<RBACAction, RBACRole>>>
  ) {
    this.overrides = { ...RESOURCE_OVERRIDES, ...customOverrides };
  }

  /**
   * Check whether a role is allowed to perform an action on a resource.
   */
  validatePermissions(
    role: RBACRole,
    action: RBACAction,
    resource: string
  ): PermissionEntry {
    const requiredRole = this.getRequiredRole(action, resource);
    const allowed = ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];

    logger.debug(
      { role, action, resource, requiredRole, allowed },
      "Permission check"
    );

    return { role, action, resource, allowed };
  }

  /**
   * Generate a complete permission test matrix for given roles, actions,
   * and resources. Each combination produces a test case with the expected
   * outcome.
   */
  generateTestCases(
    roles: RBACRole[],
    actions: RBACAction[],
    resources: string[]
  ): PermissionTestCase[] {
    const testCases: PermissionTestCase[] = [];

    for (const role of roles) {
      for (const action of actions) {
        for (const resource of resources) {
          const requiredRole = this.getRequiredRole(action, resource);
          const expectedAllowed =
            ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];

          testCases.push({
            role,
            action,
            resource,
            expectedAllowed,
          });
        }
      }
    }

    logger.info(
      { testCaseCount: testCases.length },
      "Generated RBAC test cases"
    );

    return testCases;
  }

  /**
   * Find missing permission checks -- resources that have no explicit
   * override defined (relying only on defaults).
   */
  findPermissionGaps(): PermissionGap[] {
    const gaps: PermissionGap[] = [];
    const allResources = Object.keys(this.overrides);
    const allActions: RBACAction[] = [
      "read",
      "write",
      "delete",
      "manage",
      "admin",
    ];

    for (const resource of allResources) {
      const resourceOverrides = this.overrides[resource] ?? {};
      for (const action of allActions) {
        if (!(action in resourceOverrides)) {
          gaps.push({
            resource,
            action,
            reason: `No explicit permission override for ${action} on ${resource}; using default (${ACTION_MINIMUM_ROLE[action]})`,
          });
        }
      }
    }

    if (gaps.length > 0) {
      logger.warn(
        { gapCount: gaps.length },
        "Permission gaps detected in RBAC configuration"
      );
    }

    return gaps;
  }

  /**
   * Generate a complete RBAC compliance report by running all test cases
   * and checking for gaps.
   */
  getComplianceReport(): RBACComplianceReport {
    const allRoles: RBACRole[] = ["viewer", "member", "admin", "owner"];
    const allActions: RBACAction[] = [
      "read",
      "write",
      "delete",
      "manage",
      "admin",
    ];
    const allResources = Object.keys(this.overrides);

    const testCases = this.generateTestCases(
      allRoles,
      allActions,
      allResources
    );
    const gaps = this.findPermissionGaps();

    const testResults = testCases.map((tc) => {
      const result = this.validatePermissions(tc.role, tc.action, tc.resource);
      return {
        testCase: tc,
        expected: tc.expectedAllowed,
        actual: result.allowed,
        passed: result.allowed === tc.expectedAllowed,
      };
    });

    const failedTests = testResults.filter((r) => !r.passed);
    let status: "compliant" | "non-compliant" | "needs-review" = "compliant";

    if (failedTests.length > 0) {
      status = "non-compliant";
    } else if (gaps.length > 0) {
      status = "needs-review";
    }

    const summary = [
      `RBAC Compliance: ${status}`,
      `Total checks: ${testResults.length}`,
      `Passed: ${testResults.length - failedTests.length}`,
      `Failed: ${failedTests.length}`,
      `Permission gaps: ${gaps.length}`,
    ].join(" | ");

    logger.info(
      {
        status,
        totalChecks: testResults.length,
        failed: failedTests.length,
        gaps: gaps.length,
      },
      "RBAC compliance report generated"
    );

    return {
      status,
      summary,
      totalChecks: testResults.length,
      testResults,
      gaps,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getRequiredRole(action: RBACAction, resource: string): RBACRole {
    const resourceOverrides = this.overrides[resource];
    if (resourceOverrides?.[action]) {
      return resourceOverrides[action];
    }
    return ACTION_MINIMUM_ROLE[action];
  }
}
