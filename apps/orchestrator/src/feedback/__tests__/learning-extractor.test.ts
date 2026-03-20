import { beforeEach, describe, expect, it, vi } from "vitest";

const CAUSAL_TOOL_PATTERN = /analyze|plan|code/;

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@prometheus/utils", () => ({
  generateId: () => "test-id-123",
  projectBrainClient: {
    post: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({ data: { memories: [] } }),
  },
}));

import { LearningExtractor, type SessionAnalysis } from "../learning-extractor";

function makeAnalysis(
  overrides: Partial<SessionAnalysis> = {}
): SessionAnalysis {
  return {
    sessionId: "sess-1",
    projectId: "proj-1",
    agentRole: "coder",
    taskType: "bug_fix",
    success: true,
    totalDuration: 5000,
    totalTokens: 1500,
    filesChanged: ["src/app.ts"],
    toolCalls: [
      { name: "readFile", success: true, duration: 100 },
      { name: "writeFile", success: true, duration: 200 },
    ],
    errorMessages: [],
    qualityScore: 0.85,
    ...overrides,
  };
}

describe("LearningExtractor", () => {
  let extractor: LearningExtractor;

  beforeEach(() => {
    extractor = new LearningExtractor();
  });

  // -----------------------------------------------------------------------
  // Promotion threshold
  // -----------------------------------------------------------------------

  it("does not persist patterns below PROMOTION_THRESHOLD", async () => {
    const { projectBrainClient } = await import("@prometheus/utils");
    const postSpy = vi.mocked(projectBrainClient.post);
    postSpy.mockClear();

    // First session: patterns have occurrences=1, below threshold of 3
    const patterns = await extractor.extract(makeAnalysis());
    // All patterns at this point should have low occurrences
    const promoted = patterns.filter(
      (p) => p.occurrences >= LearningExtractor.PROMOTION_THRESHOLD
    );
    expect(promoted.length).toBe(0);
    // No persistence call for patterns below threshold
    expect(postSpy).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Tool pattern extraction — high success rate
  // -----------------------------------------------------------------------

  it("extracts tool patterns for highly successful tools after enough sessions", async () => {
    // Feed 3 sessions with the same tool succeeding to get occurrences >= 3
    const analysis = makeAnalysis({
      toolCalls: [
        { name: "astGrep", success: true, duration: 50 },
        { name: "astGrep", success: true, duration: 60 },
      ],
    });

    await extractor.extract(analysis);
    await extractor.extract(analysis);
    const patterns = await extractor.extract(analysis);

    const toolPatterns = patterns.filter(
      (p) => p.type === "tool_pattern" && p.pattern.includes("astGrep")
    );
    expect(toolPatterns.length).toBeGreaterThanOrEqual(1);

    const pattern = toolPatterns[0];
    expect(pattern?.pattern).toContain("highly effective");
    expect(pattern?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  // -----------------------------------------------------------------------
  // Tool pattern extraction — failing tools
  // -----------------------------------------------------------------------

  it("extracts anti-pattern for frequently failing tools", async () => {
    const analysis = makeAnalysis({
      toolCalls: [
        { name: "badTool", success: false, duration: 100 },
        { name: "badTool", success: false, duration: 100 },
      ],
    });

    // Feed enough sessions to accumulate failCount >= 4 with failRate >= 60%
    await extractor.extract(analysis);
    await extractor.extract(analysis);
    const patterns = await extractor.extract(analysis);

    const antiPatterns = patterns.filter(
      (p) => p.type === "anti_pattern" && p.pattern.includes("badTool")
    );
    // After 3 sessions with 2 fails each = 6 total, all fails => failRate = 100%
    expect(antiPatterns.length).toBeGreaterThanOrEqual(1);
    expect(antiPatterns[0]?.pattern).toContain("AVOID");
  });

  // -----------------------------------------------------------------------
  // Error pattern extraction with resolution tracking
  // -----------------------------------------------------------------------

  it("extracts error resolution patterns with resolution tools", async () => {
    const analysis = makeAnalysis({
      success: true,
      errorMessages: ["TypeError: cannot read property of undefined"],
      toolCalls: [
        { name: "debugger", success: true, duration: 50 },
        { name: "writeFile", success: true, duration: 100 },
      ],
    });

    // Need at least 2 occurrences of the same error
    await extractor.extract(analysis);
    const patterns = await extractor.extract(analysis);

    const errorPatterns = patterns.filter((p) => p.type === "error_resolution");
    expect(errorPatterns.length).toBeGreaterThanOrEqual(1);
    expect(errorPatterns[0]?.pattern).toContain("Recurring error");
    expect(errorPatterns[0]?.pattern).toContain("Previously resolved by");
  });

  // -----------------------------------------------------------------------
  // Quality correlation analysis
  // -----------------------------------------------------------------------

  it("detects quality correlations after enough quality snapshots", async () => {
    // High-quality sessions with more tokens
    for (let i = 0; i < 3; i++) {
      await extractor.extract(
        makeAnalysis({
          sessionId: `high-${i}`,
          qualityScore: 0.95,
          totalTokens: 5000,
          filesChanged: ["a.ts", "b.ts", "c.ts"],
          toolCalls: [
            { name: "analyze", success: true },
            { name: "writeFile", success: true },
          ],
        })
      );
    }

    // Low-quality sessions with fewer tokens
    for (let i = 0; i < 3; i++) {
      await extractor.extract(
        makeAnalysis({
          sessionId: `low-${i}`,
          qualityScore: 0.2,
          totalTokens: 500,
          filesChanged: ["x.ts"],
          toolCalls: [{ name: "writeFile", success: true }],
        })
      );
    }

    // Final extraction to get correlation patterns
    const patterns = await extractor.extract(
      makeAnalysis({
        sessionId: "final",
        qualityScore: 0.9,
        totalTokens: 4000,
      })
    );

    const qualityPatterns = patterns.filter(
      (p) => p.type === "quality_correlation"
    );
    expect(qualityPatterns.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Iteration insights
  // -----------------------------------------------------------------------

  it("generates iteration insights after enough successful sessions", async () => {
    for (let i = 0; i < 4; i++) {
      await extractor.extract(
        makeAnalysis({
          sessionId: `iter-${i}`,
          success: true,
          toolCalls: [
            { name: "read", success: true },
            { name: "write", success: true },
            { name: "test", success: true },
          ],
        })
      );
    }

    const patterns = await extractor.extract(
      makeAnalysis({ sessionId: "iter-final", success: true })
    );

    const iterationPatterns = patterns.filter(
      (p) => p.type === "iteration_insight"
    );
    expect(iterationPatterns.length).toBeGreaterThanOrEqual(1);
    expect(iterationPatterns[0]?.pattern).toContain("iterations");
    expect(iterationPatterns[0]?.pattern).toContain("median");
  });

  // -----------------------------------------------------------------------
  // Conditional pattern detection
  // -----------------------------------------------------------------------

  it("detects conditional patterns from error+tool co-occurrence", async () => {
    // Sessions with a recurring error resolved by a specific tool
    const analysis = makeAnalysis({
      success: true,
      errorMessages: ["SyntaxError: unexpected token in file.ts"],
      toolCalls: [
        { name: "linter", success: true, duration: 50 },
        { name: "linter", success: true, duration: 60 },
      ],
    });

    // Need multiple sessions to build up both error history and tool history
    await extractor.extract(analysis);
    await extractor.extract(analysis);
    const patterns = await extractor.extract(analysis);

    const conditionalPatterns = patterns.filter(
      (p) => p.type === "conditional_pattern"
    );
    expect(conditionalPatterns.length).toBeGreaterThanOrEqual(1);
    expect(conditionalPatterns[0]?.pattern).toContain("linter");
    // Should detect the .ts file type from the error message
    expect(conditionalPatterns[0]?.pattern).toContain(".ts");
  });

  // -----------------------------------------------------------------------
  // Causal chain detection
  // -----------------------------------------------------------------------

  it("detects causal chains from high-quality session tool sequences", async () => {
    // Feed several high-quality sessions with consistent tool sequences
    for (let i = 0; i < 5; i++) {
      await extractor.extract(
        makeAnalysis({
          sessionId: `causal-${i}`,
          qualityScore: 0.9,
          toolCalls: [
            { name: "analyze", success: true },
            { name: "plan", success: true },
            { name: "code", success: true },
          ],
        })
      );
    }

    const patterns = await extractor.extract(
      makeAnalysis({
        sessionId: "causal-final",
        qualityScore: 0.95,
        toolCalls: [
          { name: "analyze", success: true },
          { name: "plan", success: true },
          { name: "code", success: true },
        ],
      })
    );

    const causalPatterns = patterns.filter((p) => p.type === "causal_chain");
    expect(causalPatterns.length).toBeGreaterThanOrEqual(1);
    // Should detect the analyze -> plan or plan -> code sequence
    const patternText = causalPatterns.map((p) => p.pattern).join(" ");
    expect(patternText).toMatch(CAUSAL_TOOL_PATTERN);
  });

  // -----------------------------------------------------------------------
  // Anti-pattern detection — unresolved errors
  // -----------------------------------------------------------------------

  it("detects anti-patterns for unresolved recurring errors", async () => {
    // Failed sessions with the same error, never resolved
    const analysis = makeAnalysis({
      success: false,
      errorMessages: ["OutOfMemoryError: heap allocation failed"],
      toolCalls: [{ name: "run", success: false }],
    });

    await extractor.extract(analysis);
    await extractor.extract(analysis);
    const patterns = await extractor.extract(analysis);

    const antiPatterns = patterns.filter(
      (p) => p.type === "anti_pattern" && p.pattern.includes("UNRESOLVED")
    );
    expect(antiPatterns.length).toBeGreaterThanOrEqual(1);
    expect(antiPatterns[0]?.pattern).toContain("never successfully resolved");
  });

  // -----------------------------------------------------------------------
  // getLearnedContext formatting
  // -----------------------------------------------------------------------

  it("returns empty string when no memories exist", async () => {
    const context = await extractor.getLearnedContext(
      "coder",
      "bug_fix",
      "proj-1"
    );
    expect(context).toBe("");
  });

  it("formats learned context with header and pattern lines", async () => {
    const { projectBrainClient } = await import("@prometheus/utils");
    vi.mocked(projectBrainClient.get).mockResolvedValueOnce({
      data: {
        memories: [
          {
            decision: 'Tool "readFile" is highly effective',
            reasoning: "confidence=0.85, occurrences=5",
            patternType: "tool_pattern",
            agentRole: "coder",
            taskType: "bug_fix",
          },
          {
            decision: "Higher token budgets correlate with quality",
            reasoning: "confidence=0.7, occurrences=8",
            patternType: "quality_correlation",
            agentRole: "coder",
            taskType: "bug_fix",
          },
        ],
      },
    } as never);

    const context = await extractor.getLearnedContext(
      "coder",
      "bug_fix",
      "proj-1"
    );
    expect(context).toContain("## Learned Patterns for coder");
    expect(context).toContain("[Tool]");
    expect(context).toContain("[Quality]");
    expect(context).toContain("85%");
    expect(context).toContain("5x");
  });

  // -----------------------------------------------------------------------
  // PROMOTION_THRESHOLD constant
  // -----------------------------------------------------------------------

  it("has PROMOTION_THRESHOLD set to 3", () => {
    expect(LearningExtractor.PROMOTION_THRESHOLD).toBe(3);
  });
});
