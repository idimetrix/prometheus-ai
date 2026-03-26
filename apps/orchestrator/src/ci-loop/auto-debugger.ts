/**
 * Autonomous Debugger
 *
 * Integrates the FailureAnalyzer, FiveWhyDebugger, and CILoopRunner into
 * a single autonomous debugging pipeline that the execution engine can
 * invoke. Given an error message or test output, the auto-debugger:
 *
 * 1. Reads the error message and classifies the failure
 * 2. Identifies the root cause via structured analysis
 * 3. Generates a targeted fix
 * 4. Tests the fix
 * 5. Reports the outcome
 */

import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import { type FailureAnalysis, FailureAnalyzer } from "./failure-analyzer";
import { FiveWhyDebugger, type RootCauseAnalysis } from "./five-why-debugger";

const logger = createLogger("orchestrator:ci-loop:auto-debugger");

export interface DebugRequest {
  /** The error message or test output to debug */
  errorOutput: string;
  /** Optional: the specific file where the error occurred */
  filePath?: string;
  /** Maximum fix attempts before escalating */
  maxAttempts?: number;
  /** Optional: the test command to re-run after fix */
  testCommand?: string;
}

export interface DebugResult {
  /** Number of fix attempts made */
  attempts: number;
  /** Whether the issue was escalated (too many attempts) */
  escalated: boolean;
  /** The failure analyses from the error output */
  failures: FailureAnalysis[];
  /** Files that were modified to fix the issue */
  filesChanged: string[];
  /** Whether the fix was successful */
  resolved: boolean;
  /** The root cause analysis, if performed */
  rootCauseAnalysis: RootCauseAnalysis | null;
  /** Summary of what was fixed */
  summary: string;
}

/**
 * AutoDebugger wraps the failure analysis and fix pipeline into a
 * self-contained debugging loop. It can be invoked by the execution
 * engine when tool calls fail or tests break.
 */
export class AutoDebugger {
  private readonly analyzer = new FailureAnalyzer();
  private readonly fiveWhy = new FiveWhyDebugger();

  /**
   * Run the autonomous debugging loop on an error.
   */
  async debug(
    agentLoop: AgentLoop,
    request: DebugRequest
  ): Promise<DebugResult> {
    const maxAttempts = request.maxAttempts ?? 3;
    const testCommand = request.testCommand ?? "pnpm test";
    const filesChanged = new Set<string>();
    let attempts = 0;
    let rootCauseAnalysis: RootCauseAnalysis | null = null;

    logger.info(
      {
        filePath: request.filePath,
        maxAttempts,
        errorLength: request.errorOutput.length,
      },
      "Starting autonomous debugging"
    );

    // Step 1: Analyze the error output
    const failures = this.analyzer.analyze(request.errorOutput);

    if (failures.length === 0) {
      return this.buildNoFailuresResult();
    }

    logger.info(
      {
        failureCount: failures.length,
        types: failures.map((f) => f.failureType),
      },
      "Failures identified"
    );

    // Step 2: Attempt to fix each failure
    while (attempts < maxAttempts) {
      attempts++;

      const resolved = await this.attemptFix(
        agentLoop,
        failures,
        request.filePath,
        attempts,
        maxAttempts,
        testCommand,
        filesChanged
      );

      if (resolved) {
        return this.buildResolvedResult(
          attempts,
          filesChanged,
          rootCauseAnalysis,
          failures
        );
      }

      // If we're on the second failed attempt, run root cause analysis
      if (attempts >= 2 && !rootCauseAnalysis) {
        rootCauseAnalysis = await this.runRootCauseAnalysis(
          agentLoop,
          failures,
          attempts
        );
      }
    }

    return this.buildEscalatedResult(
      attempts,
      filesChanged,
      rootCauseAnalysis,
      failures
    );
  }

  /**
   * Attempt a single fix iteration: apply fix then verify.
   * Returns true if the fix resolved all failures.
   */
  private async attemptFix(
    agentLoop: AgentLoop,
    failures: FailureAnalysis[],
    filePath: string | undefined,
    attempt: number,
    maxAttempts: number,
    testCommand: string,
    filesChanged: Set<string>
  ): Promise<boolean> {
    const fixPrompt = this.buildFixPrompt(failures, filePath, attempt);

    logger.info({ attempt, maxAttempts }, "Attempting fix");

    const fixResult = await agentLoop.executeTask(fixPrompt, "ci_loop");

    for (const file of fixResult.filesChanged) {
      filesChanged.add(file);
    }

    const verifyResult = await agentLoop.executeTask(
      `Run the following command and return the complete output:\n${testCommand}`,
      "ci_loop"
    );

    const remainingFailures = this.analyzer.analyze(verifyResult.output);
    return remainingFailures.length === 0;
  }

  /**
   * Run five-why root cause analysis on the primary failure.
   */
  private async runRootCauseAnalysis(
    agentLoop: AgentLoop,
    failures: FailureAnalysis[],
    attempts: number
  ): Promise<RootCauseAnalysis | null> {
    const primaryFailure = failures[0];
    if (!primaryFailure) {
      return null;
    }

    logger.info(
      { testName: primaryFailure.testName },
      "Running root cause analysis"
    );

    const previousAttempts = Array.from(
      { length: attempts },
      (_, i) =>
        `Attempt ${i + 1}: Applied ${primaryFailure.failureType} fix to ${primaryFailure.affectedFiles.join(", ") || "unknown files"}`
    );

    try {
      return await this.fiveWhy.analyze(
        agentLoop,
        primaryFailure,
        previousAttempts
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: msg }, "Root cause analysis failed");
      return null;
    }
  }

  private buildNoFailuresResult(): DebugResult {
    logger.info("No failures detected in error output");
    return {
      resolved: true,
      attempts: 0,
      filesChanged: [],
      rootCauseAnalysis: null,
      failures: [],
      summary: "No failures detected in the provided error output",
      escalated: false,
    };
  }

  private buildResolvedResult(
    attempts: number,
    filesChanged: Set<string>,
    rootCauseAnalysis: RootCauseAnalysis | null,
    failures: FailureAnalysis[]
  ): DebugResult {
    logger.info(
      { attempts, filesChanged: Array.from(filesChanged) },
      "All failures resolved"
    );
    return {
      resolved: true,
      attempts,
      filesChanged: Array.from(filesChanged),
      rootCauseAnalysis,
      failures,
      summary: `Resolved ${failures.length} failure(s) in ${attempts} attempt(s)`,
      escalated: false,
    };
  }

  private buildEscalatedResult(
    attempts: number,
    filesChanged: Set<string>,
    rootCauseAnalysis: RootCauseAnalysis | null,
    failures: FailureAnalysis[]
  ): DebugResult {
    logger.warn(
      {
        attempts,
        remainingFailures: failures.length,
        filesChanged: Array.from(filesChanged),
      },
      "Auto-debugger exhausted attempts, escalating"
    );
    return {
      resolved: false,
      attempts,
      filesChanged: Array.from(filesChanged),
      rootCauseAnalysis,
      failures,
      summary: `Failed to resolve all failures after ${attempts} attempts. ${failures.length} failure(s) remaining.`,
      escalated: true,
    };
  }

  /**
   * Build a targeted fix prompt for the ci_loop agent.
   */
  private buildFixPrompt(
    failures: FailureAnalysis[],
    filePath: string | undefined,
    attempt: number
  ): string {
    const failureDescriptions = failures
      .map(
        (f, i) =>
          `### Failure ${i + 1}: ${f.testName}
- Type: ${f.failureType} (severity: ${f.severity})
- Root cause: ${f.rootCause}
- Affected files: ${f.affectedFiles.join(", ") || "unknown"}
- Suggested fix: ${f.suggestedFix}`
      )
      .join("\n\n");

    const fileContext = filePath
      ? `\nThe error originated in: ${filePath}\nStart by reading this file to understand the context.`
      : "";

    const attemptContext =
      attempt > 1
        ? `\nThis is attempt ${attempt}. Previous attempts did not fully resolve the issue. Try a different approach.`
        : "";

    return `You are debugging ${failures.length} failure(s). Analyze each failure, identify the root cause, and apply the minimal fix.
${fileContext}
${attemptContext}

${failureDescriptions}

Instructions:
1. Read the affected files to understand the current code
2. Identify the TRUE root cause (not just the symptom)
3. Apply a MINIMAL, TARGETED fix
4. Do NOT suppress errors with try-catch
5. Do NOT change test expectations unless the test itself is wrong
6. Fix the source code, not the tests
7. Verify your fix makes logical sense before proceeding`;
  }
}
