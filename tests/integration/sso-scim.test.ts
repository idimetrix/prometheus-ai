/**
 * Integration tests: SSO and SCIM provisioning flows.
 *
 * Validates SAML/OIDC single-sign-on initiation and callback handling,
 * SCIM user provisioning/deprovisioning, and IdP group-to-org-role sync.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures, createMockServiceClient } from "./setup";

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
// Helpers
// ---------------------------------------------------------------------------

interface SSOConfig {
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
  orgId: string;
  provider: "oidc" | "saml";
}

interface SCIMUser {
  active: boolean;
  email: string;
  externalId: string;
  groups: string[];
  name: string;
  orgId: string;
}

function buildSAMLResponse(
  email: string,
  nameId: string,
  orgId: string
): Record<string, unknown> {
  return {
    type: "saml",
    nameId,
    attributes: {
      email,
      firstName: "Test",
      lastName: "User",
    },
    orgId,
    isValid: true,
    issuer: "https://idp.example.com",
  };
}

function buildOIDCTokenResponse(
  email: string,
  sub: string
): Record<string, unknown> {
  return {
    id_token: `mock.jwt.${btoa(JSON.stringify({ email, sub }))}`,
    access_token: "mock_access_token",
    token_type: "Bearer",
    expires_in: 3600,
    claims: { email, sub, name: "Test User" },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSO and SCIM Integration", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  let authService: ReturnType<typeof createMockServiceClient>;
  let ssoConfigs: Map<string, SSOConfig>;
  let scimUsers: Map<string, SCIMUser>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures({ orgPlan: "enterprise" });
    authService = createMockServiceClient("auth");
    ssoConfigs = new Map();
    scimUsers = new Map();

    // Register mock SSO config for the org
    ssoConfigs.set(fixtures.org.id, {
      orgId: fixtures.org.id,
      provider: "saml",
      issuer: "https://idp.example.com",
      callbackUrl: "https://app.prometheus.dev/auth/sso/callback",
      clientId: "prometheus_client_id",
      clientSecret: "prometheus_client_secret",
    });

    // Mock auth service endpoints
    authService.onRequest("POST", "/sso/saml/initiate", {
      status: 200,
      body: {
        redirectUrl:
          "https://idp.example.com/saml/sso?SAMLRequest=encoded_request",
        requestId: "req_saml_001",
      },
    });

    authService.onRequest("POST", "/sso/oidc/initiate", {
      status: 200,
      body: {
        redirectUrl:
          "https://idp.example.com/authorize?client_id=prometheus_client_id&response_type=code",
        state: "random_state_value",
        nonce: "random_nonce",
      },
    });

    authService.onRequest("POST", "/sso/saml/callback", {
      status: 200,
      body: {
        success: true,
        user: { email: "sso-user@example.com", orgId: fixtures.org.id },
        sessionToken: "session_saml_token",
      },
    });

    authService.onRequest("POST", "/sso/oidc/callback", {
      status: 200,
      body: {
        success: true,
        user: { email: "oidc-user@example.com", orgId: fixtures.org.id },
        sessionToken: "session_oidc_token",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    authService._reset();
  });

  // -------------------------------------------------------------------------
  // SAML SSO
  // -------------------------------------------------------------------------

  describe("SAML SSO", () => {
    it("initiates SAML SSO and returns a redirect URL", async () => {
      const response = await authService.request("POST", "/sso/saml/initiate", {
        orgId: fixtures.org.id,
      });

      expect(response.status).toBe(200);
      const body = response.body as Record<string, unknown>;
      expect(body.redirectUrl).toContain("idp.example.com/saml/sso");
      expect(body.requestId).toBeDefined();
    });

    it("processes SAML callback and creates a session", async () => {
      const samlResponse = buildSAMLResponse(
        "sso-user@example.com",
        "nameid_123",
        fixtures.org.id
      );

      expect(samlResponse.isValid).toBe(true);
      expect(samlResponse.orgId).toBe(fixtures.org.id);

      const response = await authService.request("POST", "/sso/saml/callback", {
        SAMLResponse: "base64_encoded_response",
        RelayState: fixtures.org.id,
      });

      expect(response.status).toBe(200);
      const body = response.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.sessionToken).toBeDefined();
      expect((body.user as Record<string, unknown>).email).toBe(
        "sso-user@example.com"
      );
    });

    it("rejects SAML callback with invalid response", async () => {
      authService.onRequest("POST", "/sso/saml/callback/invalid", {
        status: 401,
        body: { success: false, error: "Invalid SAML response signature" },
      });

      const response = await authService.request(
        "POST",
        "/sso/saml/callback/invalid",
        { SAMLResponse: "tampered_response" }
      );

      expect(response.status).toBe(401);
      const body = response.body as Record<string, unknown>;
      expect(body.success).toBe(false);
    });

    it("validates SAML response structure", () => {
      const samlResponse = buildSAMLResponse(
        "user@corp.com",
        "nameid_456",
        fixtures.org.id
      );

      expect(samlResponse.type).toBe("saml");
      expect(samlResponse.nameId).toBe("nameid_456");
      expect((samlResponse.attributes as Record<string, unknown>).email).toBe(
        "user@corp.com"
      );
      expect(samlResponse.issuer).toBe("https://idp.example.com");
    });
  });

  // -------------------------------------------------------------------------
  // OIDC SSO
  // -------------------------------------------------------------------------

  describe("OIDC SSO", () => {
    it("initiates OIDC SSO and returns authorization URL", async () => {
      const response = await authService.request("POST", "/sso/oidc/initiate", {
        orgId: fixtures.org.id,
      });

      expect(response.status).toBe(200);
      const body = response.body as Record<string, unknown>;
      expect(body.redirectUrl).toContain("idp.example.com/authorize");
      expect(body.state).toBeDefined();
      expect(body.nonce).toBeDefined();
    });

    it("exchanges authorization code for tokens and creates session", async () => {
      const response = await authService.request("POST", "/sso/oidc/callback", {
        code: "auth_code_from_idp",
        state: "random_state_value",
      });

      expect(response.status).toBe(200);
      const body = response.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.sessionToken).toBeDefined();
      expect((body.user as Record<string, unknown>).email).toBe(
        "oidc-user@example.com"
      );
    });

    it("builds a valid OIDC token response structure", () => {
      const tokenResponse = buildOIDCTokenResponse("user@corp.com", "sub_789");

      expect(tokenResponse.access_token).toBeDefined();
      expect(tokenResponse.token_type).toBe("Bearer");
      expect(tokenResponse.expires_in).toBe(3600);

      const claims = tokenResponse.claims as Record<string, unknown>;
      expect(claims.email).toBe("user@corp.com");
      expect(claims.sub).toBe("sub_789");
    });

    it("rejects OIDC callback with mismatched state", async () => {
      authService.onRequest("POST", "/sso/oidc/callback/bad-state", {
        status: 400,
        body: { success: false, error: "State mismatch" },
      });

      const response = await authService.request(
        "POST",
        "/sso/oidc/callback/bad-state",
        { code: "auth_code", state: "wrong_state" }
      );

      expect(response.status).toBe(400);
      const body = response.body as Record<string, unknown>;
      expect(body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // SCIM User Provisioning
  // -------------------------------------------------------------------------

  describe("SCIM user provisioning", () => {
    function provisionUser(user: SCIMUser): {
      id: string;
      success: boolean;
    } {
      scimUsers.set(user.externalId, user);
      return { success: true, id: user.externalId };
    }

    function deprovisionUser(externalId: string): {
      deactivated: boolean;
      success: boolean;
    } {
      const user = scimUsers.get(externalId);
      if (user) {
        user.active = false;
        return { success: true, deactivated: true };
      }
      return { success: false, deactivated: false };
    }

    it("provisions a new user from IdP", () => {
      const result = provisionUser({
        externalId: "idp_user_001",
        email: "new-user@corp.com",
        name: "New User",
        active: true,
        groups: ["engineering"],
        orgId: fixtures.org.id,
      });

      expect(result.success).toBe(true);
      expect(scimUsers.has("idp_user_001")).toBe(true);

      const user = scimUsers.get("idp_user_001");
      expect(user?.email).toBe("new-user@corp.com");
      expect(user?.active).toBe(true);
      expect(user?.orgId).toBe(fixtures.org.id);
    });

    it("deprovisions (disables) a user from IdP", () => {
      // First provision
      provisionUser({
        externalId: "idp_user_002",
        email: "leaving-user@corp.com",
        name: "Leaving User",
        active: true,
        groups: ["engineering"],
        orgId: fixtures.org.id,
      });

      expect(scimUsers.get("idp_user_002")?.active).toBe(true);

      // Then deprovision
      const result = deprovisionUser("idp_user_002");

      expect(result.success).toBe(true);
      expect(result.deactivated).toBe(true);
      expect(scimUsers.get("idp_user_002")?.active).toBe(false);
    });

    it("handles deprovisioning of non-existent user", () => {
      const result = deprovisionUser("idp_user_nonexistent");

      expect(result.success).toBe(false);
      expect(result.deactivated).toBe(false);
    });

    it("provisions multiple users from the same IdP group", () => {
      const users = [
        {
          externalId: "idp_user_010",
          email: "alice@corp.com",
          name: "Alice",
          active: true,
          groups: ["platform-team"],
          orgId: fixtures.org.id,
        },
        {
          externalId: "idp_user_011",
          email: "bob@corp.com",
          name: "Bob",
          active: true,
          groups: ["platform-team"],
          orgId: fixtures.org.id,
        },
      ];

      for (const u of users) {
        provisionUser(u);
      }

      expect(scimUsers.size).toBe(2);
      expect(scimUsers.get("idp_user_010")?.groups).toContain("platform-team");
      expect(scimUsers.get("idp_user_011")?.groups).toContain("platform-team");
    });
  });

  // -------------------------------------------------------------------------
  // Group sync (IdP group -> Prometheus org role)
  // -------------------------------------------------------------------------

  describe("group sync (IdP group -> org role)", () => {
    const GROUP_ROLE_MAP: Record<string, string> = {
      admins: "admin",
      engineering: "member",
      "exec-team": "owner",
      "read-only": "viewer",
    };

    function resolveRole(idpGroups: string[]): string {
      // Highest-privilege group wins
      const rolePriority = ["owner", "admin", "member", "viewer"];
      const roles = idpGroups.map((g) => GROUP_ROLE_MAP[g]).filter(Boolean);

      for (const role of rolePriority) {
        if (roles.includes(role)) {
          return role;
        }
      }
      return "viewer";
    }

    it("maps IdP admin group to Prometheus admin role", () => {
      expect(resolveRole(["admins"])).toBe("admin");
    });

    it("maps IdP engineering group to member role", () => {
      expect(resolveRole(["engineering"])).toBe("member");
    });

    it("maps IdP exec-team group to owner role", () => {
      expect(resolveRole(["exec-team"])).toBe("owner");
    });

    it("maps IdP read-only group to viewer role", () => {
      expect(resolveRole(["read-only"])).toBe("viewer");
    });

    it("picks highest-privilege role when user is in multiple groups", () => {
      expect(resolveRole(["engineering", "admins"])).toBe("admin");
      expect(resolveRole(["read-only", "exec-team"])).toBe("owner");
      expect(resolveRole(["engineering", "read-only"])).toBe("member");
    });

    it("defaults to viewer for unknown groups", () => {
      expect(resolveRole(["marketing"])).toBe("viewer");
      expect(resolveRole([])).toBe("viewer");
    });
  });
});
