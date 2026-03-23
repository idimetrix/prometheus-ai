import { describe, expect, it } from "vitest";
import { createRbacMiddleware, PERMISSION_LEVELS } from "../rbac-middleware";
import type { OrgRole } from "../server";

describe("RBAC Permission Hierarchy", () => {
  it("exports permission levels in order", () => {
    expect(PERMISSION_LEVELS).toEqual(["viewer", "member", "admin", "owner"]);
  });

  it("member can read", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "user_read",
      orgId: "org_read",
      userRole: "member" as OrgRole,
      resource: "sessions",
      action: "read",
    });
    expect(result.allowed).toBe(true);
  });

  it("unknown role maps to viewer and cannot write", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "user_viewer",
      orgId: "org_viewer",
      userRole: "viewer" as unknown as OrgRole,
      resource: "sessions",
      action: "write",
    });
    expect(result.allowed).toBe(false);
  });

  it("member can write", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "user_member_write",
      orgId: "org_member_write",
      userRole: "member" as OrgRole,
      resource: "sessions",
      action: "write",
    });
    expect(result.allowed).toBe(true);
  });

  it("member cannot delete", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "user_member_del",
      orgId: "org_member_del",
      userRole: "member" as OrgRole,
      resource: "sessions",
      action: "delete",
    });
    expect(result.allowed).toBe(false);
  });

  it("admin can delete", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "user_admin_del",
      orgId: "org_admin_del",
      userRole: "admin" as OrgRole,
      resource: "sessions",
      action: "delete",
    });
    expect(result.allowed).toBe(true);
  });

  it("admin cannot use admin action", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "user_admin_admin",
      orgId: "org_admin_admin",
      userRole: "admin" as OrgRole,
      resource: "settings",
      action: "admin",
    });
    expect(result.allowed).toBe(false);
  });

  it("owner can do everything", async () => {
    const rbac = createRbacMiddleware();
    for (const action of [
      "read",
      "write",
      "delete",
      "manage",
      "admin",
    ] as const) {
      const result = await rbac.check({
        userId: `user_owner_${action}`,
        orgId: `org_owner_${action}`,
        userRole: "owner" as OrgRole,
        resource: "settings",
        action,
      });
      expect(result.allowed).toBe(true);
    }
  });

  it("null role is denied", async () => {
    const rbac = createRbacMiddleware();
    const result = await rbac.check({
      userId: "user_null",
      orgId: "org_null",
      userRole: null,
      resource: "sessions",
      action: "read",
    });
    expect(result.allowed).toBe(false);
  });
});

describe("RBAC with resource overrides", () => {
  it("member cannot read billing with override", async () => {
    const rbac = createRbacMiddleware({
      overrides: { billing: { read: "admin", write: "owner" } },
    });
    const result = await rbac.check({
      userId: "user_billing_member",
      orgId: "org_billing",
      userRole: "member" as OrgRole,
      resource: "billing",
      action: "read",
    });
    expect(result.allowed).toBe(false);
  });

  it("admin can read billing with override", async () => {
    const rbac = createRbacMiddleware({
      overrides: { billing: { read: "admin", write: "owner" } },
    });
    const result = await rbac.check({
      userId: "user_billing_admin",
      orgId: "org_billing_admin",
      userRole: "admin" as OrgRole,
      resource: "billing",
      action: "read",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("RBAC cache invalidation", () => {
  it("invalidation does not throw", async () => {
    const rbac = createRbacMiddleware();
    await expect(rbac.invalidate("org_inv", "user_inv")).resolves.not.toThrow();
  });
});
