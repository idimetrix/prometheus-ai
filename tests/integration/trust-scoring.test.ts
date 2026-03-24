/**
 * Integration tests: Trust Scoring System.
 *
 * Verifies trust score calculation, persistence, level classification,
 * and governance integration for the 12 specialist agents.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { TrustScorer } from "../../apps/orchestrator/src/governance/trust-scorer";

describe("Trust Scoring System", () => {
  let scorer: TrustScorer;

  beforeEach(() => {
    scorer = new TrustScorer();
  });

  describe("default trust for new agents", () => {
    it("returns supervised level for unknown roles", () => {
      const score = scorer.getTrustLevel("unknown_role");
      expect(score.level).toBe("supervised");
      expect(score.score).toBe(0.7);
    });

    it("returns supervised level for roles with fewer than 3 tasks", () => {
      scorer.recordOutcome("backend_coder", true, 0.9, 5, 1000);
      scorer.recordOutcome("backend_coder", true, 0.8, 6, 1200);
      const score = scorer.getTrustLevel("backend_coder");
      expect(score.level).toBe("supervised");
      expect(score.score).toBe(0.7);
    });
  });

  describe("trust calculation", () => {
    it("computes autonomous level for consistently successful agents", () => {
      for (let i = 0; i < 10; i++) {
        scorer.recordOutcome("backend_coder", true, 0.95, 5, 1000);
      }
      const score = scorer.getTrustLevel("backend_coder");
      expect(score.level).toBe("autonomous");
      expect(score.score).toBeGreaterThan(0.85);
      expect(score.factors.successRate).toBe(1);
    });

    it("computes restricted level for consistently failing agents", () => {
      for (let i = 0; i < 5; i++) {
        scorer.recordOutcome("test_engineer", false, 0.2, 20, 5000, true);
      }
      const score = scorer.getTrustLevel("test_engineer");
      expect(score.level).toBe("restricted");
      expect(score.score).toBeLessThan(0.6);
    });

    it("computes supervised level for mixed results", () => {
      scorer.recordOutcome("frontend_coder", true, 0.8, 5, 1000);
      scorer.recordOutcome("frontend_coder", true, 0.7, 8, 1500);
      scorer.recordOutcome("frontend_coder", false, 0.3, 15, 3000);
      scorer.recordOutcome("frontend_coder", true, 0.6, 10, 2000);
      const score = scorer.getTrustLevel("frontend_coder");
      expect(score.level).toBe("supervised");
      expect(score.score).toBeGreaterThanOrEqual(0.6);
      expect(score.score).toBeLessThanOrEqual(0.85);
    });

    it("penalizes violations", () => {
      for (let i = 0; i < 5; i++) {
        scorer.recordOutcome("security_auditor", true, 0.9, 5, 1000, true);
      }
      const withViolations = scorer.getTrustLevel("security_auditor");

      const scorer2 = new TrustScorer();
      for (let i = 0; i < 5; i++) {
        scorer2.recordOutcome("security_auditor", true, 0.9, 5, 1000, false);
      }
      const withoutViolations = scorer2.getTrustLevel("security_auditor");

      expect(withViolations.score).toBeLessThan(withoutViolations.score);
    });
  });

  describe("getAllScores", () => {
    it("returns scores for all recorded roles", () => {
      for (let i = 0; i < 5; i++) {
        scorer.recordOutcome("backend_coder", true, 0.9, 5, 1000);
        scorer.recordOutcome("frontend_coder", true, 0.8, 6, 1200);
      }
      const scores = scorer.getAllScores();
      expect(Object.keys(scores)).toContain("backend_coder");
      expect(Object.keys(scores)).toContain("frontend_coder");
      expect(Object.keys(scores)).toHaveLength(2);
    });
  });

  describe("persistence", () => {
    it("saves and loads trust history via persistence layer", async () => {
      const store = new Map<string, string>();
      const persistence = {
        get: (key: string) => Promise.resolve(store.get(key) ?? null),
        set: (key: string, value: string) => {
          store.set(key, value);
          return Promise.resolve();
        },
      };

      // Record some outcomes and persist
      scorer.setPersistence(persistence);
      for (let i = 0; i < 5; i++) {
        scorer.recordOutcome("backend_coder", true, 0.9, 5, 1000);
      }

      // Wait for fire-and-forget persistence
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create new scorer, load from persistence
      const scorer2 = new TrustScorer();
      scorer2.setPersistence(persistence);
      await scorer2.loadFromPersistence();

      const originalScore = scorer.getTrustLevel("backend_coder");
      const loadedScore = scorer2.getTrustLevel("backend_coder");

      expect(loadedScore.score).toBeCloseTo(originalScore.score, 2);
      expect(loadedScore.level).toBe(originalScore.level);
    });

    it("handles missing persistence gracefully", async () => {
      const persistence = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
      };

      scorer.setPersistence(persistence);
      await scorer.loadFromPersistence();

      const score = scorer.getTrustLevel("backend_coder");
      expect(score.level).toBe("supervised");
    });

    it("handles persistence errors gracefully", async () => {
      const persistence = {
        get: () => Promise.reject(new Error("Redis connection failed")),
        set: () => Promise.reject(new Error("Redis connection failed")),
      };

      scorer.setPersistence(persistence);
      await scorer.loadFromPersistence();

      // Should still work with in-memory fallback
      scorer.recordOutcome("backend_coder", true, 0.9, 5, 1000);
      const score = scorer.getTrustLevel("backend_coder");
      expect(score).toBeDefined();
    });
  });
});
