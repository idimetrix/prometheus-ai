import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";
import type { CIFailureData, ParsedCILog } from "./ci-log-fetcher";
import {
  FAILURE_PRIORITY,
  type FailureAnalysis,
  FailureAnalyzer,
  type FailureType,
} from "./failure-analyzer";
import { FiveWhyDebugger } from "./five-why-debugger";

const logger = createLogger("orchestrator:ci-loop");

/** Maximum times the same failure can appear before escalation */
const STUCK_THRESHOLD = 3;

const VITEST_SUMMARY_RE =
  /Tests?\s+(\d+)\s+passed\s*\|\s*(\d+)\s+failed\s*\|\s*(\d+)\s+total/i;
const JEST_SUMMARY_RE =
  /Tests?:\s*(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/i;

export interface CILoopResult {
  autoResolved: number;
  failedTests: number;
  iterations: number;
  maxIterations: number;
  passed: boolean;
  passRate: number;
  remainingFailures: FailureAnalysis[];
  stuckFailures: string[];
  totalTests: number;
}

/**
 * CILoopRunner implements the test-analyze-fix cycle. It runs the test
 * suite, analyzes any failures, dispatches fix agents, and repeats
 * until all tests pass or the iteration limit is reached.
 *
 * Blocker detection: if the same test fails 3+ times, it's marked as
 * "stuck" and escalated. The runner continues trying to fix other tests.
 */
export class CILoopRunner {
  private readonly analyzer = new FailureAnalyzer();
  private readonly maxIterations: number;
  private readonly eventPublisher = new EventPublisher();

  constructor(maxIterations = 20) {
    this.maxIterations = maxIterations;
  }

  async run(
    agentLoop: AgentLoop,
    testCommand = "pnpm test"
  ): Promise<CILoopResult> {
    let iterations = 0;
    let autoResolved = 0;
    let lastFailures: FailureAnalysis[] = [];
    const failureHistory = new Map<string, number>();
    const stuckFailures = new Set<string>();
    let totalTests = 0;
    let passedTests = 0;

    logger.info(
      { maxIterations: this.maxIterations, testCommand },
      "Starting CI Loop"
    );

    while (iterations < this.maxIterations) {
      iterations++;
      logger.info(
        { iteration: iterations, maxIterations: this.maxIterations },
        "CI Loop iteration"
      );

      // Run the test suite
      const testResult = await agentLoop.executeTask(
        `Run the test suite with the following command: ${testCommand}

Capture ALL output including:
- Test names and their pass/fail status
- Error messages and stack traces
- Summary line with total/passed/failed counts

Run the command and return the complete output.`,
        "ci_loop"
      );

      // Parse test counts from output
      const counts = this.parseTestCounts(testResult.output);
      totalTests = counts.total;
      passedTests = counts.passed;

      // Analyze failures
      const failures = this.analyzer.analyze(testResult.output);

      // Publish progress
      await this.eventPublisher.publishSessionEvent(agentLoop.getSessionId(), {
        type: QueueEvents.TASK_STATUS,
        data: {
          phase: "ci_loop",
          iteration: iterations,
          maxIterations: this.maxIterations,
          totalTests,
          passedTests,
          failedTests: failures.length,
          passRate:
            totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0,
        },
        timestamp: new Date().toISOString(),
      });

      // All tests pass
      if (failures.length === 0) {
        logger.info({ iterations, totalTests, passedTests }, "All tests pass!");
        return {
          passed: true,
          iterations,
          maxIterations: this.maxIterations,
          passRate: 100,
          totalTests,
          failedTests: 0,
          autoResolved,
          remainingFailures: [],
          stuckFailures: [],
        };
      }

      // Process each failure
      const fixableFailures = await this.categorizeFailures(
        failures,
        failureHistory,
        stuckFailures,
        agentLoop
      );

      // If all remaining failures are stuck, we can't make progress
      if (fixableFailures.length === 0 && failures.length > 0) {
        logger.warn(
          {
            stuckCount: stuckFailures.size,
            iterations,
          },
          "All remaining failures are stuck, stopping CI loop"
        );
        break;
      }

      // Split failures by priority tier: high-priority (1-2) vs low-priority (3+)
      const highPriority = fixableFailures.filter(
        (f) => (FAILURE_PRIORITY[f.failureType] ?? 99) <= 2
      );
      const lowPriority = fixableFailures.filter(
        (f) => (FAILURE_PRIORITY[f.failureType] ?? 99) > 2
      );

      // Fix high-priority errors first (syntax, type, import)
      if (highPriority.length > 0) {
        const resolved = await this.dispatchFixes(
          agentLoop,
          highPriority,
          iterations
        );
        autoResolved += resolved;

        // Re-run tests before attempting low-priority fixes
        // (high-priority fixes may resolve cascading lower-priority issues)
        if (lowPriority.length > 0) {
          continue;
        }
      }

      // Fix lower-priority errors
      if (lowPriority.length > 0) {
        const resolved = await this.dispatchFixes(
          agentLoop,
          lowPriority,
          iterations
        );
        autoResolved += resolved;
      }

      lastFailures = failures;
    }

    // Calculate final pass rate
    const failedTests = lastFailures.length;
    const passRate =
      totalTests > 0
        ? Math.round(((totalTests - failedTests) / totalTests) * 100)
        : 0;

    logger.warn(
      {
        iterations,
        remainingFailures: lastFailures.length,
        stuckFailures: stuckFailures.size,
        passRate,
      },
      "CI Loop completed"
    );

    return {
      passed: false,
      iterations,
      maxIterations: this.maxIterations,
      passRate,
      totalTests,
      failedTests,
      autoResolved,
      remainingFailures: lastFailures,
      stuckFailures: Array.from(stuckFailures),
    };
  }

  /**
   * Run the CI auto-fix loop from pre-parsed CI failure data.
   * This is the entry point for webhook-triggered CI fixes.
   *
   * For test failures: reads the failing test, understands the assertion, fixes source
   * For build errors: reads error output, fixes compilation issues
   * For lint errors: runs linter fix command
   * For type errors: fixes TypeScript type issues
   * After fix: commits and pushes to the PR branch
   */
  async runFromParsedFailures(
    agentLoop: AgentLoop,
    parsedLog: ParsedCILog,
    options: {
      branch: string;
      maxIterations?: number;
      prNumber: number;
    }
  ): Promise<CILoopResult> {
    const maxIter = options.maxIterations ?? this.maxIterations;
    let iterations = 0;
    let autoResolved = 0;
    const failureHistory = new Map<string, number>();
    const stuckFailures = new Set<string>();

    logger.info(
      {
        checkName: parsedLog.checkName,
        failureCount: parsedLog.failures.length,
        categories: parsedLog.failures.map((f) => f.category),
        branch: options.branch,
        prNumber: options.prNumber,
      },
      "Starting CI auto-fix from parsed failures"
    );

    // Convert parsed CI failures to FailureAnalysis format
    let currentFailures = this.convertCIFailures(parsedLog.failures);

    while (iterations < maxIter && currentFailures.length > 0) {
      iterations++;

      const fixable = this.filterStuckFailures(
        currentFailures,
        failureHistory,
        stuckFailures
      );

      if (fixable.length === 0) {
        logger.warn(
          { stuckCount: stuckFailures.size },
          "All CI failures are stuck, stopping auto-fix loop"
        );
        break;
      }

      // Apply fixes and commit
      autoResolved += await this.applyAndCommitFixes(
        agentLoop,
        fixable,
        iterations,
        options.branch
      );

      // Re-run tests to verify fixes
      const testResult = await agentLoop.executeTask(
        "Run the test suite with: pnpm test && pnpm typecheck && pnpm check\nCapture ALL output.",
        "ci_loop"
      );

      // Re-analyze
      const newFailures = this.analyzer.analyze(testResult.output);
      if (newFailures.length === 0) {
        logger.info({ iterations, autoResolved }, "All CI failures resolved!");
        return {
          passed: true,
          iterations,
          maxIterations: maxIter,
          passRate: 100,
          totalTests: 0,
          failedTests: 0,
          autoResolved,
          remainingFailures: [],
          stuckFailures: [],
        };
      }

      currentFailures = newFailures;
    }

    return {
      passed: false,
      iterations,
      maxIterations: maxIter,
      passRate: 0,
      totalTests: currentFailures.length,
      failedTests: currentFailures.length,
      autoResolved,
      remainingFailures: currentFailures,
      stuckFailures: Array.from(stuckFailures),
    };
  }

  /**
   * Dispatch fix agents grouped by role. Returns the count of resolved failures.
   */
  private async dispatchFixes(
    agentLoop: AgentLoop,
    failures: FailureAnalysis[],
    iteration: number
  ): Promise<number> {
    let resolved = 0;
    const failuresByRole = this.groupByRole(failures);

    for (const [role, roleFailures] of Object.entries(failuresByRole)) {
      const fixPrompt = this.buildFixPrompt(roleFailures);

      logger.info(
        {
          role,
          failureCount: roleFailures.length,
          iteration,
          priorities: roleFailures.map(
            (f) => `${f.failureType}(${FAILURE_PRIORITY[f.failureType] ?? 99})`
          ),
        },
        "Dispatching fix agent"
      );

      const fixResult = await agentLoop.executeTask(fixPrompt, role);

      if (fixResult.success) {
        resolved += roleFailures.length;
      } else {
        logger.warn(
          { role, error: fixResult.error },
          "Fix agent failed to resolve failures"
        );
      }
    }

    return resolved;
  }

  /**
   * Categorize failures into fixable vs stuck, running root cause analysis
   * on stuck failures.
   */
  private async categorizeFailures(
    failures: FailureAnalysis[],
    failureHistory: Map<string, number>,
    stuckFailures: Set<string>,
    agentLoop: AgentLoop
  ): Promise<FailureAnalysis[]> {
    const fixable: FailureAnalysis[] = [];

    for (const failure of failures) {
      const count = (failureHistory.get(failure.testName) ?? 0) + 1;
      failureHistory.set(failure.testName, count);

      if (count < 3) {
        fixable.push(failure);
        continue;
      }

      if (stuckFailures.has(failure.testName)) {
        continue;
      }

      stuckFailures.add(failure.testName);
      logger.warn(
        {
          testName: failure.testName,
          attempts: count,
          failureType: failure.failureType,
        },
        "Stuck failure detected, running root cause analysis"
      );

      const enhancedFailure = await this.runRootCauseAnalysis(
        agentLoop,
        failure,
        count
      );
      if (enhancedFailure) {
        fixable.push(enhancedFailure);
      }
    }

    return fixable;
  }

  /**
   * Run Five-Why root cause analysis on a stuck failure.
   */
  private async runRootCauseAnalysis(
    agentLoop: AgentLoop,
    failure: FailureAnalysis,
    attemptCount: number
  ): Promise<FailureAnalysis | null> {
    try {
      const fiveWhy = new FiveWhyDebugger();
      const previousAttempts = Array.from(
        { length: attemptCount },
        (_, i) =>
          `Attempt ${i + 1}: Fixed ${failure.failureType} error in ${failure.affectedFiles.join(", ") || "unknown files"}`
      );
      const rootCause = await fiveWhy.analyze(
        agentLoop,
        failure,
        previousAttempts
      );

      if (rootCause?.suggestedFix) {
        return {
          ...failure,
          suggestedFix: rootCause.suggestedFix,
          rootCause: rootCause.rootCause ?? failure.rootCause,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { testName: failure.testName, error: msg },
        "Five-Why analysis failed"
      );
    }
    return null;
  }

  /**
   * Filter out stuck failures from a list, tracking history and escalating.
   */
  private filterStuckFailures(
    failures: FailureAnalysis[],
    failureHistory: Map<string, number>,
    stuckFailures: Set<string>
  ): FailureAnalysis[] {
    const fixable: FailureAnalysis[] = [];
    for (const failure of failures) {
      const count = (failureHistory.get(failure.testName) ?? 0) + 1;
      failureHistory.set(failure.testName, count);

      if (count >= STUCK_THRESHOLD) {
        if (!stuckFailures.has(failure.testName)) {
          stuckFailures.add(failure.testName);
          logger.warn(
            { testName: failure.testName, attempts: count },
            "Stuck CI failure detected, escalating to user"
          );
        }
        continue;
      }
      fixable.push(failure);
    }
    return fixable;
  }

  /**
   * Apply CI fixes for each failure, then commit and push.
   */
  private async applyAndCommitFixes(
    agentLoop: AgentLoop,
    fixable: FailureAnalysis[],
    iteration: number,
    branch: string
  ): Promise<number> {
    let resolved = 0;

    for (const failure of fixable) {
      const fixPrompt = this.buildCIFixPrompt(failure, branch);
      logger.info(
        {
          iteration,
          failureType: failure.failureType,
          testName: failure.testName,
        },
        "Applying CI fix"
      );

      const fixResult = await agentLoop.executeTask(
        fixPrompt,
        failure.fixAgentRole
      );
      if (fixResult.success) {
        resolved++;
      }
    }

    // Commit and push after fixes
    const commitResult = await agentLoop.executeTask(
      `Commit all changes with a descriptive message about the CI fixes applied, then push to the branch "${branch}".
Do NOT amend existing commits. Create a new commit.
Use conventional commit format: "fix: <description of what was fixed>"`,
      "ci_loop"
    );

    if (!commitResult.success) {
      logger.warn({ iteration }, "Failed to commit and push CI fixes");
    }

    return resolved;
  }

  /**
   * Build a combined fix prompt for multiple failures assigned to
   * the same agent role. This is more efficient than one call per failure.
   */
  private buildFixPrompt(failures: FailureAnalysis[]): string {
    const failureDescriptions = failures
      .map(
        (f, i) => `
### Failure ${i + 1}: ${f.testName}
- Type: ${f.failureType}
- Severity: ${f.severity}
- Root Cause: ${f.rootCause}
- Affected Files: ${f.affectedFiles.join(", ") || "unknown"}
- Suggested Fix: ${f.suggestedFix}`
      )
      .join("\n");

    return `Fix the following ${failures.length} test failure(s). Apply the minimal changes needed to resolve each failure.

${failureDescriptions}

Instructions:
1. Read the affected files to understand the current code
2. Identify the root cause of each failure
3. Apply the fix with minimal changes
4. Do NOT change test expectations unless the test itself is wrong
5. Prefer fixing the implementation over the tests
6. If a type error, fix the types to match the implementation intent
7. If an import error, fix the import path or install the missing package
8. After making changes, verify each fix is correct before moving on`;
  }

  /**
   * Build a fix prompt for a CI failure.
   */
  private buildCIFixPrompt(failure: FailureAnalysis, branch: string): string {
    return `Fix the following CI failure on branch "${branch}":

### Failure: ${failure.testName}
- Type: ${failure.failureType}
- Root Cause: ${failure.rootCause}
- Suggested Fix: ${failure.suggestedFix}

Instructions:
1. Read the affected files to understand the current code
2. Identify the root cause
3. Apply the minimal fix needed
4. For type errors: fix the types to match the implementation intent
5. For lint errors: run "pnpm unsafe" to auto-fix
6. For build errors: fix compilation issues
7. For test failures: fix the implementation (not the test expectations, unless the test is wrong)
8. Verify each fix is correct`;
  }

  /**
   * Convert CI failure data (from webhook/log parser) to FailureAnalysis format.
   */
  private convertCIFailures(failures: CIFailureData[]): FailureAnalysis[] {
    const categoryToType: Record<string, FailureType> = {
      test_failure: "logic",
      build_error: "syntax",
      lint_error: "syntax",
      type_error: "type",
      other: "runtime",
    };

    const categoryToRole: Record<string, string> = {
      test_failure: "test_engineer",
      build_error: "backend_coder",
      lint_error: "backend_coder",
      type_error: "backend_coder",
      other: "backend_coder",
    };

    return failures.map((f, i) => ({
      testName: `ci:${f.category}:${i}`,
      failureType: categoryToType[f.category] ?? ("runtime" as FailureType),
      rootCause: f.details.join("\n").slice(0, 500),
      affectedFiles: [],
      suggestedFix: this.suggestCIFix(f),
      fixAgentRole: categoryToRole[f.category] ?? "backend_coder",
      confidence: 0.7,
      severity:
        f.category === "type_error" || f.category === "build_error"
          ? ("high" as const)
          : ("medium" as const),
    }));
  }

  /**
   * Suggest a fix based on CI failure category.
   */
  private suggestCIFix(failure: CIFailureData): string {
    switch (failure.category) {
      case "test_failure":
        return `Fix the failing test(s). Read the test file, understand the expected behavior, and fix the source code to match. Details: ${failure.details[0] ?? "unknown"}`;
      case "build_error":
        return `Fix the build error. Check for missing imports, syntax errors, or module resolution issues. Details: ${failure.details[0] ?? "unknown"}`;
      case "lint_error":
        return 'Run "pnpm unsafe" to auto-fix lint errors. If that does not resolve all issues, manually fix the remaining violations.';
      case "type_error":
        return `Fix the TypeScript type error(s). Update type annotations, add missing properties, or fix type mismatches. Details: ${failure.details[0] ?? "unknown"}`;
      default:
        return `Investigate and fix the CI failure. Details: ${failure.details[0] ?? "unknown"}`;
    }
  }

  /**
   * Group failures by their assigned fix agent role.
   */
  private groupByRole(
    failures: FailureAnalysis[]
  ): Record<string, FailureAnalysis[]> {
    const grouped: Record<string, FailureAnalysis[]> = {};
    for (const failure of failures) {
      const role = failure.fixAgentRole;
      if (!grouped[role]) {
        grouped[role] = [];
      }
      grouped[role]?.push(failure);
    }
    return grouped;
  }

  /**
   * Parse test count summary from test runner output.
   * Handles vitest, jest, and generic test runner formats.
   */
  private parseTestCounts(output: string): {
    total: number;
    passed: number;
    failed: number;
  } {
    // Vitest format: "Tests  12 passed | 3 failed | 15 total"
    const vitestMatch = output.match(VITEST_SUMMARY_RE);
    if (vitestMatch) {
      return {
        total: Number.parseInt(vitestMatch[3] as string, 10),
        passed: Number.parseInt(vitestMatch[1] as string, 10),
        failed: Number.parseInt(vitestMatch[2] as string, 10),
      };
    }

    // Jest format: "Tests: 3 failed, 12 passed, 15 total"
    const jestMatch = output.match(JEST_SUMMARY_RE);
    if (jestMatch) {
      return {
        total: Number.parseInt(jestMatch[3] as string, 10),
        passed: Number.parseInt(jestMatch[2] ?? "0", 10),
        failed: Number.parseInt(jestMatch[1] ?? "0", 10),
      };
    }

    // Generic: count PASS/FAIL lines
    const passCount = (output.match(/(?:PASS|✓|√)\s+/g) ?? []).length;
    const failCount = (output.match(/(?:FAIL|✕|×)\s+/g) ?? []).length;

    return {
      total: passCount + failCount,
      passed: passCount,
      failed: failCount,
    };
  }
}
