/**
 * GAP-099: Task Complexity Estimator
 *
 * Estimates task complexity from description. Considers code scope,
 * language count, dependency depth, and test requirements.
 * Maps complexity to model tier recommendation.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:task-complexity-estimator");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComplexityFactors {
  architecturalComplexity: number;
  codeScope: number;
  dependencyDepth: number;
  languageCount: number;
  testRequirements: number;
}

export interface ComplexityEstimation {
  factors: ComplexityFactors;
  reasoning: string;
  recommendedModel: string;
  score: number;
  tier: "fast" | "standard" | "premium" | "expert";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  typescript: ["typescript", ".ts", ".tsx", "type ", "interface "],
  python: ["python", ".py", "def ", "class ", "import "],
  rust: ["rust", ".rs", "fn ", "impl ", "struct "],
  go: [".go", "func ", "package ", "goroutine"],
  sql: ["sql", "select", "insert", "migration", "schema"],
  shell: ["bash", "shell", ".sh", "script"],
};

const ARCHITECTURE_KEYWORDS = [
  "microservice",
  "distributed",
  "event-driven",
  "saga",
  "cqrs",
  "event sourcing",
  "message queue",
  "load balancer",
  "cache layer",
];

const TEST_KEYWORDS = [
  "test",
  "spec",
  "e2e",
  "integration test",
  "unit test",
  "coverage",
  "benchmark",
];

const DEPENDENCY_KEYWORDS = [
  "dependency",
  "package",
  "library",
  "framework",
  "sdk",
  "api",
  "external service",
];

const SCOPE_KEYWORDS = [
  "refactor",
  "rewrite",
  "migrate",
  "multiple files",
  "cross-cutting",
  "entire",
  "all files",
  "whole project",
];

const TIER_MAP: Record<
  string,
  { tier: ComplexityEstimation["tier"]; model: string }
> = {
  "1": { tier: "fast", model: "cerebras/qwen3-235b" },
  "2": { tier: "standard", model: "anthropic/claude-sonnet-4-6" },
  "3": { tier: "premium", model: "anthropic/claude-sonnet-4-6" },
  "4": { tier: "expert", model: "anthropic/claude-opus-4-6" },
  "5": { tier: "expert", model: "anthropic/claude-opus-4-6" },
};

// ─── Task Complexity Estimator ───────────────────────────────────────────────

export class TaskComplexityEstimator {
  /**
   * Estimate task complexity from a description.
   */
  estimate(description: string): ComplexityEstimation {
    const lowerDesc = description.toLowerCase();

    const factors: ComplexityFactors = {
      codeScope: this.estimateCodeScope(lowerDesc),
      languageCount: this.countLanguages(lowerDesc),
      dependencyDepth: this.estimateDependencyDepth(lowerDesc),
      testRequirements: this.estimateTestRequirements(lowerDesc),
      architecturalComplexity: this.estimateArchitecturalComplexity(lowerDesc),
    };

    // Weighted composite (0-1 scale)
    const composite =
      factors.codeScope * 0.25 +
      factors.languageCount * 0.15 +
      factors.dependencyDepth * 0.2 +
      factors.testRequirements * 0.15 +
      factors.architecturalComplexity * 0.25;

    // Map to 1-5 score
    const score = Math.max(1, Math.min(5, Math.ceil(composite * 5)));
    const tierInfo = TIER_MAP[String(score)] ?? {
      tier: "standard" as const,
      model: "anthropic/claude-sonnet-4-6",
    };

    const reasoning = this.buildReasoning(score, factors);

    logger.info(
      {
        score,
        tier: tierInfo.tier,
        model: tierInfo.model,
        description: description.slice(0, 80),
      },
      "Task complexity estimated"
    );

    return {
      score,
      tier: tierInfo.tier,
      factors,
      reasoning,
      recommendedModel: tierInfo.model,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private estimateCodeScope(text: string): number {
    let score = 0;
    for (const keyword of SCOPE_KEYWORDS) {
      if (text.includes(keyword)) {
        score += 0.15;
      }
    }
    // Token length also indicates scope
    if (text.length > 500) {
      score += 0.1;
    }
    if (text.length > 1000) {
      score += 0.1;
    }
    return Math.min(1, score);
  }

  private countLanguages(text: string): number {
    let count = 0;
    for (const keywords of Object.values(LANGUAGE_KEYWORDS)) {
      if (keywords.some((kw) => text.includes(kw))) {
        count++;
      }
    }
    return Math.min(1, count / 3);
  }

  private estimateDependencyDepth(text: string): number {
    let score = 0;
    for (const keyword of DEPENDENCY_KEYWORDS) {
      if (text.includes(keyword)) {
        score += 0.15;
      }
    }
    return Math.min(1, score);
  }

  private estimateTestRequirements(text: string): number {
    let score = 0;
    for (const keyword of TEST_KEYWORDS) {
      if (text.includes(keyword)) {
        score += 0.15;
      }
    }
    return Math.min(1, score);
  }

  private estimateArchitecturalComplexity(text: string): number {
    let score = 0;
    for (const keyword of ARCHITECTURE_KEYWORDS) {
      if (text.includes(keyword)) {
        score += 0.15;
      }
    }
    return Math.min(1, score);
  }

  private buildReasoning(score: number, factors: ComplexityFactors): string {
    const parts = [`Complexity: ${score}/5.`];

    if (factors.codeScope > 0.5) {
      parts.push("Large code scope detected.");
    }
    if (factors.languageCount > 0.3) {
      parts.push("Multi-language task.");
    }
    if (factors.dependencyDepth > 0.4) {
      parts.push("Significant dependency management required.");
    }
    if (factors.testRequirements > 0.3) {
      parts.push("Testing requirements noted.");
    }
    if (factors.architecturalComplexity > 0.4) {
      parts.push("Architectural design decisions involved.");
    }

    return parts.join(" ");
  }
}
