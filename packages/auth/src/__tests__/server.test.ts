import { describe, expect, it } from "vitest";
import { hasOrgRole, ORG_ROLES } from "../server";

describe("hasOrgRole", () => {
  it("exports valid org roles", () => {
    expect(ORG_ROLES).toEqual(["owner", "admin", "member"]);
  });

  it("owner meets all role requirements", () => {
    expect(hasOrgRole("owner", "member")).toBe(true);
    expect(hasOrgRole("owner", "admin")).toBe(true);
    expect(hasOrgRole("owner", "owner")).toBe(true);
  });

  it("admin meets member and admin but not owner", () => {
    expect(hasOrgRole("admin", "member")).toBe(true);
    expect(hasOrgRole("admin", "admin")).toBe(true);
    expect(hasOrgRole("admin", "owner")).toBe(false);
  });

  it("member meets only member requirement", () => {
    expect(hasOrgRole("member", "member")).toBe(true);
    expect(hasOrgRole("member", "admin")).toBe(false);
    expect(hasOrgRole("member", "owner")).toBe(false);
  });

  it("returns false for null role", () => {
    expect(hasOrgRole(null, "member")).toBe(false);
    expect(hasOrgRole(null, "admin")).toBe(false);
    expect(hasOrgRole(null, "owner")).toBe(false);
  });

  it("returns false for empty string role", () => {
    expect(hasOrgRole("", "member")).toBe(false);
  });

  it("returns false for unknown role string", () => {
    expect(hasOrgRole("unknown_role", "member")).toBe(false);
  });
});
