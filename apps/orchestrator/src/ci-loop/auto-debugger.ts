/**
 * AutoDebugger — Autonomous debugging engine that parses stack traces,
 * reads surrounding code context, generates targeted fixes based on
 * error type, and verifies fixes compile before running tests.
 *
 * Integrates with the CI loop as the first-pass fix generator for
 * individual failures before escalating to the full agent loop.
 */

import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import type { FailureAnalysis, FailureType } from "./failure-analyzer";
import { TargetedRunner } from "./targeted-runner";

const logger = createLogger("orchestrator:ci-loop:auto-debugger");

// ─── Top-level regex constants ───────────────────────────────────────────
const PACKAGE_PATH_RE = /(?:apps|packages)\/([^/]+)/;

// ─── Stack trace parsing regexes ─────────────────────────────────────────
const STACK_TRACE_FILE_LINE_RE =
  /(?:at\s+.+?\s+\(|at\s+)((?:\/[\w./-]+|[\w./-]+)\.\w+):(\d+)(?::(\d+))?\)?/;
const TS_ERROR_LOCATION_RE =
  /((?:\/[\w./-]+|[\w./-]+)\.tsx?)\((\d+),(\d+)\):\s*error/;
const JEST_FAIL_LOCATION_RE =
  /●\s+.*\n\n\s+.*\n\n\s+at\s+.*\((.*):(\d+):(\d+)\)/;

/** Parsed location from a stack trace or error message */
export interface ErrorLocation {
  column?: number;
  filePath: string;
  line: number;
}

/** Result of an auto-debug fix attempt */
export interface AutoDebugResult {
  compilePassed: boolean;
  confidence: number;
  fixApplied: boolean;
  fixDescription: string;
  location: ErrorLocation | null;
  testPassed: boolean;
}

/**
 * Strategy for generating a fix based on the error type.
 * Each strategy returns a prompt tailored to the specific class of error.
 */
interface FixStrategy {
  buildPrompt(
    failure: FailureAnalysis,
    location: ErrorLocation | null,
    codeContext: string
  ): string;
  errorTypes: FailureType[];
}

const FIX_STRATEGIES: FixStrategy[] = [
  {
    errorTypes: ["syntax"],
    buildPrompt(failure, location, codeContext) {
      return `Fix the syntax error in ${location?.filePath ?? "the affected file"}.

Error: ${failure.rootCause}
${location ? `Location: line ${location.line}${location.column ? `, column ${location.column}` : ""}` : ""}

Code context:
\`\`\`
${codeContext}
\`\`\`

Instructions:
1. Identify the exact syntax issue (missing bracket, semicolon, invalid token, etc.)
2. Apply the minimal fix to resolve the syntax error
3. Do NOT change any logic or behavior — only fix the syntax
4. Verify the file is syntactically valid after the fix`;
    },
  },
  {
    errorTypes: ["type", "import"],
    buildPrompt(failure, location, codeContext) {
      return `Fix the TypeScript type/import error in ${location?.filePath ?? "the affected file"}.

Error: ${failure.rootCause}
${location ? `Location: line ${location.line}` : ""}

Code context:
\`\`\`
${codeContext}
\`\`\`

Instructions:
1. Read the error message carefully to understand the type mismatch or missing import
2. Check if the issue is a wrong type annotation, missing property, or incorrect import path
3. Fix the type annotation, add the missing import, or correct the import path
4. Ensure the fix is consistent with the rest of the file's type patterns
5. Run "pnpm typecheck" on just this file to verify the fix`;
    },
  },
  {
    errorTypes: ["runtime"],
    buildPrompt(failure, location, codeContext) {
      return `Fix the runtime error in ${location?.filePath ?? "the affected file"}.

Error: ${failure.rootCause}
${location ? `Location: line ${location.line}` : ""}

Code context:
\`\`\`
${codeContext}
\`\`\`

Instructions:
1. Identify the runtime error type (TypeError, ReferenceError, null access, etc.)
2. Add appropriate null checks, type guards, or default values
3. If a variable is undefined, trace its origin and fix the initialization
4. Prefer defensive coding (optional chaining, nullish coalescing) over try-catch
5. Ensure the fix handles edge cases without changing the happy-path behavior`;
    },
  },
  {
    errorTypes: ["logic"],
    buildPrompt(failure, location, codeContext) {
      return `Fix the logic/assertion error in ${location?.filePath ?? "the affected file"}.

Error: ${failure.rootCause}
${location ? `Location: line ${location.line}` : ""}

Code context:
\`\`\`
${codeContext}
\`\`\`

Instructions:
1. Read the expected vs actual values from the assertion error
2. Trace the logic that produces the actual value
3. Fix the implementation to produce the expected result
4. Do NOT change the test expectation unless it is clearly wrong
5. Verify your fix handles all relevant edge cases`;
    },
  },
  {
    errorTypes: ["timeout", "integration", "environment"],
    buildPrompt(failure, location, codeContext) {
      return `Fix the ${failure.failureType} error in ${location?.filePath ?? "the affected file"}.

Error: ${failure.rootCause}
${location ? `Location: line ${location.line}` : ""}

Code context:
\`\`\`
${codeContext}
\`\`\`

Instructions:
1. For timeout errors: check for unresolved promises, infinite loops, or missing mock responses
2. For integration errors: verify service endpoints, mock configurations, and data contracts
3. For environment errors: check env variables, config files, and service dependencies
4. Apply the most targeted fix possible without broad changes`;
    },
  },
];

export class AutoDebugger {
  private readonly targetedRunner = new TargetedRunner();

  /**
   * Attempt to automatically debug and fix a single failure.
   *
   * Flow:
   * 1. Parse the stack trace to identify the failing file and line
   * 2. Read surrounding code context (20 lines around the error)
   * 3. Select a fix strategy based on the error type
   * 4. Generate and apply a targeted fix via the agent loop
   * 5. Verify the fix compiles
   * 6. Run only the relevant test(s) to verify
   */
  async debug(
    agentLoop: AgentLoop,
    failure: FailureAnalysis
  ): Promise<AutoDebugResult> {
    logger.info(
      {
        testName: failure.testName,
        failureType: failure.failureType,
        affectedFiles: failure.affectedFiles,
      },
      "AutoDebugger: starting targeted fix"
    );

    // Step 1: Parse error location from root cause / stack trace
    const location = this.parseErrorLocation(
      failure.rootCause,
      failure.affectedFiles
    );

    // Step 2: Read code context around the error
    const codeContext = await this.readCodeContext(
      agentLoop,
      location,
      failure
    );

    // Step 3: Select the appropriate fix strategy
    const strategy = this.selectStrategy(failure.failureType);
    const fixPrompt = strategy.buildPrompt(failure, location, codeContext);

    // Step 4: Apply the fix
    const fixResult = await agentLoop.executeTask(
      `${fixPrompt}\n\nAfter making the fix, output a brief description of what you changed.`,
      failure.fixAgentRole
    );

    if (!fixResult.success) {
      logger.warn(
        { testName: failure.testName, error: fixResult.error },
        "AutoDebugger: fix generation failed"
      );
      return {
        fixApplied: false,
        compilePassed: false,
        testPassed: false,
        confidence: 0,
        fixDescription: fixResult.error ?? "Fix generation failed",
        location,
      };
    }

    // Step 5: Verify the fix compiles
    const compileResult = await this.verifyCompilation(agentLoop, failure);

    if (!compileResult.success) {
      logger.warn(
        { testName: failure.testName },
        "AutoDebugger: fix did not compile, reverting"
      );
      return {
        fixApplied: true,
        compilePassed: false,
        testPassed: false,
        confidence: 0.2,
        fixDescription: `Fix applied but failed compilation: ${compileResult.error ?? "unknown"}`,
        location,
      };
    }

    // Step 6: Run targeted tests
    const testResult = await this.runTargetedTests(agentLoop, failure);

    logger.info(
      {
        testName: failure.testName,
        compilePassed: true,
        testPassed: testResult.passed,
      },
      "AutoDebugger: fix attempt complete"
    );

    return {
      fixApplied: true,
      compilePassed: true,
      testPassed: testResult.passed,
      confidence: testResult.passed ? 0.95 : 0.5,
      fixDescription: fixResult.output.slice(0, 500),
      location,
    };
  }

  /**
   * Batch debug: attempt to fix multiple failures, ordered by priority.
   * Returns early if a high-priority fix cascades to resolve others.
   */
  async debugBatch(
    agentLoop: AgentLoop,
    failures: FailureAnalysis[]
  ): Promise<AutoDebugResult[]> {
    const results: AutoDebugResult[] = [];

    for (const failure of failures) {
      const result = await this.debug(agentLoop, failure);
      results.push(result);

      // If a fix resolved and tests pass, remaining failures may be
      // cascade-resolved — return early so caller can re-analyze
      if (result.testPassed && failure.failureType === "type") {
        logger.info(
          "AutoDebugger: type fix passed, returning early for re-analysis"
        );
        break;
      }
    }

    return results;
  }

  /**
   * Parse the error location from the failure's root cause string.
   */
  parseErrorLocation(
    rootCause: string,
    affectedFiles: string[]
  ): ErrorLocation | null {
    // Try TypeScript error format: file.ts(line,col): error TS...
    const tsMatch = rootCause.match(TS_ERROR_LOCATION_RE);
    if (tsMatch?.[1] && tsMatch[2]) {
      return {
        filePath: tsMatch[1],
        line: Number.parseInt(tsMatch[2], 10),
        column: tsMatch[3] ? Number.parseInt(tsMatch[3], 10) : undefined,
      };
    }

    // Try stack trace format: at Function (/path/file.ts:line:col)
    const stackMatch = rootCause.match(STACK_TRACE_FILE_LINE_RE);
    if (stackMatch?.[1] && stackMatch[2]) {
      return {
        filePath: stackMatch[1],
        line: Number.parseInt(stackMatch[2], 10),
        column: stackMatch[3] ? Number.parseInt(stackMatch[3], 10) : undefined,
      };
    }

    // Try Jest failure format
    const jestMatch = rootCause.match(JEST_FAIL_LOCATION_RE);
    if (jestMatch?.[1] && jestMatch[2]) {
      return {
        filePath: jestMatch[1],
        line: Number.parseInt(jestMatch[2], 10),
        column: jestMatch[3] ? Number.parseInt(jestMatch[3], 10) : undefined,
      };
    }

    // Fallback: use the first affected file with line 1
    if (affectedFiles.length > 0 && affectedFiles[0]) {
      const parts = affectedFiles[0].split(":");
      const filePath = parts[0] as string;
      const line = parts[1] ? Number.parseInt(parts[1], 10) : 1;
      return { filePath, line };
    }

    return null;
  }

  /**
   * Read code context around the error location.
   */
  private async readCodeContext(
    agentLoop: AgentLoop,
    location: ErrorLocation | null,
    failure: FailureAnalysis
  ): Promise<string> {
    if (!location) {
      return `No specific location found. Affected files: ${failure.affectedFiles.join(", ") || "unknown"}`;
    }

    const startLine = Math.max(1, location.line - 10);
    const endLine = location.line + 10;

    const readResult = await agentLoop.executeTask(
      `Read the file "${location.filePath}" from line ${startLine} to line ${endLine}. Output only the file contents with line numbers.`,
      "ci_loop"
    );

    if (readResult.success && readResult.output.trim()) {
      return readResult.output;
    }

    return `Could not read context from ${location.filePath}:${location.line}`;
  }

  /**
   * Select the best fix strategy for the given failure type.
   */
  private selectStrategy(failureType: FailureType): FixStrategy {
    const strategy = FIX_STRATEGIES.find((s) =>
      s.errorTypes.includes(failureType)
    );
    // Fallback to the last (most generic) strategy
    const fallback = FIX_STRATEGIES.at(-1);
    if (!fallback) {
      throw new Error("No fix strategies defined");
    }
    return strategy ?? fallback;
  }

  /**
   * Verify that the fix compiles by running typecheck on affected files.
   */
  private async verifyCompilation(
    agentLoop: AgentLoop,
    failure: FailureAnalysis
  ): Promise<{ success: boolean; error?: string }> {
    // Determine the package containing the affected file
    const affectedFile = failure.affectedFiles[0] ?? "";
    const packageMatch = affectedFile.match(PACKAGE_PATH_RE);
    const filterArg = packageMatch
      ? ` --filter=@prometheus/${packageMatch[1]}`
      : "";

    const compileResult = await agentLoop.executeTask(
      `Run the following command and capture all output: pnpm typecheck${filterArg}
If there are errors, list them. If it passes, say "COMPILE_OK".`,
      "ci_loop"
    );

    const passed =
      compileResult.success &&
      (compileResult.output.includes("COMPILE_OK") ||
        !compileResult.output.includes("error TS"));

    return {
      success: passed,
      error: passed ? undefined : compileResult.output.slice(0, 500),
    };
  }

  /**
   * Run only the tests relevant to the failure.
   */
  private async runTargetedTests(
    agentLoop: AgentLoop,
    failure: FailureAnalysis
  ): Promise<{ passed: boolean; output: string }> {
    const { command, targeted } = this.targetedRunner.buildCommand(
      failure.affectedFiles
    );

    const testResult = await agentLoop.executeTask(
      `Run the following test command and capture all output: ${command}
Report whether the tests pass or fail.`,
      "ci_loop"
    );

    const passed =
      testResult.success &&
      !testResult.output.includes("FAIL") &&
      !testResult.output.includes("failed");

    logger.info(
      { targeted, command, passed },
      "AutoDebugger: targeted test result"
    );

    return { passed, output: testResult.output };
  }
}
