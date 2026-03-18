import { createLogger } from "@prometheus/logger";
import type { EventPublisher } from "@prometheus/queue";

const logger = createLogger("agent-sdk:protocol:ci-loop");

export interface TestResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  failures: TestFailure[];
  duration: number;
  coveragePercent?: number;
}

export interface TestFailure {
  testName: string;
  testFile: string;
  error: string;
  stackTrace: string;
  category: "unit" | "integration" | "e2e" | "type" | "lint";
}

export interface FixAttempt {
  iteration: number;
  failures: TestFailure[];
  fixDescription: string;
  filesChanged: string[];
  success: boolean;
}

export interface CILoopResult {
  success: boolean;
  iterations: number;
  maxIterations: number;
  finalTestResult: TestResult;
  fixHistory: FixAttempt[];
  escalated: boolean;
}

export class CILoopProtocol {
  private maxIterations: number;
  private fixHistory: FixAttempt[] = [];
  private currentIteration = 0;

  constructor(
    private sessionId: string,
    private publisher?: EventPublisher,
    maxIterations = 20,
  ) {
    this.maxIterations = maxIterations;
  }

  async runLoop(
    runTests: () => Promise<TestResult>,
    applyFix: (failures: TestFailure[]) => Promise<{ filesChanged: string[]; description: string }>,
  ): Promise<CILoopResult> {
    let lastResult: TestResult = {
      passed: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      failures: [],
      duration: 0,
    };

    while (this.currentIteration < this.maxIterations) {
      this.currentIteration++;

      // Step 1: Run tests
      await this.publishEvent("ci_loop_step", {
        iteration: this.currentIteration,
        step: "running_tests",
      });

      logger.info({ iteration: this.currentIteration }, "CI Loop: Running tests");
      lastResult = await runTests();

      await this.publishEvent("ci_loop_test_result", {
        iteration: this.currentIteration,
        passed: lastResult.passed,
        total: lastResult.totalTests,
        failed: lastResult.failedTests,
        duration: lastResult.duration,
      });

      // Step 2: Check if all pass
      if (lastResult.passed) {
        logger.info(
          { iteration: this.currentIteration, total: lastResult.totalTests },
          "CI Loop: All tests passed!"
        );

        await this.publishEvent("ci_loop_complete", {
          success: true,
          iterations: this.currentIteration,
          totalTests: lastResult.totalTests,
        });

        return {
          success: true,
          iterations: this.currentIteration,
          maxIterations: this.maxIterations,
          finalTestResult: lastResult,
          fixHistory: this.fixHistory,
          escalated: false,
        };
      }

      // Step 3: Analyze failures and generate fix
      await this.publishEvent("ci_loop_step", {
        iteration: this.currentIteration,
        step: "analyzing_failures",
        failureCount: lastResult.failures.length,
      });

      logger.info(
        { iteration: this.currentIteration, failures: lastResult.failures.length },
        "CI Loop: Analyzing failures"
      );

      // Step 4: Apply fix
      const fix = await applyFix(lastResult.failures);

      const attempt: FixAttempt = {
        iteration: this.currentIteration,
        failures: lastResult.failures,
        fixDescription: fix.description,
        filesChanged: fix.filesChanged,
        success: false,
      };

      this.fixHistory.push(attempt);

      await this.publishEvent("ci_loop_fix_applied", {
        iteration: this.currentIteration,
        description: fix.description,
        filesChanged: fix.filesChanged,
      });

      // Check for repeated failures (same failures 3 times = escalate)
      if (this.detectRepeatedFailures()) {
        logger.warn({ iteration: this.currentIteration }, "CI Loop: Repeated failures detected, escalating");

        await this.publishEvent("ci_loop_escalated", {
          reason: "repeated_failures",
          iterations: this.currentIteration,
        });

        return {
          success: false,
          iterations: this.currentIteration,
          maxIterations: this.maxIterations,
          finalTestResult: lastResult,
          fixHistory: this.fixHistory,
          escalated: true,
        };
      }
    }

    // Max iterations reached
    logger.warn({ maxIterations: this.maxIterations }, "CI Loop: Max iterations reached, escalating");

    await this.publishEvent("ci_loop_escalated", {
      reason: "max_iterations",
      iterations: this.currentIteration,
    });

    return {
      success: false,
      iterations: this.currentIteration,
      maxIterations: this.maxIterations,
      finalTestResult: lastResult,
      fixHistory: this.fixHistory,
      escalated: true,
    };
  }

  parseTestOutput(output: string): TestResult {
    const result: TestResult = {
      passed: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      failures: [],
      duration: 0,
    };

    // Parse common test output formats
    // Vitest/Jest format: Tests: X passed, Y failed, Z total
    const testSummary = output.match(/Tests:\s*(\d+)\s*passed.*?(\d+)\s*failed.*?(\d+)\s*total/i);
    if (testSummary) {
      result.passedTests = parseInt(testSummary[1], 10);
      result.failedTests = parseInt(testSummary[2], 10);
      result.totalTests = parseInt(testSummary[3], 10);
    }

    // Alternative: X passing, Y failing
    const altSummary = output.match(/(\d+)\s*passing.*?(\d+)\s*failing/i);
    if (altSummary && result.totalTests === 0) {
      result.passedTests = parseInt(altSummary[1], 10);
      result.failedTests = parseInt(altSummary[2], 10);
      result.totalTests = result.passedTests + result.failedTests;
    }

    // Duration
    const durationMatch = output.match(/Duration:\s*([\d.]+)\s*s/i) || output.match(/Time:\s*([\d.]+)\s*s/i);
    if (durationMatch) {
      result.duration = parseFloat(durationMatch[1]);
    }

    // Extract individual failures
    const failureBlocks = output.split(/FAIL\s+|✗\s+|✕\s+|×\s+/).slice(1);
    for (const block of failureBlocks) {
      const lines = block.trim().split("\n");
      if (lines.length > 0) {
        result.failures.push({
          testName: lines[0].trim(),
          testFile: "",
          error: lines.slice(1, 5).join("\n").trim(),
          stackTrace: lines.slice(5).join("\n").trim(),
          category: "unit",
        });
      }
    }

    // TypeScript errors
    const tsErrors = output.match(/error TS\d+:.*/g);
    if (tsErrors) {
      for (const err of tsErrors) {
        result.failures.push({
          testName: "TypeScript",
          testFile: "",
          error: err,
          stackTrace: "",
          category: "type",
        });
      }
      result.failedTests += tsErrors.length;
      result.totalTests += tsErrors.length;
    }

    result.passed = result.failedTests === 0 && result.totalTests > 0;
    return result;
  }

  categorizeFailure(failure: TestFailure): string {
    const error = failure.error.toLowerCase();

    if (error.includes("import") || error.includes("module not found") || error.includes("cannot find module")) {
      return "integration_coder"; // Import/wiring issues
    }
    if (error.includes("render") || error.includes("component") || error.includes("jsx") || error.includes("css")) {
      return "frontend_coder";
    }
    if (error.includes("database") || error.includes("query") || error.includes("sql") || error.includes("schema")) {
      return "backend_coder";
    }
    if (error.includes("type") || error.includes("typescript")) {
      return "backend_coder"; // Type errors usually in business logic
    }

    return "backend_coder"; // Default
  }

  private detectRepeatedFailures(): boolean {
    if (this.fixHistory.length < 3) return false;

    const last3 = this.fixHistory.slice(-3);
    const failureSets = last3.map((h) =>
      new Set(h.failures.map((f) => f.testName + f.error.slice(0, 50)))
    );

    // Check if all 3 have the same failure signature
    const first = failureSets[0];
    return failureSets.every((s) => {
      if (s.size !== first.size) return false;
      for (const item of first) {
        if (!s.has(item)) return false;
      }
      return true;
    });
  }

  private async publishEvent(type: string, data: Record<string, unknown>): Promise<void> {
    if (this.publisher) {
      await this.publisher.publishSessionEvent(this.sessionId, {
        type,
        data,
        agentRole: "ci_loop",
        timestamp: new Date().toISOString(),
      });
    }
  }
}
