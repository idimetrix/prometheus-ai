import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";
import {
  FAILURE_PRIORITY,
  type FailureAnalysis,
  FailureAnalyzer,
} from "./failure-analyzer";
import { FiveWhyDebugger } from "./five-why-debugger";

const logger = createLogger("orchestrator:ci-loop");

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
      const fixableFailures: FailureAnalysis[] = [];

      for (const failure of failures) {
        const count = (failureHistory.get(failure.testName) ?? 0) + 1;
        failureHistory.set(failure.testName, count);

        if (count >= 3) {
          if (!stuckFailures.has(failure.testName)) {
            stuckFailures.add(failure.testName);
            logger.warn(
              {
                testName: failure.testName,
                attempts: count,
                failureType: failure.failureType,
              },
              "Stuck failure detected, running root cause analysis"
            );

            // Run Five-Why root cause analysis
            try {
              const fiveWhy = new FiveWhyDebugger();
              const previousAttempts = Array.from(
                { length: count },
                (_, i) =>
                  `Attempt ${i + 1}: Fixed ${failure.failureType} error in ${failure.affectedFiles.join(", ") || "unknown files"}`
              );
              const rootCause = await fiveWhy.analyze(
                agentLoop,
                failure,
                previousAttempts
              );

              // If root cause analysis suggests a different fix approach,
              // add the failure back as fixable with the new strategy
              if (rootCause?.suggestedFix) {
                fixableFailures.push({
                  ...failure,
                  suggestedFix: rootCause.suggestedFix,
                  rootCause: rootCause.rootCause ?? failure.rootCause,
                });
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(
                { testName: failure.testName, error: msg },
                "Five-Why analysis failed"
              );
            }
          }
          continue;
        }

        fixableFailures.push(failure);
      }

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
