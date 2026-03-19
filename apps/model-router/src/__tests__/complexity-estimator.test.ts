import { describe, expect, it } from "vitest";
import { ComplexityEstimator } from "../complexity-estimator";

const FAST_OR_BALANCED_RE = /fast|balanced/;

function makeRequest(content: string, taskType?: string) {
  return {
    messages: [{ role: "user", content }],
    taskType,
  };
}

describe("ComplexityEstimator", () => {
  describe("simple queries", () => {
    it("assigns low complexity to a short, simple question", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(makeRequest("Fix the typo in README"));
      expect(result.score).toBeLessThanOrEqual(2);
      expect(result.recommendedSlot).toMatch(FAST_OR_BALANCED_RE);
    });

    it("assigns low complexity to a single-file change", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("Update the color of the button in styles.css")
      );
      expect(result.score).toBeLessThanOrEqual(3);
    });

    it("includes score in reasoning", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(makeRequest("Hello"));
      expect(result.reasoning).toContain("Complexity score:");
    });
  });

  describe("multi-step instructions", () => {
    it("detects numbered list as multi-step", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest(
          "1. Create the database schema\n2. Build the API endpoints\n3. Write the tests\n4. Deploy to staging"
        )
      );
      expect(result.signals.isMultiStep).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(2);
    });

    it("detects sequential keywords as multi-step", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest(
          "First create the user model, then build the authentication service, after that add the middleware"
        )
      );
      expect(result.signals.isMultiStep).toBe(true);
    });

    it("detects 'and also' pattern as multi-step", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest(
          "Update the API handler and also add error handling, additionally write unit tests"
        )
      );
      expect(result.signals.isMultiStep).toBe(true);
    });

    it("detects 'multiple files' pattern as multi-step", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("Update multiple files across the frontend and backend")
      );
      expect(result.signals.isMultiStep).toBe(true);
    });

    it("does not flag simple sentences as multi-step", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(makeRequest("Fix the login bug"));
      expect(result.signals.isMultiStep).toBe(false);
    });
  });

  describe("domain keywords", () => {
    it("detects architecture keywords", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest(
          "Design the system architecture for a distributed microservice platform with scalability requirements"
        )
      );
      expect(result.signals.hasDomainKeywords).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(2);
    });

    it("detects security keywords", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest(
          "Implement authentication and authorization with encryption for handling vulnerability scanning"
        )
      );
      expect(result.signals.hasDomainKeywords).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(2);
    });

    it("detects database complexity keywords", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest(
          "Fix the race condition and deadlock in the database transaction handling"
        )
      );
      expect(result.signals.hasDomainKeywords).toBe(true);
    });

    it("detects performance keywords", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest(
          "Investigate the memory leak and optimize caching performance"
        )
      );
      expect(result.signals.hasDomainKeywords).toBe(true);
    });

    it("does not flag simple text without domain keywords", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("Add a new button to the page")
      );
      expect(result.signals.hasDomainKeywords).toBe(false);
    });
  });

  describe("file reference counting", () => {
    it("counts referenced .ts files", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest(
          "Update `src/auth.ts`, `src/middleware.ts`, and `src/routes.ts`"
        )
      );
      expect(result.signals.fileCount).toBeGreaterThanOrEqual(3);
    });

    it("counts referenced .sql files with higher weight", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("Run the migration in `db/001.sql` and `db/002.sql`")
      );
      expect(result.signals.fileCount).toBeGreaterThanOrEqual(2);
    });

    it("reports zero file count for text without file references", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("Just fix the login issue please")
      );
      expect(result.signals.fileCount).toBe(0);
    });
  });

  describe("token count estimation", () => {
    it("estimates approximately 4 chars per token", () => {
      const estimator = new ComplexityEstimator();
      const text = "x".repeat(400); // ~100 tokens
      const result = estimator.estimate(makeRequest(text));
      expect(result.signals.tokenCount).toBe(100);
    });

    it("large input contributes to higher score", () => {
      const estimator = new ComplexityEstimator();
      const longText = "Implement a comprehensive feature. ".repeat(200);
      const result = estimator.estimate(makeRequest(longText));
      expect(result.signals.tokenCount).toBeGreaterThan(1000);
    });
  });

  describe("slot mapping", () => {
    it("maps score 1 to fast", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(makeRequest("Hi"));
      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.score).toBeLessThanOrEqual(5);
      // The actual slot depends on the score
      const slotMap: Record<number, string> = {
        1: "fast",
        2: "balanced",
        3: "capable",
        4: "strong",
        5: "flagship",
      };
      expect(result.recommendedSlot).toBe(slotMap[result.score]);
    });

    it("returns a valid slot for all complexity levels", () => {
      const estimator = new ComplexityEstimator();
      const validSlots = ["fast", "balanced", "capable", "strong", "flagship"];

      // Test with various inputs
      const inputs = [
        "Fix typo",
        "Build authentication with encryption and security vulnerability scanning for distributed microservice architecture",
        "1. Create schema\n2. Build API\n3. Write tests\n4. Deploy\n5. Monitor",
      ];

      for (const input of inputs) {
        const result = estimator.estimate(makeRequest(input));
        expect(validSlots).toContain(result.recommendedSlot);
        expect(result.score).toBeGreaterThanOrEqual(1);
        expect(result.score).toBeLessThanOrEqual(5);
      }
    });
  });

  describe("historical difficulty tracking", () => {
    it("defaults to 0.5 for unknown task types", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("Do something", "unknown_type")
      );
      expect(result.signals.historicalDifficulty).toBe(0.5);
    });

    it("adjusts based on recorded outcomes", () => {
      const estimator = new ComplexityEstimator();

      // Record several high-difficulty outcomes
      for (let i = 0; i < 5; i++) {
        estimator.recordOutcome("hard_type", 0.9);
      }

      const result = estimator.estimate(
        makeRequest("Do something", "hard_type")
      );
      expect(result.signals.historicalDifficulty).toBeCloseTo(0.9, 1);
    });

    it("adjusts based on low-difficulty outcomes", () => {
      const estimator = new ComplexityEstimator();

      for (let i = 0; i < 5; i++) {
        estimator.recordOutcome("easy_type", 0.1);
      }

      const result = estimator.estimate(
        makeRequest("Do something", "easy_type")
      );
      expect(result.signals.historicalDifficulty).toBeCloseTo(0.1, 1);
    });

    it("clamps recorded difficulty to 0-1 range", () => {
      const estimator = new ComplexityEstimator();
      estimator.recordOutcome("clamped", -0.5);
      estimator.recordOutcome("clamped", 1.5);

      const result = estimator.estimate(makeRequest("Test", "clamped"));
      // -0.5 clamped to 0, 1.5 clamped to 1, average = 0.5
      expect(result.signals.historicalDifficulty).toBe(0.5);
    });

    it("maintains a sliding window of 50 entries", () => {
      const estimator = new ComplexityEstimator();

      // Add 50 low values
      for (let i = 0; i < 50; i++) {
        estimator.recordOutcome("sliding", 0.1);
      }

      // Add 10 high values (should push out 10 low values)
      for (let i = 0; i < 10; i++) {
        estimator.recordOutcome("sliding", 1.0);
      }

      const result = estimator.estimate(makeRequest("Test", "sliding"));
      // 40 entries of 0.1 + 10 entries of 1.0 = (4 + 10) / 50 = 0.28
      expect(result.signals.historicalDifficulty).toBeGreaterThan(0.2);
      expect(result.signals.historicalDifficulty).toBeLessThan(0.4);
    });

    it("mentions high difficulty in reasoning", () => {
      const estimator = new ComplexityEstimator();
      for (let i = 0; i < 10; i++) {
        estimator.recordOutcome("difficult", 0.9);
      }
      const result = estimator.estimate(
        makeRequest("Do something", "difficult")
      );
      expect(result.reasoning).toContain("typically difficult");
    });

    it("mentions low difficulty in reasoning", () => {
      const estimator = new ComplexityEstimator();
      for (let i = 0; i < 10; i++) {
        estimator.recordOutcome("easy", 0.1);
      }
      const result = estimator.estimate(makeRequest("Do something", "easy"));
      expect(result.reasoning).toContain("typically straightforward");
    });
  });

  describe("reasoning output", () => {
    it("mentions large input for long prompts", () => {
      const estimator = new ComplexityEstimator();
      const longText = "x".repeat(10_000); // >2000 tokens
      const result = estimator.estimate(makeRequest(longText));
      expect(result.reasoning).toContain("Large input");
    });

    it("mentions file count when files are referenced", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("Update `a.ts`, `b.ts`, `c.ts`")
      );
      expect(result.reasoning).toContain("file(s)");
    });

    it("mentions multi-step for multi-step tasks", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("First do X, then do Y, after that do Z")
      );
      expect(result.reasoning).toContain("multi-step");
    });

    it("mentions domain keywords when present", () => {
      const estimator = new ComplexityEstimator();
      const result = estimator.estimate(
        makeRequest("Design the architecture for a distributed system")
      );
      expect(result.reasoning).toContain("Domain-specific keywords");
    });
  });

  describe("composite scoring", () => {
    it("produces higher scores for complex requests", () => {
      const estimator = new ComplexityEstimator();

      const simple = estimator.estimate(makeRequest("Fix a typo"));
      const complex = estimator.estimate(
        makeRequest(
          "First, design the distributed system architecture with encryption and authentication. " +
            "Then implement the database schema with migration handling for race conditions. " +
            "After that, build integration tests and deploy to kubernetes. " +
            "Update `src/auth.ts`, `src/db.ts`, `src/middleware.ts`, `src/routes.ts`, `src/deploy.ts`, `src/tests.ts`"
        )
      );

      expect(complex.score).toBeGreaterThan(simple.score);
    });

    it("score is always between 1 and 5", () => {
      const estimator = new ComplexityEstimator();

      const inputs = [
        "",
        "Hi",
        "x".repeat(50_000),
        "architecture security encryption distributed deadlock race condition " +
          "state machine event sourcing cqrs saga concurrent parallel " +
          "1. first\n2. second\n3. third\n4. fourth\n5. fifth",
      ];

      for (const input of inputs) {
        const result = estimator.estimate(makeRequest(input));
        expect(result.score).toBeGreaterThanOrEqual(1);
        expect(result.score).toBeLessThanOrEqual(5);
      }
    });
  });
});
