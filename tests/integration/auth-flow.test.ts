/**
 * Integration tests: Auth context creation and RBAC checks.
 *
 * Verifies auth context propagation, role permission resolution,
 * org-scoped access control, and session lifecycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures } from "./setup";

const { mockLogger } = vi.hoisted(() => {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = () => logger;
  return { mockLogger: logger };
});

vi.mock("@prometheus/logger", () => ({
  createLogger: () => mockLogger,
}));

// ---------------------------------------------------------------------------
// Auth context creation helpers (simulating middleware behavior)
// ---------------------------------------------------------------------------

interface AuthContext {
  expiresAt: Date;
  orgId: string;
  role: "owner" | "admin" | "member" | "viewer";
  sessionToken: string;
  userId: string;
}

function createAuthContext(
  userId: string,
  orgId: string,
  role: AuthContext["role"],
  expiresInMs = 3_600_000
): AuthContext {
  return {
    userId,
    orgId,
    role,
    sessionToken: `tok_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    expiresAt: new Date(Date.now() + expiresInMs),
  };
}

function isAuthValid(ctx: AuthContext): boolean {
  return ctx.expiresAt.getTime() > Date.now();
}

interface RbacPolicy {
  action: "read" | "write" | "delete" | "admin";
  resource: string;
  role: AuthContext["role"];
}

const RBAC_RULES: Record<string, Set<string>> = {
  owner: new Set([
    "projects:read",
    "projects:write",
    "projects:delete",
    "sessions:read",
    "sessions:write",
    "tasks:read",
    "tasks:write",
    "billing:read",
    "billing:write",
    "members:admin",
    "settings:write",
  ]),
  admin: new Set([
    "projects:read",
    "projects:write",
    "sessions:read",
    "sessions:write",
    "tasks:read",
    "tasks:write",
    "billing:read",
    "members:admin",
    "settings:write",
  ]),
  member: new Set([
    "projects:read",
    "sessions:read",
    "sessions:write",
    "tasks:read",
    "tasks:write",
  ]),
  viewer: new Set(["projects:read", "sessions:read", "tasks:read"]),
};

function checkRbac(policy: RbacPolicy): boolean {
  const perms = RBAC_RULES[policy.role];
  if (!perms) {
    return false;
  }
  return perms.has(`${policy.resource}:${policy.action}`);
}

function scopeQueryToOrg<T extends { orgId: string }>(
  items: T[],
  authCtx: AuthContext
): T[] {
  return items.filter((item) => item.orgId === authCtx.orgId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth flow integration", () => {
  let fixturesA: ReturnType<typeof createIntegrationFixtures>;
  let fixturesB: ReturnType<typeof createIntegrationFixtures>;

  beforeEach(() => {
    fixturesA = createIntegrationFixtures({ orgPlan: "pro" });
    fixturesB = createIntegrationFixtures({ orgPlan: "team" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("auth context creation", () => {
    it("creates a valid auth context from user and org", () => {
      const ctx = createAuthContext(
        fixturesA.user.id,
        fixturesA.org.id,
        "member"
      );

      expect(ctx.userId).toBe(fixturesA.user.id);
      expect(ctx.orgId).toBe(fixturesA.org.id);
      expect(ctx.role).toBe("member");
      expect(isAuthValid(ctx)).toBe(true);
    });

    it("rejects expired auth context", () => {
      const ctx = createAuthContext(
        fixturesA.user.id,
        fixturesA.org.id,
        "member",
        -1000 // expired 1 second ago
      );

      expect(isAuthValid(ctx)).toBe(false);
    });

    it("auth context carries correct org scope for all roles", () => {
      const roles: AuthContext["role"][] = [
        "owner",
        "admin",
        "member",
        "viewer",
      ];
      for (const role of roles) {
        const ctx = createAuthContext(
          fixturesA.user.id,
          fixturesA.org.id,
          role
        );
        expect(ctx.orgId).toBe(fixturesA.org.id);
        expect(ctx.role).toBe(role);
      }
    });
  });

  describe("RBAC permission checks", () => {
    it("owner can perform all operations", () => {
      expect(
        checkRbac({ role: "owner", resource: "projects", action: "delete" })
      ).toBe(true);
      expect(
        checkRbac({ role: "owner", resource: "billing", action: "write" })
      ).toBe(true);
      expect(
        checkRbac({ role: "owner", resource: "members", action: "admin" })
      ).toBe(true);
      expect(
        checkRbac({ role: "owner", resource: "settings", action: "write" })
      ).toBe(true);
    });

    it("member cannot delete projects or manage billing", () => {
      expect(
        checkRbac({ role: "member", resource: "projects", action: "delete" })
      ).toBe(false);
      expect(
        checkRbac({ role: "member", resource: "billing", action: "write" })
      ).toBe(false);
      expect(
        checkRbac({ role: "member", resource: "billing", action: "read" })
      ).toBe(false);
    });

    it("viewer has read-only access", () => {
      expect(
        checkRbac({ role: "viewer", resource: "projects", action: "read" })
      ).toBe(true);
      expect(
        checkRbac({ role: "viewer", resource: "sessions", action: "read" })
      ).toBe(true);
      expect(
        checkRbac({ role: "viewer", resource: "tasks", action: "write" })
      ).toBe(false);
      expect(
        checkRbac({ role: "viewer", resource: "sessions", action: "write" })
      ).toBe(false);
    });

    it("admin can manage projects but not delete them", () => {
      expect(
        checkRbac({ role: "admin", resource: "projects", action: "write" })
      ).toBe(true);
      expect(
        checkRbac({ role: "admin", resource: "projects", action: "delete" })
      ).toBe(false);
      expect(
        checkRbac({ role: "admin", resource: "billing", action: "write" })
      ).toBe(false);
    });

    it("rejects unknown roles", () => {
      expect(
        checkRbac({
          role: "hacker" as AuthContext["role"],
          resource: "projects",
          action: "read",
        })
      ).toBe(false);
    });
  });

  describe("org-scoped query isolation", () => {
    it("queries only return data for the authenticated org", () => {
      const allProjects = [
        { id: fixturesA.project.id, orgId: fixturesA.org.id, name: "Proj A" },
        { id: fixturesB.project.id, orgId: fixturesB.org.id, name: "Proj B" },
      ];

      const ctxA = createAuthContext(
        fixturesA.user.id,
        fixturesA.org.id,
        "member"
      );
      const ctxB = createAuthContext(
        fixturesB.user.id,
        fixturesB.org.id,
        "member"
      );

      const resultA = scopeQueryToOrg(allProjects, ctxA);
      const resultB = scopeQueryToOrg(allProjects, ctxB);

      expect(resultA).toHaveLength(1);
      expect(resultA[0].orgId).toBe(fixturesA.org.id);
      expect(resultB).toHaveLength(1);
      expect(resultB[0].orgId).toBe(fixturesB.org.id);
    });

    it("org A auth context cannot access org B sessions", () => {
      const allSessions = [
        {
          id: fixturesA.session.id,
          orgId: fixturesA.org.id,
          projectId: fixturesA.project.id,
        },
        {
          id: fixturesB.session.id,
          orgId: fixturesB.org.id,
          projectId: fixturesB.project.id,
        },
      ];

      const ctxA = createAuthContext(
        fixturesA.user.id,
        fixturesA.org.id,
        "owner"
      );
      const scoped = scopeQueryToOrg(allSessions, ctxA);

      expect(scoped).toHaveLength(1);
      expect(scoped[0].id).toBe(fixturesA.session.id);
    });

    it("empty result for org with no matching data", () => {
      const allProjects = [
        { id: fixturesA.project.id, orgId: fixturesA.org.id, name: "Proj A" },
      ];

      const ctxB = createAuthContext(
        fixturesB.user.id,
        fixturesB.org.id,
        "member"
      );
      const result = scopeQueryToOrg(allProjects, ctxB);

      expect(result).toHaveLength(0);
    });
  });

  describe("session lifecycle", () => {
    it("creates auth context with default 1-hour expiry", () => {
      const ctx = createAuthContext(
        fixturesA.user.id,
        fixturesA.org.id,
        "member"
      );

      const oneHourFromNow = Date.now() + 3_600_000;
      // Should expire within a few ms of 1 hour from now
      expect(ctx.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(ctx.expiresAt.getTime()).toBeLessThanOrEqual(oneHourFromNow + 100);
    });

    it("session tokens are unique per creation", () => {
      const ctx1 = createAuthContext(
        fixturesA.user.id,
        fixturesA.org.id,
        "member"
      );
      const ctx2 = createAuthContext(
        fixturesA.user.id,
        fixturesA.org.id,
        "member"
      );

      expect(ctx1.sessionToken).not.toBe(ctx2.sessionToken);
    });
  });
});
