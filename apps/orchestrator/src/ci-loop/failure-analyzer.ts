import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ci-loop:analyzer");

// ─── Top-level regex constants ──────────────────────────────────────────
const TS_FILE_ERROR_RE = /\.tsx?:\d+:\d+.*error/;
const FAIL_LINE_RE = /^\s*(?:FAIL|✕|×)\s+/;
const EXPECT_ASSERTION_RE = /expect\(.+?\)\.(to|not)/;
const RUNTIME_ERROR_RE =
  /^\s*(TypeError|ReferenceError|RangeError|SyntaxError):/;
const GENERIC_ERROR_RE = /Error:\s+.+/;
const TS_ERROR_CODE_RE = /error (TS\d+):\s*(.+)/;
const MODULE_NAME_RE = /['"]([^'"]+)['"]/;
const EXPECTED_VALUE_RE = /expected[:\s]+(.+?)(?:\n|$)/i;
const RECEIVED_VALUE_RE = /received[:\s]+(.+?)(?:\n|$)/i;

// ─── Failure categorization regexes ─────────────────────────────────────
const CATEGORY_TYPE_ERROR_RE = /Type|TS2|ts\(|cannot find name|not assignable/i;
const CATEGORY_MISSING_DEP_RE =
  /Cannot find module|Module not found|not installed|missing dependency/i;
const CATEGORY_RUNTIME_RE =
  /ReferenceError|TypeError at runtime|undefined is not|null reference|ENOENT|ECONNREFUSED/i;
const CATEGORY_TEST_DESIGN_RE =
  /Expected.*received|toBe|toEqual|assertion failed|snapshot.*mismatch/i;
const CATEGORY_LOGIC_RE = /expected.*but got|incorrect result|wrong output/i;
const ERROR_TYPE_RE = /^(\w+Error):/;
const FILE_PATH_RE = /(?:\/[\w.-]+)+\.\w+(?::\d+(?::\d+)?)?/g;
const FAIL_PASS_PATTERN_RE = /(?:FAIL|PASS|✕|✓|×|√)\s+(.+)/;
const CHEVRON_PATTERN_RE = /(?:›|>)\s+(.+)/;
const IT_PATTERN_RE = /it\(['"](.+?)['"]/;
const TEST_PATTERN_RE = /test\(['"](.+?)['"]/;
const DESCRIBE_PATTERN_RE = /describe\(['"](.+?)['"]/;
const NEAREST_FAIL_RE = /(?:FAIL|✕|×)\s+(.+)/;

export type FailureCategory =
  | "TYPE_ERROR"
  | "RUNTIME_ERROR"
  | "LOGIC_ERROR"
  | "MISSING_DEPENDENCY"
  | "TEST_DESIGN_ERROR"
  | "UNKNOWN";

export type FailureType =
  | "syntax"
  | "logic"
  | "integration"
  | "type"
  | "runtime"
  | "timeout"
  | "import"
  | "environment";

/**
 * Explicit priority hierarchy for fix ordering.
 * SYNTAX(1) > TYPE(2) > ENVIRONMENT(3) > RUNTIME(4) > LOGIC(5) > INTEGRATION(6)
 * Lower number = higher priority = fix first.
 */
export const FAILURE_PRIORITY: Record<FailureType, number> = {
  syntax: 1,
  type: 2,
  import: 2,
  environment: 3,
  runtime: 4,
  timeout: 4,
  logic: 5,
  integration: 6,
};

export interface FailureAnalysis {
  affectedFiles: string[];
  confidence: number;
  failureCategory?: FailureCategory;
  failureType: FailureType;
  fixAgentRole: string;
  rootCause: string;
  severity: "critical" | "high" | "medium" | "low";
  suggestedFix: string;
  testName: string;
}

/**
 * FailureAnalyzer parses test runner output (vitest, jest, playwright)
 * and categorizes failures into actionable fix instructions. Each
 * failure is assigned to the most appropriate agent role for resolution.
 */
export class FailureAnalyzer {
  /**
   * Analyze test output and return structured failure analyses.
   * Deduplicates by test name to avoid re-analyzing the same failure.
   */
  analyze(testOutput: string): FailureAnalysis[] {
    const failures: FailureAnalysis[] = [];
    const seen = new Set<string>();
    const lines = testOutput.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";

      // TypeScript / type errors
      if (line.includes("error TS") || line.match(TS_FILE_ERROR_RE)) {
        const analysis = this.analyzeTypeError(line, lines, i);
        if (analysis && !seen.has(analysis.testName)) {
          seen.add(analysis.testName);
          failures.push(analysis);
        }
        continue;
      }

      // Import / module resolution errors
      if (
        line.includes("Cannot find module") ||
        line.includes("Module not found") ||
        line.includes("SyntaxError: Cannot use import")
      ) {
        const analysis = this.analyzeImportError(line, lines, i);
        if (analysis && !seen.has(analysis.testName)) {
          seen.add(analysis.testName);
          failures.push(analysis);
        }
        continue;
      }

      // Vitest / Jest FAIL lines
      if (line.match(FAIL_LINE_RE)) {
        const analysis = this.analyzeTestFailure(line, lines, i);
        if (analysis && !seen.has(analysis.testName)) {
          seen.add(analysis.testName);
          failures.push(analysis);
        }
        continue;
      }

      // Assertion errors
      if (
        line.includes("AssertionError") ||
        line.includes("AssertionError") ||
        line.match(EXPECT_ASSERTION_RE)
      ) {
        const analysis = this.analyzeAssertionError(line, lines, i);
        if (analysis && !seen.has(analysis.testName)) {
          seen.add(analysis.testName);
          failures.push(analysis);
        }
        continue;
      }

      // Runtime errors (TypeError, ReferenceError, etc.)
      if (
        line.match(RUNTIME_ERROR_RE) ||
        (line.match(GENERIC_ERROR_RE) && !line.includes("error TS"))
      ) {
        const analysis = this.analyzeRuntimeError(line, lines, i);
        if (analysis && !seen.has(analysis.testName)) {
          seen.add(analysis.testName);
          failures.push(analysis);
        }
        continue;
      }

      // Timeout errors
      if (
        line.includes("Timeout") ||
        line.includes("exceeded") ||
        line.includes("timed out")
      ) {
        const analysis = this.analyzeTimeoutError(line, lines, i);
        if (analysis && !seen.has(analysis.testName)) {
          seen.add(analysis.testName);
          failures.push(analysis);
        }
      }
    }

    // Sort by priority hierarchy (SYNTAX→TYPE→ENVIRONMENT→RUNTIME→LOGIC→INTEGRATION)
    // then by severity, then by confidence
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    failures.sort((a, b) => {
      const priDiff =
        (FAILURE_PRIORITY[a.failureType] ?? 99) -
        (FAILURE_PRIORITY[b.failureType] ?? 99);
      if (priDiff !== 0) {
        return priDiff;
      }
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) {
        return sevDiff;
      }
      return b.confidence - a.confidence;
    });

    logger.info(
      {
        failureCount: failures.length,
        types: this.summarizeTypes(failures),
      },
      "Failures analyzed"
    );

    return failures;
  }

  categorizeFailure(failure: FailureAnalysis): FailureCategory {
    const text = `${failure.rootCause} ${failure.suggestedFix}`;

    if (CATEGORY_TYPE_ERROR_RE.test(text)) {
      return "TYPE_ERROR";
    }
    if (CATEGORY_MISSING_DEP_RE.test(text)) {
      return "MISSING_DEPENDENCY";
    }
    if (CATEGORY_RUNTIME_RE.test(text)) {
      return "RUNTIME_ERROR";
    }
    if (CATEGORY_TEST_DESIGN_RE.test(text)) {
      return "TEST_DESIGN_ERROR";
    }
    if (CATEGORY_LOGIC_RE.test(text)) {
      return "LOGIC_ERROR";
    }

    return "UNKNOWN";
  }

  private analyzeTypeError(
    line: string,
    _lines: string[],
    _index: number
  ): FailureAnalysis | null {
    const filePaths = this.extractFilePaths(line);
    const tsErrorMatch = line.match(TS_ERROR_CODE_RE);
    const errorCode = tsErrorMatch?.[1] ?? "TS????";
    const errorMsg = tsErrorMatch?.[2]?.trim() ?? line.trim();

    return {
      testName: `type-error:${errorCode}:${filePaths[0] ?? "unknown"}`,
      failureType: "type",
      rootCause: `${errorCode}: ${errorMsg}`,
      affectedFiles: filePaths,
      suggestedFix: this.suggestTypeErrorFix(errorCode, errorMsg),
      fixAgentRole: this.inferAgentRole(filePaths[0] ?? line),
      confidence: 0.9,
      severity: "high",
    };
  }

  private analyzeImportError(
    line: string,
    lines: string[],
    index: number
  ): FailureAnalysis | null {
    const moduleName = line.match(MODULE_NAME_RE)?.[1] ?? "unknown module";
    const filePaths = this.extractFilePaths(this.extractContext(lines, index));

    return {
      testName: `import-error:${moduleName}`,
      failureType: "import",
      rootCause: line.trim(),
      affectedFiles: filePaths,
      suggestedFix: `Fix import for "${moduleName}". Check that the module exists, is installed, and the path is correct. Verify package.json dependencies and tsconfig paths.`,
      fixAgentRole: this.inferAgentRole(filePaths[0] ?? line),
      confidence: 0.85,
      severity: "critical",
    };
  }

  private analyzeTestFailure(
    line: string,
    lines: string[],
    index: number
  ): FailureAnalysis | null {
    const testName = this.extractTestName(line);
    const context = this.extractContext(lines, index);
    const filePaths = this.extractFilePaths(context);

    // Try to determine if it's an assertion failure or something else
    const hasExpect = context.includes("expect") || context.includes("assert");

    return {
      testName: `test-fail:${testName}`,
      failureType: hasExpect ? "logic" : "integration",
      rootCause: context,
      affectedFiles: filePaths,
      suggestedFix: hasExpect
        ? `Fix the failing assertion in "${testName}". Compare expected vs actual values and fix the implementation or the test expectation.`
        : `Fix the failing test "${testName}". Review the test setup and the implementation it tests.`,
      fixAgentRole: "test_engineer",
      confidence: 0.7,
      severity: "medium",
    };
  }

  private analyzeAssertionError(
    _line: string,
    lines: string[],
    index: number
  ): FailureAnalysis | null {
    const context = this.extractContext(lines, index);
    const testName = this.findNearestTestName(lines, index);
    const filePaths = this.extractFilePaths(context);

    // Extract expected vs actual if possible
    const expectedMatch = context.match(EXPECTED_VALUE_RE);
    const receivedMatch = context.match(RECEIVED_VALUE_RE);
    const diff =
      expectedMatch && receivedMatch
        ? `Expected: ${expectedMatch[1]?.trim()}, Got: ${receivedMatch[1]?.trim()}`
        : context.slice(0, 200);

    return {
      testName: `assertion:${testName}`,
      failureType: "logic",
      rootCause: diff,
      affectedFiles: filePaths,
      suggestedFix: `Fix assertion failure: ${diff}. Update the implementation to match the expected behavior, or update the test if the expectation is wrong.`,
      fixAgentRole: this.inferAgentRole(filePaths[0] ?? ""),
      confidence: 0.75,
      severity: "medium",
    };
  }

  private analyzeRuntimeError(
    line: string,
    lines: string[],
    index: number
  ): FailureAnalysis | null {
    const context = this.extractContext(lines, index);
    const filePaths = this.extractFilePaths(context);
    const testName = this.findNearestTestName(lines, index);

    const errorType = line.match(ERROR_TYPE_RE)?.[1] ?? "RuntimeError";

    return {
      testName: `runtime:${errorType}:${testName}`,
      failureType: "runtime",
      rootCause: line.trim(),
      affectedFiles: filePaths,
      suggestedFix: this.suggestRuntimeFix(errorType, line.trim()),
      fixAgentRole: this.inferAgentRole(filePaths[0] ?? line),
      confidence: 0.6,
      severity: "high",
    };
  }

  private analyzeTimeoutError(
    line: string,
    lines: string[],
    index: number
  ): FailureAnalysis | null {
    const context = this.extractContext(lines, index);
    const testName = this.findNearestTestName(lines, index);
    const filePaths = this.extractFilePaths(context);

    return {
      testName: `timeout:${testName}`,
      failureType: "timeout",
      rootCause: `Test timed out: ${line.trim()}`,
      affectedFiles: filePaths,
      suggestedFix:
        "Test is timing out. Check for: unresolved promises, infinite loops, missing mock responses, or slow async operations. Increase timeout if the operation legitimately takes longer.",
      fixAgentRole: "test_engineer",
      confidence: 0.5,
      severity: "medium",
    };
  }

  private suggestTypeErrorFix(errorCode: string, errorMsg: string): string {
    const suggestions: Record<string, string> = {
      TS2304: `Name not found. Add the missing import or declare the identifier. Message: ${errorMsg}`,
      TS2307: `Module not found. Check import path, install missing package, or update tsconfig paths. Message: ${errorMsg}`,
      TS2322: `Type mismatch. Update the type annotation or fix the value assignment. Message: ${errorMsg}`,
      TS2339: `Property does not exist on type. Add the property to the type definition or use type assertion. Message: ${errorMsg}`,
      TS2345: `Argument type mismatch. Fix the argument type to match the parameter type. Message: ${errorMsg}`,
      TS2551: `Property doesn't exist (did you mean?). Fix the typo in the property name. Message: ${errorMsg}`,
      TS7006: `Parameter implicitly has 'any' type. Add explicit type annotation. Message: ${errorMsg}`,
    };

    return (
      suggestions[errorCode] ?? `Fix TypeScript error ${errorCode}: ${errorMsg}`
    );
  }

  private suggestRuntimeFix(errorType: string, line: string): string {
    const suggestions: Record<string, string> = {
      TypeError: `Fix type error at runtime: likely calling a method on null/undefined, or passing wrong argument type. Check null guards and input validation. ${line}`,
      ReferenceError: `Variable or function is not defined. Check imports, variable scope, and spelling. ${line}`,
      RangeError: `Value out of range. Check array bounds, recursion depth, or numeric limits. ${line}`,
      SyntaxError: `Syntax error in code. Fix the syntax issue - possibly a missing bracket, quote, or invalid expression. ${line}`,
    };

    return suggestions[errorType] ?? `Fix runtime ${errorType}: ${line}`;
  }

  private extractTestName(line: string): string {
    // Try various test runner output formats
    const patterns = [
      FAIL_PASS_PATTERN_RE,
      CHEVRON_PATTERN_RE,
      IT_PATTERN_RE,
      TEST_PATTERN_RE,
      DESCRIBE_PATTERN_RE,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return "unknown test";
  }

  private findNearestTestName(lines: string[], index: number): string {
    // Search backwards for a test/it/describe line
    for (let i = index; i >= Math.max(0, index - 20); i--) {
      const line = lines[i] ?? "";
      const patterns = [
        NEAREST_FAIL_RE,
        IT_PATTERN_RE,
        TEST_PATTERN_RE,
        DESCRIBE_PATTERN_RE,
      ];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match?.[1]) {
          return match[1].trim();
        }
      }
    }
    return "unknown test";
  }

  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    FILE_PATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null = FILE_PATH_RE.exec(text);

    while (match !== null) {
      if (match[0]) {
        const path = match[0].split(":")[0] as string;
        // Filter out common non-source paths
        if (!(path.includes("node_modules") || path.includes(".cache"))) {
          paths.push(path);
        }
      }
      match = FILE_PATH_RE.exec(text);
    }

    return [...new Set(paths)];
  }

  private extractContext(lines: string[], index: number): string {
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 5);
    return lines.slice(start, end).join("\n");
  }

  private inferAgentRole(fileOrLine: string): string {
    const text = fileOrLine.toLowerCase();

    if (
      text.includes("component") ||
      text.includes(".tsx") ||
      text.includes("react") ||
      text.includes("page") ||
      text.includes("layout")
    ) {
      return "frontend_coder";
    }
    if (
      text.includes("router") ||
      text.includes("trpc") ||
      text.includes("api") ||
      text.includes("service") ||
      text.includes("middleware")
    ) {
      return "backend_coder";
    }
    if (
      text.includes(".test.") ||
      text.includes(".spec.") ||
      text.includes("__test__")
    ) {
      return "test_engineer";
    }
    if (
      text.includes("docker") ||
      text.includes("k8s") ||
      text.includes("deploy")
    ) {
      return "deploy_engineer";
    }

    return "backend_coder";
  }

  private summarizeTypes(failures: FailureAnalysis[]): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const f of failures) {
      summary[f.failureType] = (summary[f.failureType] ?? 0) + 1;
    }
    return summary;
  }
}
