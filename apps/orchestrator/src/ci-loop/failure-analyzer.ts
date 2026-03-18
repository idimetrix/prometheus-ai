import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ci-loop:analyzer");

export type FailureType = "syntax" | "logic" | "integration" | "type" | "runtime";

export interface FailureAnalysis {
  testName: string;
  failureType: FailureType;
  rootCause: string;
  affectedFiles: string[];
  suggestedFix: string;
  fixAgentRole: string;
  confidence: number;
}

export class FailureAnalyzer {
  analyze(testOutput: string): FailureAnalysis[] {
    const failures: FailureAnalysis[] = [];
    const lines = testOutput.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";

      // Detect TypeScript errors
      if (line.includes("error TS")) {
        failures.push({
          testName: this.extractTestName(line),
          failureType: "type",
          rootCause: line.trim(),
          affectedFiles: this.extractFilePaths(line),
          suggestedFix: "Fix TypeScript type error",
          fixAgentRole: this.inferAgentRole(line),
          confidence: 0.9,
        });
      }

      // Detect test failures
      if (line.includes("FAIL") || line.includes("AssertionError") || line.includes("expect(")) {
        failures.push({
          testName: this.extractTestName(line),
          failureType: "logic",
          rootCause: this.extractContext(lines, i),
          affectedFiles: this.extractFilePaths(line),
          suggestedFix: "Fix failing assertion",
          fixAgentRole: "test_engineer",
          confidence: 0.7,
        });
      }

      // Detect runtime errors
      if (line.includes("Error:") || line.includes("TypeError") || line.includes("ReferenceError")) {
        failures.push({
          testName: this.extractTestName(line),
          failureType: "runtime",
          rootCause: line.trim(),
          affectedFiles: this.extractFilePaths(this.extractContext(lines, i)),
          suggestedFix: "Fix runtime error",
          fixAgentRole: this.inferAgentRole(line),
          confidence: 0.6,
        });
      }
    }

    logger.info({ failureCount: failures.length }, "Failures analyzed");
    return failures;
  }

  private extractTestName(line: string): string {
    const match = line.match(/(?:FAIL|PASS|✕|✓)\s+(.+)/);
    return match?.[1]?.trim() ?? "unknown test";
  }

  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    const pathRegex = /(?:\/[\w.-]+)+\.\w+(?::\d+(?::\d+)?)?/g;
    let match;
    while ((match = pathRegex.exec(text)) !== null) {
      if (match[0]) paths.push(match[0].split(":")[0]!);
    }
    return [...new Set(paths)];
  }

  private extractContext(lines: string[], index: number): string {
    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length, index + 3);
    return lines.slice(start, end).join("\n");
  }

  private inferAgentRole(line: string): string {
    if (line.includes("component") || line.includes(".tsx") || line.includes("React")) {
      return "frontend_coder";
    }
    if (line.includes("router") || line.includes("trpc") || line.includes("api")) {
      return "backend_coder";
    }
    return "backend_coder";
  }
}
