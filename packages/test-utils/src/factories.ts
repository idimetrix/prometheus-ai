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

export function createTestAgent(
  overrides?: Partial<{
    id: string;
    sessionId: string;
    role: string;
    status: string;
    slot: string;
    iteration: number;
    tokensUsed: number;
    creditsConsumed: number;
  }>
) {
  return {
    id: generateId("agt"),
    sessionId: generateId("ses"),
    role: "backend_coder",
    status: "idle",
    slot: "default",
    iteration: 0,
    tokensUsed: 0,
    creditsConsumed: 0,
    ...overrides,
  };
}

export function createTestCheckpoint(
  overrides?: Partial<{
    id: string;
    sessionId: string;
    taskId: string;
    orgId: string;
    phase: string;
    iteration: number;
    state: Record<string, unknown>;
  }>
) {
  return {
    id: generateId("ckpt"),
    sessionId: generateId("ses"),
    taskId: generateId("tsk"),
    orgId: generateId("org"),
    phase: "coding",
    iteration: 0,
    state: {
      agentState: {},
      completedSteps: [],
      creditsConsumed: 0,
      modifiedFiles: [],
      phase: "coding",
      savedAt: new Date().toISOString(),
      tokensUsed: { input: 0, output: 0 },
    },
    ...overrides,
  };
}

export function createTestApiKey(
  overrides?: Partial<{
    id: string;
    orgId: string;
    name: string;
    keyHash: string;
    scopes: string[];
    expiresAt: Date | null;
  }>
) {
  return {
    id: generateId("key"),
    orgId: generateId("org"),
    name: "Test API Key",
    keyHash: `test-hash-${generateId()}`,
    scopes: ["sessions:read", "sessions:write"],
    expiresAt: null,
    ...overrides,
  };
}

export function createTestCreditTransaction(
  overrides?: Partial<{
    id: string;
    orgId: string;
    userId: string;
    amount: number;
    type: string;
    description: string;
    balanceBefore: number;
    balanceAfter: number;
  }>
) {
  return {
    id: generateId("txn"),
    orgId: generateId("org"),
    userId: generateId("usr"),
    amount: -100,
    type: "usage",
    description: "Model inference",
    balanceBefore: 10_000,
    balanceAfter: 9900,
    ...overrides,
  };
}

export function createTestIterationSignals(
  overrides?: Partial<{
    toolCallCount: number;
    toolSuccessCount: number;
    toolErrorCount: number;
    hasOutput: boolean;
    outputLength: number;
    filesChanged: number;
    hasStructuredOutput: boolean;
    staleIterations: number;
    expressedUncertainty: boolean;
    requestedHelp: boolean;
  }>
) {
  return {
    toolCallCount: 3,
    toolSuccessCount: 3,
    toolErrorCount: 0,
    hasOutput: true,
    outputLength: 500,
    filesChanged: 1,
    hasStructuredOutput: true,
    staleIterations: 0,
    expressedUncertainty: false,
    requestedHelp: false,
    ...overrides,
  };
}
