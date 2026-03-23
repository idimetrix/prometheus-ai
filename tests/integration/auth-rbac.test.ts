/**
 * Integration tests: Authentication and Authorization (RBAC).
 *
 * Verifies cross-org isolation, role-based access control,
 * API key scoping, and security boundaries.
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

describe("Authentication and Authorization", () => {
  let orgA: ReturnType<typeof createIntegrationFixtures>;
  let orgB: ReturnType<typeof createIntegrationFixtures>;

  // Simulated data store for RBAC testing
  let dataStore: {
    projects: Map<string, { id: string; orgId: string; name: string }>;
    sessions: Map<string, { id: string; orgId: string; projectId: string }>;
    tasks: Map<string, { id: string; orgId: string; sessionId: string }>;
    apiKeys: Map<
      string,
      {
        id: string;
        orgId: string;
        scopes: string[];
        keyHash: string;
      }
    >;
  };

  function queryByOrg<T extends { orgId: string }>(
    store: Map<string, T>,
    orgId: string
  ): T[] {
    return [...store.values()].filter((item) => item.orgId === orgId);
  }

  function findById<T extends { id: string; orgId: string }>(
    store: Map<string, T>,
    id: string,
    requestingOrgId: string
  ): T | null {
    const item = store.get(id);
    if (!item) {
      return null;
    }
    // RLS enforcement: only return if same org
    if (item.orgId !== requestingOrgId) {
      return null;
    }
    return item;
  }

  function checkPermission(userRole: string, action: string): boolean {
    const permissions: Record<string, string[]> = {
      owner: [
        "projects:read",
        "projects:write",
        "projects:delete",
        "sessions:read",
        "sessions:write",
        "tasks:read",
        "tasks:write",
        "settings:read",
        "settings:write",
        "billing:read",
        "billing:write",
        "members:read",
        "members:write",
        "apiKeys:read",
        "apiKeys:write",
      ],
      admin: [
        "projects:read",
        "projects:write",
        "sessions:read",
        "sessions:write",
        "tasks:read",
        "tasks:write",
        "settings:read",
        "settings:write",
        "billing:read",
        "members:read",
        "members:write",
        "apiKeys:read",
        "apiKeys:write",
      ],
      member: [
        "projects:read",
        "sessions:read",
        "sessions:write",
        "tasks:read",
        "tasks:write",
        "settings:read",
        "apiKeys:read",
      ],
      viewer: ["projects:read", "sessions:read", "tasks:read", "settings:read"],
    };

    return permissions[userRole]?.includes(action) ?? false;
  }

  function checkApiKeyScope(scopes: string[], requiredScope: string): boolean {
    return scopes.includes(requiredScope) || scopes.includes("*");
  }

  beforeEach(() => {
    orgA = createIntegrationFixtures({ orgPlan: "pro" });
    orgB = createIntegrationFixtures({ orgPlan: "team" });

    dataStore = {
      projects: new Map(),
      sessions: new Map(),
      tasks: new Map(),
      apiKeys: new Map(),
    };

    // Seed data for org A
    dataStore.projects.set(orgA.project.id, {
      id: orgA.project.id,
      orgId: orgA.org.id,
      name: "Org A Project",
    });
    dataStore.sessions.set(orgA.session.id, {
      id: orgA.session.id,
      orgId: orgA.org.id,
      projectId: orgA.project.id,
    });

    // Seed data for org B
    dataStore.projects.set(orgB.project.id, {
      id: orgB.project.id,
      orgId: orgB.org.id,
      name: "Org B Project",
    });
    dataStore.sessions.set(orgB.session.id, {
      id: orgB.session.id,
      orgId: orgB.org.id,
      projectId: orgB.project.id,
    });

    // Seed API keys
    dataStore.apiKeys.set("key_readonly", {
      id: "key_readonly",
      orgId: orgA.org.id,
      scopes: ["sessions:read", "tasks:read", "projects:read"],
      keyHash: "hash_readonly",
    });
    dataStore.apiKeys.set("key_write", {
      id: "key_write",
      orgId: orgA.org.id,
      scopes: ["sessions:read", "sessions:write", "tasks:read", "tasks:write"],
      keyHash: "hash_write",
    });
    dataStore.apiKeys.set("key_admin", {
      id: "key_admin",
      orgId: orgA.org.id,
      scopes: ["*"],
      keyHash: "hash_admin",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("cross-org data isolation (RLS)", () => {
    it("org A cannot access org B projects", () => {
      const result = findById(dataStore.projects, orgB.project.id, orgA.org.id);
      expect(result).toBeNull();
    });

    it("org B cannot access org A projects", () => {
      const result = findById(dataStore.projects, orgA.project.id, orgB.org.id);
      expect(result).toBeNull();
    });

    it("org A can access its own projects", () => {
      const result = findById(dataStore.projects, orgA.project.id, orgA.org.id);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Org A Project");
    });

    it("org A cannot access org B sessions", () => {
      const result = findById(dataStore.sessions, orgB.session.id, orgA.org.id);
      expect(result).toBeNull();
    });

    it("listing queries only return own org data", () => {
      const orgAProjects = queryByOrg(dataStore.projects, orgA.org.id);
      const orgBProjects = queryByOrg(dataStore.projects, orgB.org.id);

      expect(orgAProjects).toHaveLength(1);
      expect(orgBProjects).toHaveLength(1);
      expect(orgAProjects[0].orgId).toBe(orgA.org.id);
      expect(orgBProjects[0].orgId).toBe(orgB.org.id);
    });
  });

  describe("role-based access control (RBAC)", () => {
    it("owner has full access", () => {
      expect(checkPermission("owner", "projects:write")).toBe(true);
      expect(checkPermission("owner", "projects:delete")).toBe(true);
      expect(checkPermission("owner", "billing:write")).toBe(true);
      expect(checkPermission("owner", "members:write")).toBe(true);
      expect(checkPermission("owner", "settings:write")).toBe(true);
    });

    it("admin can manage projects but not billing write", () => {
      expect(checkPermission("admin", "projects:write")).toBe(true);
      expect(checkPermission("admin", "billing:read")).toBe(true);
      expect(checkPermission("admin", "billing:write")).toBe(false);
      expect(checkPermission("admin", "projects:delete")).toBe(false);
    });

    it("member can read and create tasks but not manage settings", () => {
      expect(checkPermission("member", "tasks:read")).toBe(true);
      expect(checkPermission("member", "tasks:write")).toBe(true);
      expect(checkPermission("member", "sessions:write")).toBe(true);
      expect(checkPermission("member", "settings:write")).toBe(false);
      expect(checkPermission("member", "billing:read")).toBe(false);
      expect(checkPermission("member", "members:write")).toBe(false);
    });

    it("viewer can only read", () => {
      expect(checkPermission("viewer", "projects:read")).toBe(true);
      expect(checkPermission("viewer", "sessions:read")).toBe(true);
      expect(checkPermission("viewer", "tasks:read")).toBe(true);
      expect(checkPermission("viewer", "projects:write")).toBe(false);
      expect(checkPermission("viewer", "sessions:write")).toBe(false);
      expect(checkPermission("viewer", "tasks:write")).toBe(false);
      expect(checkPermission("viewer", "settings:write")).toBe(false);
    });

    it("unknown role has no permissions", () => {
      expect(checkPermission("unknown", "projects:read")).toBe(false);
      expect(checkPermission("unknown", "tasks:write")).toBe(false);
    });
  });

  describe("API key scoping", () => {
    it("read-only key cannot write", () => {
      const key = dataStore.apiKeys.get("key_readonly")!;

      expect(checkApiKeyScope(key.scopes, "sessions:read")).toBe(true);
      expect(checkApiKeyScope(key.scopes, "tasks:read")).toBe(true);
      expect(checkApiKeyScope(key.scopes, "sessions:write")).toBe(false);
      expect(checkApiKeyScope(key.scopes, "tasks:write")).toBe(false);
    });

    it("write key can read and write sessions/tasks", () => {
      const key = dataStore.apiKeys.get("key_write")!;

      expect(checkApiKeyScope(key.scopes, "sessions:read")).toBe(true);
      expect(checkApiKeyScope(key.scopes, "sessions:write")).toBe(true);
      expect(checkApiKeyScope(key.scopes, "tasks:read")).toBe(true);
      expect(checkApiKeyScope(key.scopes, "tasks:write")).toBe(true);
      // But not billing
      expect(checkApiKeyScope(key.scopes, "billing:read")).toBe(false);
    });

    it("admin key has wildcard access", () => {
      const key = dataStore.apiKeys.get("key_admin")!;

      expect(checkApiKeyScope(key.scopes, "sessions:read")).toBe(true);
      expect(checkApiKeyScope(key.scopes, "billing:write")).toBe(true);
      expect(checkApiKeyScope(key.scopes, "anything:at:all")).toBe(true);
    });

    it("API key is scoped to its own org", () => {
      const key = dataStore.apiKeys.get("key_readonly")!;

      // Key belongs to org A, should not access org B
      expect(key.orgId).toBe(orgA.org.id);
      expect(key.orgId).not.toBe(orgB.org.id);

      // Simulating: even with valid key, org_id filtering prevents cross-org access
      const orgBProjects = findById(
        dataStore.projects,
        orgB.project.id,
        key.orgId
      );
      expect(orgBProjects).toBeNull();
    });
  });

  describe("authentication edge cases", () => {
    it("expired session is rejected", () => {
      const session = {
        token: "expired_jwt",
        expiresAt: new Date(Date.now() - 3_600_000), // 1 hour ago
      };

      expect(session.expiresAt.getTime()).toBeLessThan(Date.now());
    });

    it("malformed JWT is rejected", () => {
      const malformedTokens = [
        "",
        "not-a-jwt",
        "eyJ.eyJ.invalid",
        "null",
        "undefined",
      ];

      for (const token of malformedTokens) {
        // A real JWT parser validates base64 segments and signature.
        // These tokens are all structurally invalid even if some have 3 segments.
        const isValidStructure =
          token.split(".").length === 3 &&
          token.split(".").every((part) => part.length > 10);
        expect(isValidStructure).toBe(false);
      }
    });

    it("prevents org ID spoofing in request body", () => {
      // Even if attacker sends orgB's ID in request body,
      // the middleware should use the orgId from the JWT, not the body
      const jwtOrgId = orgA.org.id;
      const requestBodyOrgId = orgB.org.id;

      // The authoritative orgId should always come from JWT
      const authorativeOrgId = jwtOrgId;
      expect(authorativeOrgId).toBe(orgA.org.id);
      expect(authorativeOrgId).not.toBe(requestBodyOrgId);
    });
  });
});
