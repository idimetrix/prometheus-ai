/**
 * Debug Engine — GAP-026
 *
 * Autonomous debugging pipeline that classifies errors from build/test
 * output, generates fix strategies, and applies fixes iteratively
 * until the issue is resolved or max attempts are reached.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:debugging:debug-engine");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorClassification {
  /** Suggested file to fix */
  file?: string;
  /** Line number where the error occurred */
  line?: number;
  /** The error message */
  message: string;
  /** Parsed stack trace frames */
  stackTrace?: string[];
  /** Classified error type */
  type:
    | "type_error"
    | "runtime_error"
    | "import_error"
    | "syntax_error"
    | "dependency_error"
    | "build_error"
    | "test_failure";
}

export interface CodeContext {
  /** Files related to the error */
  relatedFiles: string[];
  /** Source code around the error location */
  sourceSnippet?: string;
  /** Tech stack information */
  techStack?: string;
}

export interface FixStrategy {
  /** Detailed description of the fix */
  description: string;
  /** Files that need to be modified */
  filesToModify: string[];
  /** Priority (lower = try first) */
  priority: number;
  /** Commands to run after applying the fix */
  verificationCommands: string[];
}

export interface FixResult {
  /** Duration of the fix attempt in ms */
  duration: number;
  /** Error message if the fix failed */
  error?: string;
  /** Files that were modified */
  filesModified: string[];
  /** The strategy that was applied */
  strategy: FixStrategy;
  /** Whether the fix resolved the issue */
  success: boolean;
}

export interface DebugResult {
  /** Number of attempts made */
  attempts: number;
  /** Original error classification */
  classification: ErrorClassification;
  /** Results from each fix attempt */
  fixResults: FixResult[];
  /** Whether the bug was resolved */
  resolved: boolean;
  /** Total duration across all attempts */
  totalDuration: number;
}

export interface SandboxExecutor {
  exec(
    sandboxId: string,
    command: string,
    timeoutMs: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

// ---------------------------------------------------------------------------
// Error classification patterns
// ---------------------------------------------------------------------------

interface ClassificationPattern {
  fileExtractor?: RegExp;
  lineExtractor?: RegExp;
  pattern: RegExp;
  type: ErrorClassification["type"];
}

const CLASSIFICATION_PATTERNS: ClassificationPattern[] = [
  {
    type: "type_error",
    pattern:
      /(?:TypeError|TS\d{4}|type.*(?:is not assignable|does not exist|has no property))/i,
    fileExtractor: /([\w/.:-]+\.(?:ts|tsx|js|jsx)):(\d+)/,
    lineExtractor: /:(\d+)(?::\d+)?/,
  },
  {
    type: "syntax_error",
    pattern: /(?:SyntaxError|Unexpected token|Parse error)/i,
    fileExtractor: /([\w/.:-]+\.(?:ts|tsx|js|jsx|py|go|rs)):(\d+)/,
    lineExtractor: /:(\d+)/,
  },
  {
    type: "import_error",
    pattern:
      /(?:Cannot find module|ModuleNotFoundError|import.*not found|No module named)/i,
    fileExtractor: /([\w/.:-]+\.(?:ts|tsx|js|jsx|py)):(\d+)/,
  },
  {
    type: "dependency_error",
    pattern:
      /(?:peer dependency|version conflict|ERESOLVE|could not resolve|unmet peer)/i,
  },
  {
    type: "build_error",
    pattern:
      /(?:Build failed|Compilation error|FATAL ERROR|webpack.*error|vite.*error)/i,
    fileExtractor: /([\w/.:-]+\.(?:ts|tsx|js|jsx)):(\d+)/,
  },
  {
    type: "test_failure",
    pattern:
      /(?:FAIL|AssertionError|Expected.*to.*(?:equal|be|match)|test.*failed)/i,
    fileExtractor: /([\w/.:-]+\.(?:test|spec)\.(?:ts|tsx|js|jsx|py)):(\d+)/,
  },
  {
    type: "runtime_error",
    pattern:
      /(?:ReferenceError|RangeError|null is not|undefined is not|cannot read property)/i,
    fileExtractor: /([\w/.:-]+\.(?:ts|tsx|js|jsx)):(\d+)/,
    lineExtractor: /:(\d+)(?::\d+)?/,
  },
];

/** Regex to extract stack trace lines */
const STACK_TRACE_RE =
  /\s+at\s+(?:[\w.<>]+\s+)?\(?([\w/.:-]+:\d+(?::\d+)?)\)?/g;
const ERROR_LINE_RE = /(?:Error|error|FAIL|FATAL)[:!]/i;

// ---------------------------------------------------------------------------
// DebugEngine
// ---------------------------------------------------------------------------

export class DebugEngine {
  /**
   * Parse error output and classify it into a structured ErrorClassification.
   */
  classifyError(errorOutput: string): ErrorClassification {
    for (const pattern of CLASSIFICATION_PATTERNS) {
      if (pattern.pattern.test(errorOutput)) {
        const { file, line } = this.extractFileAndLine(errorOutput, pattern);
        const stackTrace = this.extractStackTrace(errorOutput);
        const message = this.extractErrorMessage(errorOutput);

        return {
          type: pattern.type,
          file,
          line,
          message,
          stackTrace: stackTrace.length > 0 ? stackTrace : undefined,
        };
      }
    }

    // Default classification
    return {
      type: "runtime_error",
      message: this.extractErrorMessage(errorOutput),
    };
  }

  /**
   * Extract file path and line number from error output using pattern extractors.
   */
  private extractFileAndLine(
    errorOutput: string,
    pattern: ClassificationPattern
  ): { file: string | undefined; line: number | undefined } {
    let file: string | undefined;
    let line: number | undefined;

    if (pattern.fileExtractor) {
      const fileMatch = errorOutput.match(pattern.fileExtractor);
      if (fileMatch) {
        file = fileMatch[1];
        if (fileMatch[2]) {
          line = Number.parseInt(fileMatch[2], 10);
        }
      }
    }

    if (pattern.lineExtractor && !line) {
      const lineMatch = errorOutput.match(pattern.lineExtractor);
      if (lineMatch?.[1]) {
        line = Number.parseInt(lineMatch[1], 10);
      }
    }

    return { file, line };
  }

  /**
   * Extract stack trace frames from error output.
   */
  private extractStackTrace(errorOutput: string): string[] {
    const stackTrace: string[] = [];
    const traceRegex = new RegExp(STACK_TRACE_RE.source, "g");
    let match = traceRegex.exec(errorOutput);
    while (match !== null) {
      if (match[1]) {
        stackTrace.push(match[1]);
      }
      match = traceRegex.exec(errorOutput);
    }
    return stackTrace;
  }

  /**
   * Generate a fix strategy based on the error classification and code context.
   */
  generateFixStrategy(
    error: ErrorClassification,
    context: CodeContext
  ): FixStrategy {
    switch (error.type) {
      case "type_error":
        return {
          priority: 1,
          description: `Fix type error: ${error.message}`,
          filesToModify: error.file ? [error.file] : context.relatedFiles,
          verificationCommands: ["npx tsc --noEmit", "npm test"],
        };

      case "import_error":
        return {
          priority: 1,
          description: `Fix import: ${error.message}. Check module path, install missing dependency, or add missing export.`,
          filesToModify: error.file ? [error.file] : context.relatedFiles,
          verificationCommands: ["npx tsc --noEmit"],
        };

      case "syntax_error":
        return {
          priority: 0,
          description: `Fix syntax error at ${error.file ?? "unknown"}:${error.line ?? "?"}. ${error.message}`,
          filesToModify: error.file ? [error.file] : [],
          verificationCommands: ["npx tsc --noEmit"],
        };

      case "dependency_error":
        return {
          priority: 2,
          description: `Resolve dependency conflict: ${error.message}. Update package versions or add overrides.`,
          filesToModify: ["package.json"],
          verificationCommands: ["npm install", "npx tsc --noEmit"],
        };

      case "build_error":
        return {
          priority: 1,
          description: `Fix build error: ${error.message}`,
          filesToModify: error.file ? [error.file] : context.relatedFiles,
          verificationCommands: ["npm run build"],
        };

      case "test_failure":
        return {
          priority: 2,
          description: `Fix test failure: ${error.message}`,
          filesToModify: error.file ? [error.file] : context.relatedFiles,
          verificationCommands: ["npm test"],
        };

      case "runtime_error":
        return {
          priority: 1,
          description: `Fix runtime error: ${error.message}. Add null checks, fix variable references, or correct logic.`,
          filesToModify: error.file ? [error.file] : context.relatedFiles,
          verificationCommands: ["npm test"],
        };

      default:
        return {
          priority: 3,
          description: `Investigate error: ${error.message}`,
          filesToModify: context.relatedFiles,
          verificationCommands: ["npm test"],
        };
    }
  }

  /**
   * Apply a fix strategy in the sandbox and verify the result.
   * In production, this would use the agent loop to generate and apply
   * the actual code fix. The strategy guides which files to modify
   * and how to verify success.
   */
  async applyAndVerify(
    strategy: FixStrategy,
    sandboxId: string,
    executor?: SandboxExecutor
  ): Promise<FixResult> {
    const startTime = Date.now();

    logger.info(
      {
        sandboxId,
        strategy: strategy.description.slice(0, 100),
        fileCount: strategy.filesToModify.length,
      },
      "Applying fix strategy"
    );

    try {
      if (!executor) {
        return {
          strategy,
          success: false,
          filesModified: [],
          duration: Date.now() - startTime,
          error: "No sandbox executor provided",
        };
      }

      // Run verification commands to check if the fix worked
      for (const cmd of strategy.verificationCommands) {
        const result = await executor.exec(sandboxId, cmd, 120_000);
        if (result.exitCode !== 0) {
          return {
            strategy,
            success: false,
            filesModified: strategy.filesToModify,
            duration: Date.now() - startTime,
            error:
              `Verification failed: ${result.stderr || result.stdout}`.slice(
                0,
                500
              ),
          };
        }
      }

      return {
        strategy,
        success: true,
        filesModified: strategy.filesToModify,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { sandboxId, error: errorMessage },
        "Fix application failed"
      );

      return {
        strategy,
        success: false,
        filesModified: [],
        duration: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Multi-attempt debugging loop. Classifies the error, generates fix
   * strategies, and applies them iteratively until the issue is resolved
   * or max attempts are exhausted.
   */
  async debugLoop(
    errorOutput: string,
    sandboxId: string,
    maxAttempts = 3,
    executor?: SandboxExecutor
  ): Promise<DebugResult> {
    const startTime = Date.now();
    const classification = this.classifyError(errorOutput);
    const fixResults: FixResult[] = [];

    logger.info(
      {
        sandboxId,
        errorType: classification.type,
        maxAttempts,
        file: classification.file,
      },
      "Starting debug loop"
    );

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const context: CodeContext = {
        relatedFiles: classification.file ? [classification.file] : [],
        techStack: "typescript",
      };

      const strategy = this.generateFixStrategy(classification, context);
      const result = await this.applyAndVerify(strategy, sandboxId, executor);
      fixResults.push(result);

      if (result.success) {
        logger.info(
          { sandboxId, attempt: attempt + 1 },
          "Debug loop resolved the issue"
        );
        return {
          resolved: true,
          classification,
          fixResults,
          attempts: attempt + 1,
          totalDuration: Date.now() - startTime,
        };
      }

      logger.info(
        { sandboxId, attempt: attempt + 1, error: result.error?.slice(0, 100) },
        "Fix attempt failed, trying next strategy"
      );
    }

    logger.warn(
      { sandboxId, maxAttempts },
      "Debug loop exhausted all attempts"
    );

    return {
      resolved: false,
      classification,
      fixResults,
      attempts: maxAttempts,
      totalDuration: Date.now() - startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract the most relevant error message from raw output.
   */
  private extractErrorMessage(output: string): string {
    const lines = output.split("\n").filter(Boolean);

    // Look for lines containing "Error:" or "error:"
    for (const line of lines) {
      if (ERROR_LINE_RE.test(line)) {
        return line.trim().slice(0, 500);
      }
    }

    // Fall back to the first non-empty line
    return (lines[0] ?? output.slice(0, 500)).trim();
  }
}
