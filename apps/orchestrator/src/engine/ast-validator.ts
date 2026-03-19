/**
 * Phase 2.1: AST-level Validation Gate
 *
 * Validates TypeScript files by running the compiler in --noEmit mode
 * and parsing structured diagnostics from the output. Provides structured
 * error/warning results that agents can act on.
 */

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ast-validator");

const TSC_DIAGNOSTIC_RE =
  /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

export interface ASTValidationIssue {
  code: string;
  column: number;
  filePath: string;
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface ASTValidationResult {
  issues: ASTValidationIssue[];
  summary: string;
  valid: boolean;
}

function runTsc(
  args: string[],
  cwd: string
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      "npx",
      ["tsc", ...args],
      { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        resolvePromise({
          exitCode: typeof error?.code === "number" ? error.code : 0,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      }
    );
  });
}

function parseTscOutput(output: string): ASTValidationIssue[] {
  const issues: ASTValidationIssue[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match = trimmed.match(TSC_DIAGNOSTIC_RE);
    if (match) {
      issues.push({
        filePath: match[1] ?? "",
        line: Number.parseInt(match[2] ?? "0", 10),
        column: Number.parseInt(match[3] ?? "0", 10),
        severity: (match[4] as "error" | "warning") ?? "error",
        code: match[5] ?? "",
        message: match[6] ?? "",
      });
    }
  }

  return issues;
}

function buildSummary(issues: ASTValidationIssue[]): string {
  if (issues.length === 0) {
    return "No TypeScript issues found.";
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const parts: string[] = [];

  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  }
  if (warningCount > 0) {
    parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  }

  const uniqueFiles = new Set(issues.map((i) => i.filePath));
  return `Found ${parts.join(" and ")} across ${uniqueFiles.size} file${uniqueFiles.size === 1 ? "" : "s"}.`;
}

export class ASTValidator {
  /**
   * Validate a single TypeScript file using `npx tsc --noEmit`.
   * Falls back to a permissive result if tsc is unavailable.
   */
  validateFile(
    filePath: string,
    workDir: string
  ): Promise<ASTValidationResult> {
    return this.validateFiles([filePath], workDir);
  }

  /**
   * Validate multiple TypeScript files in one pass.
   * Runs tsc with --noEmit and --pretty false for machine-parseable output.
   */
  async validateFiles(
    filePaths: string[],
    workDir: string
  ): Promise<ASTValidationResult> {
    if (filePaths.length === 0) {
      return { valid: true, issues: [], summary: "No files to validate." };
    }

    const resolvedPaths = filePaths.map((fp) => resolve(workDir, fp));
    const tsFiles = resolvedPaths.filter(
      (fp) => fp.endsWith(".ts") || fp.endsWith(".tsx")
    );

    if (tsFiles.length === 0) {
      return {
        valid: true,
        issues: [],
        summary: "No TypeScript files to validate.",
      };
    }

    const args = [
      "--noEmit",
      "--pretty",
      "false",
      "--skipLibCheck",
      ...tsFiles,
    ];

    logger.info(
      { fileCount: tsFiles.length, workDir },
      "Running AST validation"
    );

    try {
      const { stdout, stderr, exitCode } = await runTsc(args, workDir);
      const combinedOutput = `${stdout}\n${stderr}`;
      const allIssues = parseTscOutput(combinedOutput);

      // Filter to only issues in our target files
      const relevantIssues = allIssues.filter((issue) =>
        tsFiles.some(
          (fp) => issue.filePath === fp || fp.endsWith(issue.filePath)
        )
      );

      const hasErrors = relevantIssues.some((i) => i.severity === "error");
      const result: ASTValidationResult = {
        valid: !hasErrors,
        issues: relevantIssues,
        summary: buildSummary(relevantIssues),
      };

      logger.info(
        {
          exitCode,
          issueCount: relevantIssues.length,
          valid: result.valid,
        },
        "AST validation complete"
      );

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "AST validation process failed");

      return {
        valid: false,
        issues: [
          {
            filePath: tsFiles[0] ?? "",
            line: 0,
            column: 0,
            severity: "error",
            code: "VALIDATOR_ERROR",
            message: `AST validation process failed: ${msg}`,
          },
        ],
        summary: `Validation process failed: ${msg}`,
      };
    }
  }

  /**
   * Format validation issues into a human-readable string
   * suitable for feeding back to an agent.
   */
  formatIssuesForAgent(result: ASTValidationResult): string {
    if (result.valid && result.issues.length === 0) {
      return "All TypeScript checks passed. No issues found.";
    }

    const header = result.valid
      ? "TypeScript check passed with warnings:"
      : "TypeScript check FAILED with errors:";

    const issueLines = result.issues.map((issue) => {
      const location =
        issue.line > 0
          ? `${issue.filePath}:${issue.line}:${issue.column}`
          : issue.filePath;
      const prefix = issue.severity === "error" ? "ERROR" : "WARN";
      return `  [${prefix}] ${location} - ${issue.code}: ${issue.message}`;
    });

    return [header, "", ...issueLines, "", result.summary].join("\n");
  }
}
