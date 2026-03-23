import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  createRbacMiddleware,
  PERMISSION_LEVELS,
  type PermissionCheckParams,
  type PermissionStore,
} from "../rbac-middleware";
import type { OrgRole } from "../server";

describe("RBAC Middleware - Permission Levels", () => {
  it("exports four permission levels in ascending order", () => {
    expect(PERMISSION_LEVELS).toEqual(["viewer", "member", "admin", "owner"]);
    expect(PERMISSION_LEVELS).toHaveLength(4);
  });
});

describe("RBAC Middleware - Role Hierarchy", () => {
  // Each test creates a fresh middleware to avoid cache interference
  // (cache key does not include userRole, so same user+resource+action
  // would return cached result from a different role check)

  it("member can read resources", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "u_member_read",
      orgId: "o_member_read",
      userRole: "member" as OrgRole,
      resource: "sessions",
      action: "read",
    });
    expect(result.allowed).toBe(true);
  });

  it("viewer cannot write resources", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "u_viewer_write",
      orgId: "o_viewer_write",
      userRole: "viewer" as unknown as OrgRole,
      resource: "sessions",
      action: "write",
    });
    expect(result.allowed).toBe(false);
  });

  it("member can write but not delete", async () => {
    const rbac = createRbacMiddleware();
    const writeResult = await rbac.check({
      userId: "u_member_wd",
      orgId: "o_member_wd",
      userRole: "member" as OrgRole,
      resource: "projects",
      action: "write",
    });
    expect(writeResult.allowed).toBe(true);

    const rbac2 = createRbacMiddleware();
    const deleteResult = await rbac2.check({
      userId: "u_member_del",
      orgId: "o_member_del",
      userRole: "member" as OrgRole,
      resource: "projects",
      action: "delete",
    });
    expect(deleteResult.allowed).toBe(false);
  });

  it("admin can delete and manage", async () => {
    const rbac = createRbacMiddleware();
    const deleteResult = await rbac.check({
      userId: "u_admin_del2",
      orgId: "o_admin_del2",
      userRole: "admin" as OrgRole,
      resource: "projects",
      action: "delete",
    });
    expect(deleteResult.allowed).toBe(true);

    const rbac2 = createRbacMiddleware();
    const manageResult = await rbac2.check({
      userId: "u_admin_mgmt",
      orgId: "o_admin_mgmt",
      userRole: "admin" as OrgRole,
      resource: "projects",
      action: "manage",
    });
    expect(manageResult.allowed).toBe(true);
  });

  it("admin cannot perform admin-only actions", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "u_admin_noadm",
      orgId: "o_admin_noadm",
      userRole: "admin" as OrgRole,
      resource: "settings",
      action: "admin",
    });
    expect(result.allowed).toBe(false);
  });

  it("owner can perform all actions", async () => {
    const actions = ["read", "write", "delete", "manage", "admin"] as const;

    for (const action of actions) {
      const rbac = createRbacMiddleware();
      const result = await rbac.check({
        userId: `u_owner_${action}2`,
        orgId: `o_owner_${action}2`,
        userRole: "owner" as OrgRole,
        resource: "settings",
        action,
      });
      expect(result.allowed).toBe(true);
    }
  });

  it("null role is always denied", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "u_null_role",
      orgId: "o_null_role",
      userRole: null,
      resource: "sessions",
      action: "read",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("No org role assigned");
  });
});

describe("RBAC Middleware - Resource Overrides", () => {
  it("member cannot read billing with admin-read override", async () => {
    const rbac = createRbacMiddleware({
      overrides: {
        billing: { read: "admin", write: "owner" },
      },
    });

    const memberRead = await rbac.check({
      userId: "u_ovr_member_read",
      orgId: "o_ovr_member_read",
      userRole: "member" as OrgRole,
      resource: "billing",
      action: "read",
    });
    expect(memberRead.allowed).toBe(false);
  });

  it("admin can read billing with admin-read override", async () => {
    const rbac = createRbacMiddleware({
      overrides: {
        billing: { read: "admin", write: "owner" },
      },
    });

    const adminRead = await rbac.check({
      userId: "u_ovr_admin_read",
      orgId: "o_ovr_admin_read",
      userRole: "admin" as OrgRole,
      resource: "billing",
      action: "read",
    });
    expect(adminRead.allowed).toBe(true);
  });

  it("admin cannot write billing with owner-write override", async () => {
    const rbac = createRbacMiddleware({
      overrides: {
        billing: { read: "admin", write: "owner" },
      },
    });

    const adminWrite = await rbac.check({
      userId: "u_ovr_admin_write",
      orgId: "o_ovr_admin_write",
      userRole: "admin" as OrgRole,
      resource: "billing",
      action: "write",
    });
    expect(adminWrite.allowed).toBe(false);
  });

  it("owner can write billing with owner-write override", async () => {
    const rbac = createRbacMiddleware({
      overrides: {
        billing: { read: "admin", write: "owner" },
      },
    });

    const ownerWrite = await rbac.check({
      userId: "u_ovr_owner_write",
      orgId: "o_ovr_owner_write",
      userRole: "owner" as OrgRole,
      resource: "billing",
      action: "write",
    });
    expect(ownerWrite.allowed).toBe(true);
  });
});

describe("RBAC Middleware - Caching", () => {
  it("returns same result from memory cache on second call", async () => {
    const rbac = createRbacMiddleware();

    const params: PermissionCheckParams = {
      userId: "u_cache",
      orgId: "o_cache",
      userRole: "admin" as OrgRole,
      resource: "sessions",
      action: "write",
    };

    const result1 = await rbac.check(params);
    const result2 = await rbac.check(params);

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
  });

  it("uses redis cache when provided", async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };

    const rbac = createRbacMiddleware({
      redisClient: mockRedis,
    });

    await rbac.check({
      userId: "u_redis",
      orgId: "o_redis",
      userRole: "admin" as OrgRole,
      resource: "sessions",
      action: "read",
    });

    // Should attempt redis get
    expect(mockRedis.get).toHaveBeenCalled();
    // Should set result in redis
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it("falls back to memory cache when redis fails", async () => {
    const mockRedis = {
      get: vi.fn().mockRejectedValue(new Error("Redis down")),
      set: vi.fn().mockRejectedValue(new Error("Redis down")),
      del: vi.fn().mockRejectedValue(new Error("Redis down")),
    };

    const rbac = createRbacMiddleware({ redisClient: mockRedis });

    const result = await rbac.check({
      userId: "u_fallback",
      orgId: "o_fallback",
      userRole: "admin" as OrgRole,
      resource: "sessions",
      action: "read",
    });

    expect(result.allowed).toBe(true);
  });
});

describe("RBAC Middleware - Cache Invalidation", () => {
  it("invalidates cache without throwing", async () => {
    const rbac = createRbacMiddleware();

    await expect(rbac.invalidate("org_1", "user_1")).resolves.not.toThrow();
  });

  it("invalidates redis cache entries", async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };

    const rbac = createRbacMiddleware({ redisClient: mockRedis });

    await rbac.invalidate("org_1", "user_1");

    expect(mockRedis.del).toHaveBeenCalled();
  });

  it("handles redis invalidation errors gracefully", async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockRejectedValue(new Error("Redis error")),
    };

    const rbac = createRbacMiddleware({ redisClient: mockRedis });

    await expect(rbac.invalidate("org_1", "user_1")).resolves.not.toThrow();
  });
});

describe("RBAC Middleware - Custom Permission Store", () => {
  it("uses custom store for permission checks", async () => {
    const customStore: PermissionStore = {
      check: vi
        .fn()
        .mockResolvedValue({ allowed: true, reason: "Custom allow" }),
    };

    const rbac = createRbacMiddleware({ store: customStore });

    const result = await rbac.check({
      userId: "u1",
      orgId: "o1",
      userRole: "member" as OrgRole,
      resource: "custom",
      action: "admin",
    });

    expect(result.allowed).toBe(true);
    expect(customStore.check).toHaveBeenCalled();
  });
});

describe("RBAC Middleware - requirePermission", () => {
  it("creates middleware function for tRPC", async () => {
    const rbac = createRbacMiddleware();
    const middleware = rbac.requirePermission("sessions", "write");

    const result = await middleware({
      auth: {
        userId: "u1",
        orgId: "o1",
        orgRole: "member" as OrgRole,
        sessionId: "s1",
      },
    });

    expect(result.allowed).toBe(true);
  });

  it("denies when no org context", async () => {
    const rbac = createRbacMiddleware();
    const middleware = rbac.requirePermission("sessions", "write");

    const result = await middleware({
      auth: {
        userId: "u1",
        orgId: null,
        orgRole: null,
        sessionId: "s1",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("No org context");
  });
});
