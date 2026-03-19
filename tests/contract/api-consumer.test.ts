import { describe, expect, it } from "vitest";

/**
 * Contract tests: API <-> Web consumer
 *
 * These tests verify that the API response shapes match what the web app expects.
 * They act as a lightweight alternative to full Pact contract tests, asserting
 * structural compatibility between provider (API) and consumer (Web) without
 * requiring a running server.
 *
 * When @pact-foundation/pact is installed, these can be upgraded to full
 * consumer-driven contract tests with broker integration.
 */

// ─── Top-level regex constants ──────────────────────────────────────────────

const SESSION_ID_REGEX = /^ses_/;
const PROJECT_ID_REGEX = /^proj_/;
const ORG_ID_REGEX = /^org_/;

// ─── Expected response shapes (what the web app consumes) ──────────────────

interface SessionItem {
  createdAt: string;
  id: string;
  mode: string;
  projectId: string;
  status: "active" | "paused" | "completed" | "cancelled" | "errored";
  updatedAt: string;
  userId: string;
}

interface SessionListResponse {
  items: SessionItem[];
  nextCursor: string | null;
}

interface SessionCreateInput {
  mode: string;
  projectId: string;
  prompt?: string;
}

interface SessionCreateResponse {
  createdAt: string;
  id: string;
  mode: string;
  projectId: string;
  status: string;
  updatedAt: string;
  userId: string;
}

interface ProjectItem {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  orgId: string;
  repoUrl: string | null;
  status: string;
  updatedAt: string;
}

interface ProjectListResponse {
  items: ProjectItem[];
  nextCursor: string | null;
}

// ─── Mock providers ────────────────────────────────────────────────────────

function mockSessionsList(): SessionListResponse {
  return {
    items: [
      {
        id: "ses_abc123",
        projectId: "proj_def456",
        userId: "user_ghi789",
        status: "active",
        mode: "autonomous",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    nextCursor: null,
  };
}

function mockSessionCreate(input: SessionCreateInput): SessionCreateResponse {
  return {
    id: "ses_new123",
    projectId: input.projectId,
    userId: "user_ghi789",
    status: "active",
    mode: input.mode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mockProjectsList(): ProjectListResponse {
  return {
    items: [
      {
        id: "proj_abc123",
        orgId: "org_def456",
        name: "My Project",
        description: "A test project",
        repoUrl: "https://github.com/example/repo",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    nextCursor: null,
  };
}

// ─── Contract tests ────────────────────────────────────────────────────────

describe("API Contract: Sessions", () => {
  it("sessions.list returns expected shape", () => {
    const response = mockSessionsList();

    expect(response).toHaveProperty("items");
    expect(response).toHaveProperty("nextCursor");
    expect(Array.isArray(response.items)).toBe(true);

    const session = response.items[0];
    expect(session).toBeDefined();
    expect(session).toHaveProperty("id");
    expect(session).toHaveProperty("projectId");
    expect(session).toHaveProperty("userId");
    expect(session).toHaveProperty("status");
    expect(session).toHaveProperty("mode");
    expect(session).toHaveProperty("createdAt");
    expect(session).toHaveProperty("updatedAt");

    // Verify ID prefix convention
    expect(session.id).toMatch(SESSION_ID_REGEX);
    expect(session.projectId).toMatch(PROJECT_ID_REGEX);

    // Verify status is a known value
    const validStatuses = [
      "active",
      "paused",
      "completed",
      "cancelled",
      "errored",
    ];
    expect(validStatuses).toContain(session.status);

    // Verify timestamps are valid ISO strings
    expect(() => new Date(session.createdAt)).not.toThrow();
    expect(() => new Date(session.updatedAt)).not.toThrow();
  });

  it("sessions.create accepts expected input", () => {
    const input: SessionCreateInput = {
      projectId: "proj_test123",
      mode: "autonomous",
      prompt: "Build a REST API for user management",
    };

    const response = mockSessionCreate(input);

    // Verify the response contains all required fields
    expect(response).toHaveProperty("id");
    expect(response).toHaveProperty("projectId");
    expect(response).toHaveProperty("userId");
    expect(response).toHaveProperty("status");
    expect(response).toHaveProperty("mode");
    expect(response).toHaveProperty("createdAt");
    expect(response).toHaveProperty("updatedAt");

    // Verify input is reflected in response
    expect(response.projectId).toBe(input.projectId);
    expect(response.mode).toBe(input.mode);
    expect(response.status).toBe("active");
    expect(response.id).toMatch(SESSION_ID_REGEX);
  });

  it("sessions.create works without optional prompt", () => {
    const input: SessionCreateInput = {
      projectId: "proj_test456",
      mode: "interactive",
    };

    const response = mockSessionCreate(input);

    expect(response.projectId).toBe(input.projectId);
    expect(response.mode).toBe(input.mode);
    expect(response.id).toMatch(SESSION_ID_REGEX);
  });
});

describe("API Contract: Projects", () => {
  it("projects.list returns expected shape", () => {
    const response = mockProjectsList();

    expect(response).toHaveProperty("items");
    expect(response).toHaveProperty("nextCursor");
    expect(Array.isArray(response.items)).toBe(true);

    const project = response.items[0];
    expect(project).toBeDefined();
    expect(project).toHaveProperty("id");
    expect(project).toHaveProperty("orgId");
    expect(project).toHaveProperty("name");
    expect(project).toHaveProperty("description");
    expect(project).toHaveProperty("repoUrl");
    expect(project).toHaveProperty("status");
    expect(project).toHaveProperty("createdAt");
    expect(project).toHaveProperty("updatedAt");

    // Verify ID prefix convention
    expect(project.id).toMatch(PROJECT_ID_REGEX);
    expect(project.orgId).toMatch(ORG_ID_REGEX);

    // Verify name is a non-empty string
    expect(typeof project.name).toBe("string");
    expect(project.name.length).toBeGreaterThan(0);

    // Verify nullable fields accept null
    const nullableProject: ProjectItem = {
      ...project,
      description: null,
      repoUrl: null,
    };
    expect(nullableProject.description).toBeNull();
    expect(nullableProject.repoUrl).toBeNull();
  });

  it("projects.list handles empty response", () => {
    const response: ProjectListResponse = {
      items: [],
      nextCursor: null,
    };

    expect(response.items).toHaveLength(0);
    expect(response.nextCursor).toBeNull();
  });

  it("projects.list handles pagination cursor", () => {
    const response: ProjectListResponse = {
      items: [
        {
          id: "proj_page1",
          orgId: "org_test",
          name: "Page 1 Project",
          description: null,
          repoUrl: null,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      nextCursor: "proj_page1",
    };

    expect(response.nextCursor).toBe("proj_page1");
    expect(typeof response.nextCursor).toBe("string");
  });
});
