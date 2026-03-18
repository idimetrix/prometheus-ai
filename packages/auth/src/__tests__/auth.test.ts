import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockVerifyToken = vi.fn();

vi.mock("@clerk/backend", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
}));

import { authMiddleware } from "../middleware";
import { getAuthContext, requireAuth } from "../server";

describe("Auth Package", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_SECRET_KEY = "sk_test_123";
  });

  // ── getAuthContext ─────────────────────────────────────────────────────────

  describe("getAuthContext", () => {
    it("returns auth context for valid token", async () => {
      mockVerifyToken.mockResolvedValueOnce({
        sub: "user_abc123",
        org_id: "org_xyz789",
        org_role: "admin",
        sid: "sess_123",
      });

      const ctx = await getAuthContext("valid_token");
      expect(ctx).not.toBeNull();
      expect(ctx?.userId).toBe("user_abc123");
      expect(ctx?.orgId).toBe("org_xyz789");
      expect(ctx?.orgRole).toBe("admin");
      expect(ctx?.sessionId).toBe("sess_123");
    });

    it("returns null for invalid token", async () => {
      mockVerifyToken.mockRejectedValueOnce(new Error("Invalid token"));
      const ctx = await getAuthContext("invalid_token");
      expect(ctx).toBeNull();
    });

    it("returns null when verifyToken returns null", async () => {
      mockVerifyToken.mockResolvedValueOnce(null);
      const ctx = await getAuthContext("expired_token");
      expect(ctx).toBeNull();
    });

    it("handles missing org_id gracefully", async () => {
      mockVerifyToken.mockResolvedValueOnce({
        sub: "user_abc123",
        sid: "sess_123",
        // No org_id or org_role
      });

      const ctx = await getAuthContext("personal_token");
      expect(ctx).not.toBeNull();
      expect(ctx?.userId).toBe("user_abc123");
      expect(ctx?.orgId).toBeNull();
      expect(ctx?.orgRole).toBeNull();
    });

    it("throws when CLERK_SECRET_KEY is missing", async () => {
      process.env.CLERK_SECRET_KEY = undefined;
      // getAuthContext catches all errors and returns null
      const ctx = await getAuthContext("any_token");
      expect(ctx).toBeNull();
    });

    it("handles empty session id", async () => {
      mockVerifyToken.mockResolvedValueOnce({
        sub: "user_abc",
        org_id: "org_1",
        org_role: "member",
        // No sid
      });

      const ctx = await getAuthContext("token");
      expect(ctx).not.toBeNull();
      expect(ctx?.sessionId).toBe("");
    });

    it("passes token and secretKey to verifyToken", async () => {
      mockVerifyToken.mockResolvedValueOnce({
        sub: "user_1",
        sid: "s1",
      });

      await getAuthContext("my_token");
      expect(mockVerifyToken).toHaveBeenCalledWith("my_token", {
        secretKey: "sk_test_123",
        clockSkewInMs: 60_000,
      });
    });
  });

  // ── requireAuth ────────────────────────────────────────────────────────────

  describe("requireAuth", () => {
    it("returns context for valid token", async () => {
      mockVerifyToken.mockResolvedValueOnce({
        sub: "user_1",
        org_id: "org_1",
        org_role: "admin",
        sid: "sess_1",
      });

      const ctx = await requireAuth("valid_token");
      expect(ctx.userId).toBe("user_1");
      expect(ctx.orgId).toBe("org_1");
    });

    it("throws 'Unauthorized' for invalid token", async () => {
      mockVerifyToken.mockRejectedValueOnce(new Error("bad token"));
      await expect(requireAuth("bad_token")).rejects.toThrow("Unauthorized");
    });

    it("throws 'Unauthorized' when verifyToken returns null", async () => {
      mockVerifyToken.mockResolvedValueOnce(null);
      await expect(requireAuth("expired")).rejects.toThrow("Unauthorized");
    });
  });

  // ── authMiddleware ─────────────────────────────────────────────────────────

  describe("authMiddleware", () => {
    const middleware = authMiddleware();

    it("extracts Bearer token from authorization header", async () => {
      mockVerifyToken.mockResolvedValueOnce({
        sub: "user_1",
        org_id: "org_1",
        org_role: "member",
        sid: "sess_1",
      });

      const request = new Request("http://localhost/api", {
        headers: { authorization: "Bearer valid_token_here" },
      });

      const ctx = await middleware(request);
      expect(ctx.userId).toBe("user_1");
      expect(mockVerifyToken).toHaveBeenCalledWith(
        "valid_token_here",
        expect.any(Object)
      );
    });

    it("throws when authorization header is missing", async () => {
      const request = new Request("http://localhost/api");
      await expect(middleware(request)).rejects.toThrow(
        "Missing authorization header"
      );
    });

    it("throws when authorization header does not start with Bearer", async () => {
      const request = new Request("http://localhost/api", {
        headers: { authorization: "Basic abc123" },
      });
      await expect(middleware(request)).rejects.toThrow(
        "Missing authorization header"
      );
    });

    it("throws when token is invalid", async () => {
      mockVerifyToken.mockRejectedValueOnce(new Error("Invalid"));

      const request = new Request("http://localhost/api", {
        headers: { authorization: "Bearer invalid_token" },
      });

      await expect(middleware(request)).rejects.toThrow("Invalid token");
    });

    it("returns full auth context on success", async () => {
      mockVerifyToken.mockResolvedValueOnce({
        sub: "user_42",
        org_id: "org_7",
        org_role: "owner",
        sid: "sess_99",
      });

      const request = new Request("http://localhost/api", {
        headers: { authorization: "Bearer good_token" },
      });

      const ctx = await middleware(request);
      expect(ctx).toEqual({
        userId: "user_42",
        orgId: "org_7",
        orgRole: "owner",
        sessionId: "sess_99",
      });
    });
  });
});
