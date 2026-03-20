/**
 * Performance Checker — Static analysis for performance anti-patterns.
 *
 * Detects common performance issues like N+1 queries, memory leaks,
 * excessive complexity, and suggests optimizations.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:performance-checker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "info" | "warning" | "critical";

export interface ComplexityEstimate {
  details: string;
  space: string;
  time: string;
}

export interface PerformanceFinding {
  category: "complexity" | "n-plus-one" | "memory-leak" | "general";
  description: string;
  line?: number;
  severity: Severity;
  snippet?: string;
}

export interface OptimizationSuggestion {
  description: string;
  effort: "low" | "medium" | "high";
  finding: PerformanceFinding;
  suggestion: string;
}

export interface PerformanceReport {
  findings: PerformanceFinding[];
  score: number;
  suggestions: OptimizationSuggestion[];
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const N_PLUS_ONE_PATTERNS = [
  {
    pattern:
      /for\s*\([^)]*\)\s*\{[^}]*(?:await\s+\w+\.(?:find|query|select|get|fetch))/gs,
    description: "Database query inside a loop — potential N+1 query",
  },
  {
    pattern:
      /\.map\(\s*async[^)]*\)\s*(?:=>|\{)[^}]*(?:\.find|\.query|\.select|\.get|\.fetch)/gs,
    description: "Async map with individual database calls — use batch query",
  },
  {
    pattern: /\.forEach\(\s*async[^)]*\)\s*(?:=>|\{)[^}]*(?:await)/gs,
    description: "Async forEach does not await — use for...of or Promise.all",
  },
];

const MEMORY_LEAK_PATTERNS = [
  {
    pattern: /addEventListener\s*\(/g,
    antipair: /removeEventListener\s*\(/g,
    description: "Event listener added without corresponding removal",
  },
  {
    pattern: /setInterval\s*\(/g,
    antipair: /clearInterval\s*\(/g,
    description: "setInterval without corresponding clearInterval",
  },
  {
    pattern: /setTimeout\s*\(/g,
    antipair: /clearTimeout\s*\(/g,
    description: "setTimeout may need cleanup in component unmount",
  },
  {
    pattern: /new\s+(?:Map|Set|WeakMap|WeakSet)\s*\(\)/g,
    description: "Collection created — ensure it is properly cleaned up",
  },
];

const COMPLEXITY_PATTERNS = [
  {
    pattern: /for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)\s*\{/gs,
    complexity: "O(n^2)",
    description: "Nested loops — consider using a Map for lookup",
  },
  {
    pattern:
      /for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)\s*\{/gs,
    complexity: "O(n^3)",
    description: "Triple nested loops — likely needs algorithmic improvement",
  },
  {
    pattern: /\.filter\([^)]+\)\s*\.map\(/g,
    complexity: "O(2n)",
    description: "Chained filter+map — consider using reduce for single pass",
  },
  {
    pattern: /\.sort\(\)\s*\[0\]/g,
    complexity: "O(n log n)",
    description:
      "Sorting to find min/max — use Math.min/max with spread or reduce",
  },
];

// ---------------------------------------------------------------------------
// PerformanceChecker
// ---------------------------------------------------------------------------

export class PerformanceChecker {
  /**
   * Estimate time and space complexity of code.
   */
  analyzeComplexity(code: string, _language: string): ComplexityEstimate {
    let worstTime = "O(n)";
    let details = "Linear scan detected";

    for (const cp of COMPLEXITY_PATTERNS) {
      if (cp.pattern.test(code)) {
        worstTime = cp.complexity;
        details = cp.description;
        // Reset regex lastIndex
        cp.pattern.lastIndex = 0;
      }
    }

    // Simple space analysis
    const collectionsCreated = (
      code.match(/new\s+(?:Array|Map|Set|Object)\s*\(/g) ?? []
    ).length;
    const space =
      collectionsCreated > 2 ? "O(n) — multiple collections" : "O(1)";

    return { time: worstTime, space, details };
  }

  /**
   * Detect N+1 query patterns in ORM code.
   */
  detectN1Queries(code: string): PerformanceFinding[] {
    const findings: PerformanceFinding[] = [];

    for (const np of N_PLUS_ONE_PATTERNS) {
      const matches = code.matchAll(np.pattern);
      for (const match of matches) {
        const line = this.getLineNumber(code, match.index ?? 0);
        findings.push({
          category: "n-plus-one",
          severity: "critical",
          description: np.description,
          line,
          snippet: match[0].slice(0, 120),
        });
      }
    }

    logger.debug({ count: findings.length }, "N+1 query detection complete");
    return findings;
  }

  /**
   * Detect common memory leak patterns.
   */
  detectMemoryLeaks(code: string): PerformanceFinding[] {
    const findings: PerformanceFinding[] = [];

    for (const mp of MEMORY_LEAK_PATTERNS) {
      const addMatches = code.match(mp.pattern);
      if (!addMatches || addMatches.length === 0) {
        continue;
      }

      if ("antipair" in mp && mp.antipair) {
        const removeMatches = code.match(mp.antipair);
        const addCount = addMatches.length;
        const removeCount = removeMatches?.length ?? 0;

        if (addCount > removeCount) {
          findings.push({
            category: "memory-leak",
            severity: "warning",
            description: mp.description,
          });
        }
      } else {
        findings.push({
          category: "memory-leak",
          severity: "info",
          description: mp.description,
        });
      }
    }

    logger.debug({ count: findings.length }, "Memory leak detection complete");
    return findings;
  }

  /**
   * Generate optimization suggestions from findings.
   */
  suggestOptimizations(
    findings: PerformanceFinding[]
  ): OptimizationSuggestion[] {
    return findings.map((finding) => ({
      finding,
      description: finding.description,
      suggestion: this.getSuggestion(finding),
      effort: this.estimateEffort(finding),
    }));
  }

  /**
   * Compute an overall performance score (0–1).
   */
  getPerformanceScore(code: string): number {
    const n1 = this.detectN1Queries(code);
    const leaks = this.detectMemoryLeaks(code);
    const complexity = this.analyzeComplexity(code, "typescript");

    let score = 1.0;

    // Deduct for N+1 queries
    score -= n1.length * 0.2;

    // Deduct for memory leaks
    for (const f of leaks) {
      score -= f.severity === "warning" ? 0.1 : 0.05;
    }

    // Deduct for high complexity
    if (complexity.time.includes("n^3")) {
      score -= 0.3;
    } else if (complexity.time.includes("n^2")) {
      score -= 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  // ---- Private helpers ------------------------------------------------------

  private getLineNumber(code: string, index: number): number {
    return code.slice(0, index).split("\n").length;
  }

  private getSuggestion(finding: PerformanceFinding): string {
    switch (finding.category) {
      case "n-plus-one":
        return "Use batch queries (e.g., WHERE id IN (...)) or eager loading instead of individual queries in loops.";
      case "memory-leak":
        return "Ensure cleanup in component unmount (useEffect return) or class destructor. Remove event listeners and clear intervals.";
      case "complexity":
        return "Consider using hash maps for O(1) lookups, or restructure algorithm to reduce nesting depth.";
      default:
        return "Review the flagged code for potential performance improvements.";
    }
  }

  private estimateEffort(
    finding: PerformanceFinding
  ): "low" | "medium" | "high" {
    if (finding.severity === "critical") {
      return "medium";
    }
    if (finding.severity === "warning") {
      return "low";
    }
    return "low";
  }
}
