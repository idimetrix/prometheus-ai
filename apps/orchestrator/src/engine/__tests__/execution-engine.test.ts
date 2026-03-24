import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../execution-context";
import { createExecutionContext } from "../execution-context";
import type { ExecutionEvent } from "../execution-events";

// ---------------------------------------------------------------------------
// Inline test factories (equivalent to @prometheus/test-utils)
// ---------------------------------------------------------------------------

let idCounter = 0;
function testId(prefix: string) {
  return `${prefix}_test_${++idCounter}`;
}

function createTestOrg() {
  return {
    id: testId("org"),
    name: "Test Org",
    slug: "test-org",
    plan: "pro",
    creditBalance: 10_000,
  };
}

function createTestUser(overrides?: { orgId?: string }) {
  return {
    id: testId("usr"),
    orgId: overrides?.orgId ?? testId("org"),
    email: "test@example.com",
    name: "Test User",
    role: "admin",
  };
}

function createTestProject(overrides?: { orgId?: string }) {
  return {
    id: testId("prj"),
    orgId: overrides?.orgId ?? testId("org"),
    name: "Test Project",
    repoUrl: "https://github.com/test/repo",
    status: "active",
    defaultBranch: "main",
  };
}

function createTestSession(overrides?: {
  orgId?: string;
  userId?: string;
  projectId?: string;
}) {
  return {
    id: testId("ses"),
    projectId: overrides?.projectId ?? testId("prj"),
    userId: overrides?.userId ?? testId("usr"),
    orgId: overrides?.orgId ?? testId("org"),
    status: "active",
    mode: "task",
  };
}

// ---------------------------------------------------------------------------
// Shared mock state that mock factories close over
// ---------------------------------------------------------------------------

const mockSelfReviewShouldReview = vi.fn(() => ({
  shouldReview: false,
  filePath: "",
  reason: "not a write tool",
}));

const mockQualityGateShouldEvaluate = vi.fn(() => false);
const mockQualityGateEvaluate = vi.fn(() =>
  Promise.resolve({
    score: 1.0,
    scores: {
      correctness: 1.0,
      completeness: 1.0,
      conventions: 1.0,
      security: 1.0,
      performance: 1.0,
    },
    issues: [] as Array<{
      category: string;
      severity: string;
      description: string;
    }>,
    verdict: "pass" as string,
  })
);
const mockQualityGateGetFeedbackPrompt = vi.fn(() => "");

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../checkpoint-persistence", () => ({
  CheckpointPersistence: class {
    save = vi.fn(() => Promise.resolve());
    restore = vi.fn(() => Promise.resolve(null));
  },
}));

vi.mock("@prometheus/utils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    modelRouterClient: {
      getCircuitState: vi.fn(() => "closed"),
    },
    projectBrainClient: {
      get: vi.fn(() => Promise.resolve({ data: { conventions: "" } })),
    },
  };
});

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../blueprint-enforcer", () => ({
  BlueprintEnforcer: class {
    loadForProject = vi.fn(() => Promise.resolve());
    isLoaded = vi.fn(() => false);
    getContextForPrompt = vi.fn(() => null);
  },
}));

vi.mock("../../guardian/secrets-scanner", () => ({
  SecretsScanner: class {
    scan = vi.fn(() => ({ blocked: false }));
  },
}));

vi.mock("../../self-review", () => ({
  SelfReview: class {
    shouldReview = mockSelfReviewShouldReview;
    isReadTool = vi.fn(() => false);
    recordRead = vi.fn();
    getReviewPrompt = vi.fn(() => "Please review this file.");
    generateReflection = vi.fn(() => ({
      strengths: ["Produced detailed output"],
      improvements: [],
      decisions: ["Modified test files"],
    }));
  },
}));

vi.mock("../../confidence", () => ({
  ConfidenceScorer: class {
    scoreIteration = vi.fn(() => ({
      score: 0.85,
      action: "continue" as const,
      factors: [
        {
          name: "tool_success_rate",
          value: 1,
          weight: 0.3,
          contribution: 0.3,
        },
      ],
      recommendedSlot: null,
    }));
    static extractSignals = vi.fn(
      (
        _output: string,
        toolResults: Array<{ success: boolean; name: string }>,
        filesChanged: number,
        _previousIterationCount: number,
        _lastOutputLength: number
      ) => ({
        toolCallCount: toolResults.length,
        toolSuccessCount: toolResults.filter(
          (r: { success: boolean }) => r.success
        ).length,
        toolErrorCount: toolResults.filter(
          (r: { success: boolean }) => !r.success
        ).length,
        hasOutput: true,
        outputLength: 200,
        filesChanged,
        hasStructuredOutput: false,
        staleIterations: 0,
        expressedUncertainty: false,
        requestedHelp: false,
      })
    );
    static getModelSlot = vi.fn(
      (defaultSlot: string, _confidence: unknown) => defaultSlot
    );
  },
  ModelEscalator: class {
    recordOutcome = vi.fn();
    shouldEscalate = vi.fn(() => false);
    getEscalationStats = vi.fn(() => ({}));
  },
}));

vi.mock("../../checkpoint", () => ({
  CheckpointManager: class {
    requestHighStakesApproval = vi.fn(() =>
      Promise.resolve({ approved: true, respondedBy: "auto" })
    );
    requestPlanConfirmation = vi.fn(() =>
      Promise.resolve({ approved: true, respondedBy: "auto" })
    );
    getTimedOutCheckpoints = vi.fn(() => []);
    cancelSessionCheckpoints = vi.fn();
    getPendingCheckpoints = vi.fn(() => []);
  },
}));

vi.mock("../quality-gate", () => ({
  QualityGate: class {
    shouldEvaluate = mockQualityGateShouldEvaluate;
    evaluate = mockQualityGateEvaluate;
    getFeedbackPrompt = mockQualityGateGetFeedbackPrompt;
  },
}));

vi.mock("../../context/context-compressor", () => ({
  ContextCompressor: class {
    shouldCompress = vi.fn(() => false);
    compress = vi.fn(() =>
      Promise.resolve({
        compressedMessages: [],
        originalTokens: 0,
        compressedTokens: 0,
        ratio: 1.0,
      })
    );
  },
}));

vi.mock("../../feedback/learning-extractor", () => ({
  LearningExtractor: class {
    getLearnedContext = vi.fn(() => Promise.resolve(null));
  },
}));

vi.mock("../../tool-dependency", () => ({
  classifyToolDependencies: vi.fn(
    (
      calls: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
      }>
    ) => [{ calls, sequential: false }]
  ),
}));

const mockToolExecute = vi.fn(() =>
  Promise.resolve({ success: true, output: "tool output" })
);

vi.mock("@prometheus/agent-sdk", () => {
  const mockAgent = {
    getAllowedTools: vi.fn(() => [
      "file_read",
      "file_write",
      "file_edit",
      "terminal_exec",
      "search_files",
    ]),
    initialize: vi.fn(),
    addUserMessage: vi.fn(),
    addAssistantMessage: vi.fn(),
    addToolResult: vi.fn(),
    getMessages: vi.fn(() => [
      { role: "system", content: "You are a backend coder." },
    ]),
    getToolDefinitions: vi.fn(() => [
      {
        type: "function",
        function: {
          name: "file_write",
          description: "Write a file",
          parameters: {},
        },
      },
    ]),
  };

  return {
    AGENT_ROLES: {
      backend_coder: {
        role: "backend_coder",
        displayName: "Backend Coder",
        description: "APIs, services",
        preferredModel: "test-model",
        tools: ["file_read", "file_write", "file_edit", "terminal_exec"],
        create: () => mockAgent,
      },
    },
    TOOL_REGISTRY: new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop === "string") {
            return {
              name: prop,
              description: `Mock tool: ${prop}`,
              inputSchema: {},
              execute: mockToolExecute,
            };
          }
          return undefined;
        },
      }
    ),
  };
});

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<ExecutionContext>): ExecutionContext {
  const org = createTestOrg();
  const user = createTestUser({ orgId: org.id });
  const project = createTestProject({ orgId: org.id });
  const session = createTestSession({
    orgId: org.id,
    userId: user.id,
    projectId: project.id,
  });

  return createExecutionContext({
    sessionId: session.id,
    projectId: project.id,
    orgId: org.id,
    userId: user.id,
    agentRole: "backend_coder",
    taskDescription: "Implement a REST endpoint for /users",
    sandboxId: `sbx_${session.id}`,
    options: { maxIterations: 5, slot: "default" },
    ...overrides,
  });
}

function jsonRouteResponse(opts: {
  content: string;
  toolCalls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
  finishReason?: string;
}) {
  const body = {
    choices: [
      {
        message: {
          role: "assistant",
          content: opts.content,
          ...(opts.toolCalls ? { tool_calls: opts.toolCalls } : {}),
        },
        finish_reason: opts.finishReason ?? "stop",
      },
    ],
    usage: opts.usage ?? {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cost_usd: 0.001,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sseRouteResponse(opts: {
  content: string;
  toolCalls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
}) {
  const usage = opts.usage ?? {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cost_usd: 0.001,
  };

  const chunks: string[] = [];

  if (opts.content) {
    chunks.push(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: opts.content }, finish_reason: null }],
      })}\n\n`
    );
  }

  if (opts.toolCalls) {
    for (let i = 0; i < opts.toolCalls.length; i++) {
      const tc = opts.toolCalls[i];
      if (!tc) {
        continue;
      }
      chunks.push(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: i,
                    id: tc.id,
                    function: {
                      name: tc.function.name,
                      arguments: tc.function.arguments,
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`
      );
    }
  }

  chunks.push(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {},
          finish_reason: opts.toolCalls ? "tool_calls" : "stop",
        },
      ],
      usage,
    })}\n\n`
  );
  chunks.push("data: [DONE]\n\n");

  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collectEvents(
  gen: AsyncGenerator<ExecutionEvent, void, undefined>
): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const ev of gen) {
    events.push(ev);
  }
  return events;
}

type EventTypeMap = {
  [E in ExecutionEvent as E["type"]]: E;
};
function eventsOfType<K extends keyof EventTypeMap>(
  events: ExecutionEvent[],
  type: K
): EventTypeMap[K][] {
  return events.filter((e) => e.type === type) as EventTypeMap[K][];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionEngine", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockToolExecute.mockResolvedValue({
      success: true,
      output: "tool output",
    });
    mockSelfReviewShouldReview.mockReturnValue({
      shouldReview: false,
      filePath: "",
      reason: "not a write tool",
    });
    mockQualityGateShouldEvaluate.mockReturnValue(false);
    mockQualityGateEvaluate.mockResolvedValue({
      score: 1.0,
      scores: {
        correctness: 1.0,
        completeness: 1.0,
        conventions: 1.0,
        security: 1.0,
        performance: 1.0,
      },
      issues: [],
      verdict: "pass",
    });
    mockQualityGateGetFeedbackPrompt.mockReturnValue("");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function getEngine() {
    const mod = await import("../execution-engine");
    return mod.ExecutionEngine;
  }

  // 1. Basic loop: yields TokenEvents and CompleteEvent (SSE streaming)
  it("yields token events and a complete event for a simple response", async () => {
    mockFetch.mockResolvedValueOnce(
      sseRouteResponse({ content: "Here is the implementation." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const tokens = eventsOfType(events, "token");
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(tokens[0]?.content).toBe("Here is the implementation.");

    const completes = eventsOfType(events, "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.success).toBe(true);
  });

  // 2. Tool execution: correctly processes tool calls
  it("processes tool calls and yields tool_call + tool_result events", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "I will write the file.",
        toolCalls: [
          {
            id: "tc_1",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: "/src/index.ts" }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(jsonRouteResponse({ content: "Done." }));

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const toolCalls = eventsOfType(events, "tool_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(toolCalls[0]?.toolName).toBe("file_read");

    const toolResults = eventsOfType(events, "tool_result");
    expect(toolResults.length).toBeGreaterThanOrEqual(1);
    expect(toolResults[0]?.success).toBe(true);
  });

  // 3. Destructive command detection: blocks rm -rf, DROP TABLE, git push --force
  it("blocks destructive rm -rf commands and emits checkpoint event", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Cleaning up temp files.",
        toolCalls: [
          {
            id: "tc_rm",
            function: {
              name: "terminal_exec",
              arguments: JSON.stringify({ command: "rm -rf /tmp/data" }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "Understood, skipping." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const checkpoints = eventsOfType(events, "checkpoint");
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[0]?.reason).toContain("rm -rf");
  });

  it("blocks DROP TABLE commands", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Dropping table.",
        toolCalls: [
          {
            id: "tc_drop",
            function: {
              name: "terminal_exec",
              arguments: JSON.stringify({
                command: "psql -c 'DROP TABLE users'",
              }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(jsonRouteResponse({ content: "OK" }));

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const checkpoints = eventsOfType(events, "checkpoint");
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[0]?.reason).toContain("DROP TABLE");
  });

  it("blocks git push --force commands", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Pushing.",
        toolCalls: [
          {
            id: "tc_push",
            function: {
              name: "terminal_exec",
              arguments: JSON.stringify({
                command: "git push --force origin main",
              }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(jsonRouteResponse({ content: "OK" }));

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const checkpoints = eventsOfType(events, "checkpoint");
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[0]?.reason).toContain("git push --force");
  });

  // 4. Consecutive error threshold: escalation after 3 failures
  it("emits unrecoverable error after 3 consecutive LLM failures", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const engine = await getEngine();
    const ctx = makeCtx({
      options: {
        maxIterations: 10,
        slot: "default",
        speculate: false,
        workDir: "/workspace",
        temperature: 0.1,
        maxTokens: 4096,
      },
    });
    const events = await collectEvents(engine.execute(ctx));

    const errors = eventsOfType(events, "error");
    const recoverable = errors.filter((e) => e.recoverable);
    const unrecoverable = errors.filter((e) => !e.recoverable);

    expect(recoverable.length).toBe(2);
    expect(unrecoverable.length).toBe(1);
    expect(unrecoverable[0]?.error).toContain("Blocked after 3");

    const completes = eventsOfType(events, "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.success).toBe(false);
  });

  // 5. Confidence scoring: scores are generated per iteration
  it("emits confidence events per iteration with tool calls", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Reading code.",
        toolCalls: [
          {
            id: "tc_r1",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: "/src/main.ts" }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "All done." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const confidenceEvents = eventsOfType(events, "confidence");
    expect(confidenceEvents.length).toBeGreaterThanOrEqual(1);
    expect(confidenceEvents[0]?.score).toBeTypeOf("number");
    expect(confidenceEvents[0]?.action).toBe("continue");
    expect(confidenceEvents[0]?.factors).toBeDefined();
  });

  // 6. CompleteEvent includes correct stats
  it("complete event includes correct aggregated stats", async () => {
    const usage1 = {
      prompt_tokens: 200,
      completion_tokens: 100,
      total_tokens: 300,
      cost_usd: 0.002,
    };
    const usage2 = {
      prompt_tokens: 150,
      completion_tokens: 80,
      total_tokens: 230,
      cost_usd: 0.001,
    };

    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Step 1",
        toolCalls: [
          {
            id: "tc_w1",
            function: {
              name: "file_write",
              arguments: JSON.stringify({
                path: "/src/a.ts",
                content: "export {}",
              }),
            },
          },
        ],
        usage: usage1,
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "Finished.", usage: usage2 })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const complete = eventsOfType(events, "complete")[0];
    expect(complete).toBeDefined();
    expect(complete?.success).toBe(true);
    expect(complete?.tokensUsed.input).toBe(200 + 150);
    expect(complete?.tokensUsed.output).toBe(100 + 80);
    expect(complete?.toolCalls).toBe(1);
  });

  // 7. ErrorEvent on unrecoverable failure
  it("emits error event for unknown agent role", async () => {
    const engine = await getEngine();
    const ctx = makeCtx();
    const badCtx = { ...ctx, agentRole: "nonexistent_role" as never };
    const events = await collectEvents(engine.execute(badCtx));

    const errors = eventsOfType(events, "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.error).toContain("Unknown agent role");
    expect(errors[0]?.recoverable).toBe(false);
  });

  // 8. Context creation with correct defaults
  it("creates execution context with correct defaults", () => {
    const ctx = createExecutionContext({
      sessionId: "ses_123",
      projectId: "prj_456",
      orgId: "org_789",
      userId: "usr_abc",
      agentRole: "backend_coder",
      taskDescription: "Build a feature",
      sandboxId: "sbx_test_123",
    });

    expect(ctx.options.maxIterations).toBe(50);
    expect(ctx.options.temperature).toBe(0.1);
    expect(ctx.options.maxTokens).toBe(4096);
    expect(ctx.options.slot).toBe("default");
    expect(ctx.options.speculate).toBe(false);
    expect(ctx.workDir).toBe("/workspace");
    expect(ctx.blueprintContent).toBeNull();
    expect(ctx.sprintState).toBeNull();
    expect(ctx.recentCIResults).toBeNull();
    expect(ctx.priorSessionContext).toBeNull();
    expect(ctx.sandboxId).toBe("sbx_test_123");
    expect(ctx.sandboxManagerUrl).toBe("http://localhost:4006");
  });

  it("merges option overrides correctly", () => {
    const ctx = createExecutionContext({
      sessionId: "ses_123",
      projectId: "prj_456",
      orgId: "org_789",
      userId: "usr_abc",
      agentRole: "backend_coder",
      taskDescription: "Build a feature",
      sandboxId: "sbx_test_456",
      options: { maxIterations: 10, temperature: 0.5 },
    });

    expect(ctx.options.maxIterations).toBe(10);
    expect(ctx.options.temperature).toBe(0.5);
    expect(ctx.options.maxTokens).toBe(4096);
    expect(ctx.options.slot).toBe("default");
  });

  // 9. Empty iteration handling (LLM returns empty)
  it("handles empty LLM response gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 0,
            total_tokens: 50,
            cost_usd: 0,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const completes = eventsOfType(events, "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.success).toBe(true);
  });

  // 10. Multiple iterations with tool calls
  it("handles multiple iterations with tool calls", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Reading first file",
        toolCalls: [
          {
            id: "tc_1",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: "/src/a.ts" }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Writing file",
        toolCalls: [
          {
            id: "tc_2",
            function: {
              name: "file_write",
              arguments: JSON.stringify({
                path: "/src/b.ts",
                content: "code",
              }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "All tasks complete." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const toolCallEvents = eventsOfType(events, "tool_call");
    expect(toolCallEvents).toHaveLength(2);
    expect(toolCallEvents[0]?.toolName).toBe("file_read");
    expect(toolCallEvents[1]?.toolName).toBe("file_write");

    const completes = eventsOfType(events, "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.toolCalls).toBe(2);
  });

  // 11. File change events emitted
  it("emits file_change events for file_write and file_edit tool calls", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Writing files",
        toolCalls: [
          {
            id: "tc_w1",
            function: {
              name: "file_write",
              arguments: JSON.stringify({
                path: "/src/new.ts",
                content: "export const x = 1;",
              }),
            },
          },
          {
            id: "tc_e1",
            function: {
              name: "file_edit",
              arguments: JSON.stringify({
                path: "/src/existing.ts",
                content: "updated",
              }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(jsonRouteResponse({ content: "Done." }));

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const fileChanges = eventsOfType(events, "file_change");
    expect(fileChanges.length).toBeGreaterThanOrEqual(2);

    const paths = fileChanges.map((e) => e.filePath);
    expect(paths).toContain("/src/new.ts");
    expect(paths).toContain("/src/existing.ts");
  });

  // 12. Self-review triggers
  it("emits self_review events when SelfReview.shouldReview returns true", async () => {
    mockSelfReviewShouldReview
      .mockReturnValueOnce({
        shouldReview: true,
        filePath: "/src/component.tsx",
        reason: "Large file write",
      })
      .mockReturnValue({
        shouldReview: false,
        filePath: "",
        reason: "not a write tool",
      });

    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Writing component",
        toolCalls: [
          {
            id: "tc_fw",
            function: {
              name: "file_write",
              arguments: JSON.stringify({
                path: "/src/component.tsx",
                content: "export function Component() { return <div/>; }",
              }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "Reviewed and looks good." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const selfReviews = eventsOfType(events, "self_review");
    expect(selfReviews.length).toBeGreaterThanOrEqual(1);
    expect(selfReviews[0]?.filePath).toBe("/src/component.tsx");
  });

  // 13. Quality gate evaluation
  it("invokes quality gate for significant file writes when enabled", async () => {
    mockQualityGateShouldEvaluate.mockReturnValue(true);
    mockQualityGateEvaluate.mockResolvedValue({
      score: 0.5,
      scores: {
        correctness: 0.5,
        completeness: 0.5,
        conventions: 0.5,
        security: 0.5,
        performance: 0.5,
      },
      issues: [
        {
          category: "correctness" as const,
          severity: "high" as const,
          description: "Missing error handling",
        },
      ],
      verdict: "revise",
    });
    mockQualityGateGetFeedbackPrompt.mockReturnValue(
      "[Quality Gate REVISION NEEDED] Please fix issues."
    );

    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Writing large file",
        toolCalls: [
          {
            id: "tc_qg",
            function: {
              name: "file_write",
              arguments: JSON.stringify({
                path: "/src/service.ts",
                content: "export class Service { /* large implementation */ }",
              }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "Fixed the issues." })
    );

    const engine = await getEngine();
    await collectEvents(engine.execute(makeCtx()));

    expect(mockQualityGateShouldEvaluate).toHaveBeenCalled();
    expect(mockQualityGateEvaluate).toHaveBeenCalled();
    expect(mockQualityGateGetFeedbackPrompt).toHaveBeenCalled();
  });

  // 14. Checkpoint events — need >5 unique files changed AND iteration index > 3
  it("emits checkpoint event when many files changed", async () => {
    const ctx = makeCtx({
      options: {
        maxIterations: 10,
        slot: "default",
        speculate: false,
        workDir: "/workspace",
        temperature: 0.1,
        maxTokens: 4096,
      },
    });

    // Iterations 0-2: write 2 unique files each (6 total unique files)
    for (let i = 0; i < 3; i++) {
      mockFetch.mockResolvedValueOnce(
        jsonRouteResponse({
          content: `Batch ${i}`,
          toolCalls: [
            {
              id: `tc_w${i * 2}`,
              function: {
                name: "file_write",
                arguments: JSON.stringify({
                  path: `/src/file${i * 2}.ts`,
                  content: `export const x = ${i * 2};`,
                }),
              },
            },
            {
              id: `tc_w${i * 2 + 1}`,
              function: {
                name: "file_write",
                arguments: JSON.stringify({
                  path: `/src/file${i * 2 + 1}.ts`,
                  content: `export const x = ${i * 2 + 1};`,
                }),
              },
            },
          ],
        })
      );
    }
    // Iteration 3: another tool call so iteration continues
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Continuing",
        toolCalls: [
          {
            id: "tc_read3",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: "/src/file0.ts" }),
            },
          },
        ],
      })
    );
    // Iteration 4: tool call — checkpoint check runs with i=4 and 6 files
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "More work",
        toolCalls: [
          {
            id: "tc_read4",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: "/src/file1.ts" }),
            },
          },
        ],
      })
    );
    // Iteration 5: done
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "All done." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(ctx));

    const checkpoints = eventsOfType(events, "checkpoint");
    const largeChangeCheckpoints = checkpoints.filter(
      (c) => c.checkpointType === "large_change"
    );
    expect(largeChangeCheckpoints.length).toBeGreaterThanOrEqual(1);
    expect(largeChangeCheckpoints[0]?.affectedFiles.length).toBeGreaterThan(5);
  });

  // 15. Credit update events
  it("emits credit_update events for each iteration", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Working on it",
        toolCalls: [
          {
            id: "tc_1",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: "/src/a.ts" }),
            },
          },
        ],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 200,
          total_tokens: 700,
          cost_usd: 0.005,
        },
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Done.",
        usage: {
          prompt_tokens: 300,
          completion_tokens: 100,
          total_tokens: 400,
          cost_usd: 0.003,
        },
      })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const creditUpdates = eventsOfType(events, "credit_update");
    expect(creditUpdates.length).toBeGreaterThanOrEqual(2);

    expect(creditUpdates[0]?.creditsConsumed).toBe(1);
    expect(creditUpdates[0]?.totalCreditsConsumed).toBe(1);

    expect(creditUpdates[1]?.creditsConsumed).toBe(1);
    expect(creditUpdates[1]?.totalCreditsConsumed).toBe(2);
  });

  // 16. All events have correct metadata
  it("all events include sessionId, agentRole, sequence, and timestamp", async () => {
    mockFetch.mockResolvedValueOnce(jsonRouteResponse({ content: "Hello." }));

    const engine = await getEngine();
    const ctx = makeCtx();
    const events = await collectEvents(engine.execute(ctx));

    for (const event of events) {
      expect(event.sessionId).toBe(ctx.sessionId);
      expect(event.agentRole).toBe(ctx.agentRole);
      expect(typeof event.sequence).toBe("number");
      expect(typeof event.timestamp).toBe("string");
    }

    for (let i = 1; i < events.length; i++) {
      expect((events[i] as ExecutionEvent).sequence).toBeGreaterThan(
        (events[i - 1] as ExecutionEvent).sequence
      );
    }
  });

  // 17. Tool execution failure tracking
  it("handles tool execution errors and tracks consecutive failures", async () => {
    mockToolExecute.mockRejectedValue(new Error("Sandbox unavailable"));

    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({
        content: "Trying a tool",
        toolCalls: [
          {
            id: "tc_fail1",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: "/nonexistent" }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "OK, stopping." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const toolResults = eventsOfType(events, "tool_result");
    expect(toolResults.length).toBeGreaterThanOrEqual(1);
    expect(toolResults[0]?.success).toBe(false);
    expect(toolResults[0]?.error).toContain("Sandbox unavailable");
  });

  // 18. Consecutive tool failures hit blocker threshold
  it("stops execution when consecutive tool failures reach blocker threshold", async () => {
    mockToolExecute.mockRejectedValue(new Error("Sandbox down"));

    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(
        jsonRouteResponse({
          content: `Attempt ${i + 1}`,
          toolCalls: [
            {
              id: `tc_fail_${i}`,
              function: {
                name: "file_read",
                arguments: JSON.stringify({ path: `/file${i}` }),
              },
            },
          ],
        })
      );
    }

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const errors = eventsOfType(events, "error");
    const unrecoverable = errors.filter((e) => !e.recoverable);
    expect(unrecoverable.length).toBeGreaterThanOrEqual(1);
    expect(unrecoverable[0]?.error).toContain("consecutive tool failures");

    const completes = eventsOfType(events, "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.success).toBe(false);
  });

  // 19. Circuit breaker
  it("handles open circuit breaker as a recoverable error", async () => {
    const { modelRouterClient } = await import("@prometheus/utils");
    vi.mocked(modelRouterClient.getCircuitState).mockReturnValue(
      "open" as never
    );

    const engine = await getEngine();
    const ctx = makeCtx({
      options: {
        maxIterations: 5,
        slot: "default",
        speculate: false,
        workDir: "/workspace",
        temperature: 0.1,
        maxTokens: 4096,
      },
    });
    const events = await collectEvents(engine.execute(ctx));

    const errors = eventsOfType(events, "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const unrecoverable = errors.filter((e) => !e.recoverable);
    expect(unrecoverable.length).toBeGreaterThanOrEqual(1);

    vi.mocked(modelRouterClient.getCircuitState).mockReturnValue(
      "closed" as never
    );
  });

  // 20. SSE streaming token events
  it("yields individual token events from SSE streaming", async () => {
    mockFetch.mockResolvedValueOnce(
      sseRouteResponse({ content: "Hello world" })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const tokens = eventsOfType(events, "token");
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    const fullContent = tokens.map((t) => t.content).join("");
    expect(fullContent).toBe("Hello world");
  });

  // 21. SSE streaming with tool calls
  it("handles SSE streaming with tool calls", async () => {
    mockFetch.mockResolvedValueOnce(
      sseRouteResponse({
        content: "Let me read that file.",
        toolCalls: [
          {
            id: "tc_sse_1",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: "/src/app.ts" }),
            },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      sseRouteResponse({ content: "Done reading." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const tokens = eventsOfType(events, "token");
    expect(tokens.length).toBeGreaterThanOrEqual(1);

    const toolCalls = eventsOfType(events, "tool_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(toolCalls[0]?.toolName).toBe("file_read");
  });

  // 22. HTTP error from model-router recovery
  it("treats HTTP error from model-router as a recoverable failure", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      })
    );
    mockFetch.mockResolvedValueOnce(
      jsonRouteResponse({ content: "Recovered." })
    );

    const engine = await getEngine();
    const events = await collectEvents(engine.execute(makeCtx()));

    const errors = eventsOfType(events, "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.recoverable).toBe(true);
    expect(errors[0]?.error).toContain("500");

    const completes = eventsOfType(events, "complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.success).toBe(true);
  });
});
