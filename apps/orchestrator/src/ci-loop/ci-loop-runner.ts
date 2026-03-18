import { createLogger } from "@prometheus/logger";
import { FailureAnalyzer, type FailureAnalysis } from "./failure-analyzer";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:ci-loop");

export interface CILoopResult {
  passed: boolean;
  iterations: number;
  maxIterations: number;
  passRate: number;
  totalTests: number;
  failedTests: number;
  autoResolved: number;
  remainingFailures: FailureAnalysis[];
}

export class CILoopRunner {
  private readonly analyzer = new FailureAnalyzer();
  private readonly maxIterations: number;

  constructor(maxIterations: number = 20) {
    this.maxIterations = maxIterations;
  }

  async run(agentLoop: AgentLoop, testCommand: string = "pnpm test"): Promise<CILoopResult> {
    let iterations = 0;
    let autoResolved = 0;
    let lastFailures: FailureAnalysis[] = [];
    const failureHistory = new Map<string, number>();

    while (iterations < this.maxIterations) {
      iterations++;
      logger.info({ iteration: iterations, maxIterations: this.maxIterations }, "CI Loop iteration");

      // Run tests
      const testResult = await agentLoop.executeTask(
        `Run the test suite: ${testCommand}\nCapture all output including failures.`,
        "ci_loop"
      );

      // Analyze failures
      const failures = this.analyzer.analyze(testResult.output);

      if (failures.length === 0) {
        logger.info({ iterations }, "All tests pass!");
        return {
          passed: true,
          iterations,
          maxIterations: this.maxIterations,
          passRate: 100,
          totalTests: 0,
          failedTests: 0,
          autoResolved,
          remainingFailures: [],
        };
      }

      // Check for stuck failures (same test failing 3+ times)
      for (const failure of failures) {
        const count = (failureHistory.get(failure.testName) ?? 0) + 1;
        failureHistory.set(failure.testName, count);

        if (count >= 3) {
          logger.warn({ testName: failure.testName, attempts: count }, "Stuck failure, escalating");
          continue;
        }

        // Generate fix and apply
        await agentLoop.executeTask(
          `Fix the following test failure:
Test: ${failure.testName}
Type: ${failure.failureType}
Root Cause: ${failure.rootCause}
Files: ${failure.affectedFiles.join(", ")}
Suggested Fix: ${failure.suggestedFix}

Apply the minimal fix needed to resolve this failure.`,
          failure.fixAgentRole
        );
        autoResolved++;
      }

      lastFailures = failures;
    }

    logger.warn({
      iterations,
      remainingFailures: lastFailures.length,
    }, "CI Loop reached max iterations");

    return {
      passed: false,
      iterations,
      maxIterations: this.maxIterations,
      passRate: 0,
      totalTests: 0,
      failedTests: lastFailures.length,
      autoResolved,
      remainingFailures: lastFailures,
    };
  }
}
