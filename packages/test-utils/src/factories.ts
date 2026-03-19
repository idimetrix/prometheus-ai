import { generateId } from "@prometheus/utils";

export function createTestOrg(
  overrides?: Partial<{
    id: string;
    name: string;
    slug: string;
    plan: string;
  }>
) {
  return {
    id: generateId("org"),
    name: "Test Org",
    slug: "test-org",
    plan: "pro",
    ...overrides,
  };
}

export function createTestUser(
  overrides?: Partial<{
    id: string;
    orgId: string;
    email: string;
    name: string;
    role: string;
  }>
) {
  return {
    id: generateId("usr"),
    orgId: generateId("org"),
    email: "test@example.com",
    name: "Test User",
    role: "admin",
    ...overrides,
  };
}

export function createTestProject(
  overrides?: Partial<{
    id: string;
    orgId: string;
    name: string;
    repoUrl: string;
    status: string;
  }>
) {
  return {
    id: generateId("prj"),
    orgId: generateId("org"),
    name: "Test Project",
    repoUrl: "https://github.com/test/repo",
    status: "active",
    ...overrides,
  };
}

export function createTestSession(
  overrides?: Partial<{
    id: string;
    projectId: string;
    userId: string;
    status: string;
    mode: string;
  }>
) {
  return {
    id: generateId("ses"),
    projectId: generateId("prj"),
    userId: generateId("usr"),
    status: "active",
    mode: "task",
    ...overrides,
  };
}

export function createTestTask(
  overrides?: Partial<{
    id: string;
    sessionId: string;
    projectId: string;
    title: string;
    status: string;
    agentRole: string;
  }>
) {
  return {
    id: generateId("tsk"),
    sessionId: generateId("ses"),
    projectId: generateId("prj"),
    title: "Test Task",
    status: "pending",
    agentRole: "backend_coder",
    ...overrides,
  };
}
