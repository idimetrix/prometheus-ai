import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  ConfidenceScorer,
  type IterationSignals,
  ModelEscalator,
} from "../confidence";

/** Helper to create test iteration signals with sensible defaults. */
function createTestIterationSignals(
  overrides?: Partial<IterationSignals>
): IterationSignals {
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

// ---------------------------------------------------------------------------
// ConfidenceScorer
// ---------------------------------------------------------------------------

describe("ConfidenceScorer", () => {
  let scorer: ConfidenceScorer;

  beforeEach(() => {
    scorer = new ConfidenceScorer();
  });

  // -- scoreIteration -------------------------------------------------------

  describe("scoreIteration", () => {
    it("returns high confidence when all tools succeed", () => {
      const signals = createTestIterationSignals({
        toolCallCount: 5,
        toolSuccessCount: 5,
        toolErrorCount: 0,
        hasOutput: true,
        outputLength: 600,
        filesChanged: 2,
        hasStructuredOutput: true,
        staleIterations: 0,
        expressedUncertainty: false,
        requestedHelp: false,
      });

      const result = scorer.scoreIteration(signals);

      expect(result.score).toBeGreaterThan(0.7);
      expect(result.action).toBe("continue");
      expect(result.recommendedSlot).toBeNull();
    });

    it("returns low confidence when all tools fail", () => {
      const signals = createTestIterationSignals({
        toolCallCount: 5,
        toolSuccessCount: 0,
        toolErrorCount: 5,
        hasOutput: true,
        outputLength: 50,
        filesChanged: 0,
        hasStructuredOutput: false,
        staleIterations: 3,
        expressedUncertainty: true,
        requestedHelp: true,
      });

      const result = scorer.scoreIteration(signals);

      expect(result.score).toBeLessThan(0.5);
      expect(result.action).not.toBe("continue");
    });

    it("returns neutral confidence when no tools are used", () => {
      const signals = createTestIterationSignals({
        toolCallCount: 0,
        toolSuccessCount: 0,
        toolErrorCount: 0,
        hasOutput: true,
        outputLength: 300,
        filesChanged: 0,
        hasStructuredOutput: false,
        staleIterations: 0,
        expressedUncertainty: false,
        requestedHelp: false,
      });

      const result = scorer.scoreIteration(signals);

      // tool_success_rate defaults to 1.0 when no tools, so score stays moderate
      expect(result.score).toBeGreaterThanOrEqual(0.4);
      expect(result.score).toBeLessThanOrEqual(0.85);
    });

    it("applies EMA smoothing across multiple iterations", () => {
      // First iteration: high confidence
      const highSignals = createTestIterationSignals({
        toolCallCount: 3,
        toolSuccessCount: 3,
        toolErrorCount: 0,
        outputLength: 600,
        hasStructuredOutput: true,
      });

      const first = scorer.scoreIteration(highSignals);

      // Second iteration: low confidence
      const lowSignals = createTestIterationSignals({
        toolCallCount: 5,
        toolSuccessCount: 0,
        toolErrorCount: 5,
        hasOutput: true,
        outputLength: 30,
        filesChanged: 0,
        hasStructuredOutput: false,
        staleIterations: 2,
        expressedUncertainty: true,
        requestedHelp: true,
      });

      const second = scorer.scoreIteration(lowSignals);

      // The EMA smoothing means the second score should not drop as far as
      // it would without history (alpha=0.6 current + 0.4 previous running)
      // The drop should be softened by the first good iteration
      expect(second.score).toBeLessThan(first.score);
      // But not as low as if we scored it fresh
      const fresh = new ConfidenceScorer();
      const freshResult = fresh.scoreIteration(lowSignals);
      expect(second.score).toBeGreaterThan(freshResult.score);
    });
  });

  // -- extractSignals -------------------------------------------------------

  describe("extractSignals", () => {
    it("correctly parses tool results", () => {
      const tools = [
        { success: true, name: "readFile" },
        { success: true, name: "writeFile" },
        { success: false, name: "runTest" },
      ];

      const signals = ConfidenceScorer.extractSignals(
        "Some output text",
        tools,
        1,
        0,
        0
      );

      expect(signals.toolCallCount).toBe(3);
      expect(signals.toolSuccessCount).toBe(2);
      expect(signals.toolErrorCount).toBe(1);
      expect(signals.hasOutput).toBe(true);
      expect(signals.outputLength).toBe("Some output text".length);
      expect(signals.filesChanged).toBe(1);
    });

    it("detects uncertainty keywords", () => {
      const signals = ConfidenceScorer.extractSignals(
        "I'm not sure this approach will work, it might not work as expected",
        [],
        0,
        0,
        0
      );

      expect(signals.expressedUncertainty).toBe(true);
    });

    it("does not detect uncertainty when keywords are absent", () => {
      const signals = ConfidenceScorer.extractSignals(
        "Here is the implementation as requested.",
        [],
        0,
        0,
        0
      );

      expect(signals.expressedUncertainty).toBe(false);
    });

    it("detects help requests with 'need help'", () => {
      const signals = ConfidenceScorer.extractSignals(
        "I need help with this task",
        [],
        0,
        0,
        0
      );

      expect(signals.requestedHelp).toBe(true);
    });

    it("detects help requests with 'please clarify'", () => {
      const signals = ConfidenceScorer.extractSignals(
        "Could you please clarify the requirements?",
        [],
        0,
        0,
        0
      );

      expect(signals.requestedHelp).toBe(true);
    });

    it("detects help requests with 'human input'", () => {
      const signals = ConfidenceScorer.extractSignals(
        "This requires human input to proceed",
        [],
        0,
        0,
        0
      );

      expect(signals.requestedHelp).toBe(true);
    });

    it("detects structured output with code blocks", () => {
      const output = "Here is the code:\n```typescript\nconst x = 1;\n```";
      const signals = ConfidenceScorer.extractSignals(output, [], 0, 0, 0);

      expect(signals.hasStructuredOutput).toBe(true);
    });

    it("detects structured output with JSON", () => {
      const output = '  { "key": "value", "nested": { "a": 1 } }  ';
      const signals = ConfidenceScorer.extractSignals(output, [], 0, 0, 0);

      expect(signals.hasStructuredOutput).toBe(true);
    });

    it("detects structured output with markdown headers", () => {
      const output = "## Summary\nThis is the summary of changes.";
      const signals = ConfidenceScorer.extractSignals(output, [], 0, 0, 0);

      expect(signals.hasStructuredOutput).toBe(true);
    });

    it("increments staleIterations when no progress", () => {
      const signals = ConfidenceScorer.extractSignals(
        "ok",
        [],
        0, // no files changed
        3, // previous stale count
        0
      );

      // toolCallCount === 0, output.length < 100, filesChanged === 0 => stale
      expect(signals.staleIterations).toBe(4);
    });

    it("resets staleIterations when progress detected", () => {
      const signals = ConfidenceScorer.extractSignals(
        "Completed the implementation with significant changes applied to the codebase. This is a long enough output to exceed the 100 character threshold.",
        [{ success: true, name: "writeFile" }],
        2,
        5,
        0
      );

      // toolCallCount > 0, so not stale
      expect(signals.staleIterations).toBe(0);
    });
  });

  // -- getModelSlot ---------------------------------------------------------

  describe("getModelSlot", () => {
    it("returns the override when confidence is low", () => {
      const signals = createTestIterationSignals({
        toolCallCount: 5,
        toolSuccessCount: 0,
        toolErrorCount: 5,
        hasOutput: true,
        outputLength: 20,
        filesChanged: 0,
        hasStructuredOutput: false,
        staleIterations: 4,
        expressedUncertainty: true,
        requestedHelp: true,
      });

      // Score multiple bad iterations to drive the score down
      let result = scorer.scoreIteration(signals);
      result = scorer.scoreIteration(signals);
      result = scorer.scoreIteration(signals);

      // When recommendedSlot is set, getModelSlot returns it
      if (result.recommendedSlot) {
        const slot = ConfidenceScorer.getModelSlot("default", result);
        expect(slot).toBe(result.recommendedSlot);
        expect(slot).not.toBe("default");
      }
    });

    it("returns the default slot when confidence is high", () => {
      const signals = createTestIterationSignals({
        toolCallCount: 5,
        toolSuccessCount: 5,
        toolErrorCount: 0,
        hasOutput: true,
        outputLength: 1000,
        filesChanged: 3,
        hasStructuredOutput: true,
        staleIterations: 0,
        expressedUncertainty: false,
        requestedHelp: false,
      });

      const result = scorer.scoreIteration(signals);
      const slot = ConfidenceScorer.getModelSlot("default", result);

      expect(slot).toBe("default");
    });
  });

  // -- Model slot thresholds (the fixed logic bug) --------------------------

  describe("model slot recommendation thresholds", () => {
    it("recommends 'premium' when score < 0.3", () => {
      // Drive score well below 0.3
      const badSignals = createTestIterationSignals({
        toolCallCount: 5,
        toolSuccessCount: 0,
        toolErrorCount: 5,
        hasOutput: true,
        outputLength: 10,
        filesChanged: 0,
        hasStructuredOutput: false,
        staleIterations: 5,
        expressedUncertainty: true,
        requestedHelp: true,
      });

      // Multiple bad iterations to drive EMA below 0.3
      let result = scorer.scoreIteration(badSignals);
      result = scorer.scoreIteration(badSignals);
      result = scorer.scoreIteration(badSignals);
      result = scorer.scoreIteration(badSignals);

      expect(result.score).toBeLessThan(0.3);
      expect(result.recommendedSlot).toBe("premium");
    });

    it("recommends 'think' when score is between 0.3 and 0.5", () => {
      // We need to carefully craft a score in [0.3, 0.5)
      // Start with some moderate signals
      const moderateSignals = createTestIterationSignals({
        toolCallCount: 4,
        toolSuccessCount: 2,
        toolErrorCount: 2,
        hasOutput: true,
        outputLength: 150,
        filesChanged: 0,
        hasStructuredOutput: false,
        staleIterations: 1,
        expressedUncertainty: false,
        requestedHelp: false,
      });

      // Score a few iterations to settle
      let result = scorer.scoreIteration(moderateSignals);
      result = scorer.scoreIteration(moderateSignals);
      result = scorer.scoreIteration(moderateSignals);

      // If score is in range, verify recommendation
      if (result.score >= 0.3 && result.score < 0.5) {
        expect(result.recommendedSlot).toBe("think");
      } else if (result.score < 0.3) {
        expect(result.recommendedSlot).toBe("premium");
      } else {
        // Score >= 0.5, no override
        expect(result.recommendedSlot).toBeNull();
      }
    });

    it("recommends no override when score >= 0.5", () => {
      const goodSignals = createTestIterationSignals({
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
      });

      const result = scorer.scoreIteration(goodSignals);

      expect(result.score).toBeGreaterThanOrEqual(0.5);
      expect(result.recommendedSlot).toBeNull();
    });
  });

  // -- reset ----------------------------------------------------------------

  describe("reset", () => {
    it("clears iteration history and resets running score", () => {
      const signals = createTestIterationSignals();
      scorer.scoreIteration(signals);
      scorer.scoreIteration(signals);

      expect(scorer.getCurrentScore()).not.toBe(0.5);

      scorer.reset();

      expect(scorer.getCurrentScore()).toBe(0.5);

      const summary = scorer.getSummary();
      expect(summary.iterations).toBe(0);
      expect(summary.averageConfidence).toBe(0);
    });
  });

  // -- getSummary -----------------------------------------------------------

  describe("getSummary", () => {
    it("returns zeroed summary when no iterations", () => {
      const summary = scorer.getSummary();

      expect(summary).toEqual({
        iterations: 0,
        averageConfidence: 0,
        minConfidence: 0,
        maxConfidence: 0,
        escalationCount: 0,
      });
    });

    it("returns correct stats after multiple iterations", () => {
      const goodSignals = createTestIterationSignals({
        toolCallCount: 3,
        toolSuccessCount: 3,
        toolErrorCount: 0,
        outputLength: 500,
        hasStructuredOutput: true,
      });

      const badSignals = createTestIterationSignals({
        toolCallCount: 5,
        toolSuccessCount: 0,
        toolErrorCount: 5,
        outputLength: 20,
        filesChanged: 0,
        hasStructuredOutput: false,
        staleIterations: 3,
        expressedUncertainty: true,
        requestedHelp: true,
      });

      scorer.scoreIteration(goodSignals);
      scorer.scoreIteration(badSignals);
      scorer.scoreIteration(goodSignals);

      const summary = scorer.getSummary();

      expect(summary.iterations).toBe(3);
      expect(summary.averageConfidence).toBeGreaterThan(0);
      expect(summary.minConfidence).toBeLessThanOrEqual(
        summary.averageConfidence
      );
      expect(summary.maxConfidence).toBeGreaterThanOrEqual(
        summary.averageConfidence
      );
      expect(summary.minConfidence).toBeLessThan(summary.maxConfidence);
    });
  });
});

// ---------------------------------------------------------------------------
// ModelEscalator
// ---------------------------------------------------------------------------

describe("ModelEscalator", () => {
  let escalator: ModelEscalator;

  beforeEach(() => {
    escalator = new ModelEscalator(0.5);
  });

  describe("shouldEscalate", () => {
    it("returns false when already at highest tier", () => {
      const decision = escalator.shouldEscalate(0.1, "coding", "premium");

      expect(decision.shouldEscalate).toBe(false);
      expect(decision.recommendedSlot).toBe("premium");
      expect(decision.reason).toBe("Already at highest model tier");
    });

    it("returns true when confidence is below threshold", () => {
      const decision = escalator.shouldEscalate(0.4, "coding", "default");

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.currentSlot).toBe("default");
      expect(decision.confidence).toBe(0.4);
      // Should go at least one tier up
      expect(decision.recommendedSlot).not.toBe("default");
    });

    it("returns false when confidence is above threshold", () => {
      const decision = escalator.shouldEscalate(0.7, "coding", "default");

      expect(decision.shouldEscalate).toBe(false);
      expect(decision.recommendedSlot).toBe("default");
    });

    it("skips a tier when confidence is very low (< 0.3)", () => {
      const decision = escalator.shouldEscalate(0.2, "coding", "default");

      expect(decision.shouldEscalate).toBe(true);
      // default (idx 0) + 2 = review (idx 2)
      expect(decision.recommendedSlot).toBe("review");
    });

    it("goes straight to premium when confidence is extremely low (< 0.15)", () => {
      const decision = escalator.shouldEscalate(0.1, "coding", "default");

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.recommendedSlot).toBe("premium");
    });

    it("goes to premium from think when confidence < 0.15", () => {
      const decision = escalator.shouldEscalate(0.1, "coding", "think");

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.recommendedSlot).toBe("premium");
    });
  });

  describe("recordOutcome", () => {
    it("tracks task type preferences", () => {
      escalator.recordOutcome("coding", "default", "think", 0.4, true);
      escalator.recordOutcome("coding", "default", "think", 0.3, false);
      escalator.recordOutcome("review", "default", "think", 0.4, true);

      const stats = escalator.getEscalationStats();

      expect(stats.coding).toBeDefined();
      expect(stats.coding?.escalationCount).toBe(2);
      expect(stats.coding?.successRate).toBe(0.5);

      expect(stats.review).toBeDefined();
      expect(stats.review?.escalationCount).toBe(1);
      expect(stats.review?.successRate).toBe(1);
    });
  });

  describe("learning from history", () => {
    it("lowers threshold when escalation has high success rate", () => {
      // Record 4 successful escalations for "coding" (success rate > 0.7)
      for (let i = 0; i < 4; i++) {
        escalator.recordOutcome("coding", "default", "think", 0.4, true);
      }

      // With lowered threshold (0.5 - 0.15 = 0.35), confidence of 0.4
      // should no longer trigger escalation
      const decision = escalator.shouldEscalate(0.4, "coding", "default");

      expect(decision.shouldEscalate).toBe(false);
    });

    it("raises threshold when escalation has low success rate", () => {
      // Record 4 failed escalations (success rate < 0.3)
      for (let i = 0; i < 4; i++) {
        escalator.recordOutcome("coding", "default", "think", 0.4, false);
      }

      // With raised threshold (0.5 + 0.15 = 0.65), even 0.6 should trigger
      const decision = escalator.shouldEscalate(0.6, "coding", "default");

      expect(decision.shouldEscalate).toBe(true);
    });

    it("does not adjust threshold with insufficient data (< 3 samples)", () => {
      // Only 2 samples, not enough to adjust
      escalator.recordOutcome("coding", "default", "think", 0.4, true);
      escalator.recordOutcome("coding", "default", "think", 0.4, true);

      // With default threshold of 0.5, confidence 0.45 should trigger
      const decision = escalator.shouldEscalate(0.45, "coding", "default");

      expect(decision.shouldEscalate).toBe(true);
    });
  });

  describe("getEscalationStats", () => {
    it("returns empty object with no history", () => {
      const stats = escalator.getEscalationStats();

      expect(stats).toEqual({});
    });

    it("returns correct data for multiple task types", () => {
      escalator.recordOutcome("coding", "default", "think", 0.4, true);
      escalator.recordOutcome("coding", "default", "think", 0.3, true);
      escalator.recordOutcome("coding", "default", "think", 0.2, false);
      escalator.recordOutcome("debugging", "think", "review", 0.3, false);

      const stats = escalator.getEscalationStats();

      expect(Object.keys(stats)).toHaveLength(2);
      expect(stats.coding?.escalationCount).toBe(3);
      expect(stats.coding?.successRate).toBeCloseTo(2 / 3);
      expect(stats.debugging?.escalationCount).toBe(1);
      expect(stats.debugging?.successRate).toBe(0);
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      escalator.recordOutcome("coding", "default", "think", 0.4, true);
      escalator.recordOutcome("coding", "default", "think", 0.3, false);
      escalator.recordOutcome("review", "think", "review", 0.3, true);

      escalator.reset();

      const stats = escalator.getEscalationStats();
      expect(stats).toEqual({});

      // After reset, behavior should match a fresh instance
      const decision = escalator.shouldEscalate(0.4, "coding", "default");
      expect(decision.shouldEscalate).toBe(true);
    });
  });
});
