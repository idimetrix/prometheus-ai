/**
 * Phase 2.4: Cross-File Consistency Validator
 *
 * Verifies imports, exports, and type references across changed files.
 * Runs a scoped TypeScript check and classifies diagnostics by category:
 * broken imports, missing exports, type mismatches, and circular dependencies.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:cross-file-validator");

const IMPORT_RE =
  /(?:import|export)\s+.*?from\s+["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\)/g;
const DIR_RE = /\/[^/]+$/;

const TSC_DIAGNOSTIC_RE = /^(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;

/** TS error codes that indicate import/export issues */
const IMPORT_ERROR_CODES = new Set([
  "TS2305", // Module has no exported member
  "TS2307", // Cannot find module
  "TS2306", // Not a module
  "TS2497", // Module resolves to non-module entity
  "TS2614", // Module has no default export
  "TS2613", // Module has no named export
  "TS1192", // Module has no default export (alt)
  "TS2724", // Module has no exported member (re-export)
]);

const TYPE_MISMATCH_CODES = new Set([
  "TS2322", // Type is not assignable
  "TS2345", // Argument of type is not assignable
  "TS2339", // Property does not exist on type
  "TS2741", // Property is missing in type
  "TS2559", // Type has no properties in common
  "TS2344", // Type does not satisfy constraint
  "TS2416", // Property in type is not assignable
  "TS2430", // Interface incorrectly extends
  "TS2694", // Namespace has no exported member
]);

const CIRCULAR_INDICATORS = [
  "circular",
  "cannot access",
  "used before",
  "referenced directly or indirectly",
];

export type CrossFileIssueType =
  | "broken_import"
  | "circular_dependency"
  | "missing_export"
  | "type_mismatch";

export interface CrossFileIssue {
  details: string;
  filePath: string;
  severity: "error" | "warning";
  type: CrossFileIssueType;
}

export interface CrossFileValidationResult {
  issues: CrossFileIssue[];
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
      { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
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

function classifyIssue(code: string, message: string): CrossFileIssueType {
  // Check for circular dependency indicators
  const lowerMsg = message.toLowerCase();
  for (const indicator of CIRCULAR_INDICATORS) {
    if (lowerMsg.includes(indicator)) {
      return "circular_dependency";
    }
  }

  if (IMPORT_ERROR_CODES.has(code)) {
    // Distinguish between broken_import and missing_export
    if (
      code === "TS2305" ||
      code === "TS2614" ||
      code === "TS2613" ||
      code === "TS2724"
    ) {
      return "missing_export";
    }
    return "broken_import";
  }

  if (TYPE_MISMATCH_CODES.has(code)) {
    return "type_mismatch";
  }

  // Default: if it mentions import/require, it's an import issue
  if (lowerMsg.includes("import") || lowerMsg.includes("require")) {
    return "broken_import";
  }

  return "type_mismatch";
}

/**
 * Extract import paths from a TypeScript file to identify dependent files.
 */
async function extractImports(filePath: string): Promise<string[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const imports: string[] = [];
    let match: RegExpExecArray | null;

    IMPORT_RE.lastIndex = 0;
    match = IMPORT_RE.exec(content);
    while (match !== null) {
      const importPath = match[1] ?? match[2];
      if (importPath?.startsWith(".")) {
        imports.push(importPath);
      }
      match = IMPORT_RE.exec(content);
    }

    return imports;
  } catch {
    return [];
  }
}

export class CrossFileValidator {
  /**
   * Validate cross-file consistency for a set of changed files.
   *
   * Runs tsc --noEmit on the project (scoped via changed files) and
   * classifies any errors related to imports, exports, and type references.
   */
  async validate(
    changedFiles: string[],
    workDir: string
  ): Promise<CrossFileValidationResult> {
    if (changedFiles.length === 0) {
      return { valid: true, issues: [], summary: "No files to validate." };
    }

    const resolvedFiles = changedFiles.map((fp) => resolve(workDir, fp));
    const tsFiles = resolvedFiles.filter(
      (fp) => fp.endsWith(".ts") || fp.endsWith(".tsx")
    );

    if (tsFiles.length === 0) {
      return {
        valid: true,
        issues: [],
        summary: "No TypeScript files to validate.",
      };
    }

    logger.info(
      { fileCount: tsFiles.length, workDir },
      "Running cross-file validation"
    );

    // Collect related files by scanning imports
    const relatedFiles = new Set<string>(tsFiles);
    for (const file of tsFiles) {
      const imports = await extractImports(file);
      for (const imp of imports) {
        // Resolve relative imports from the file's directory
        const dir = file.replace(DIR_RE, "");
        const extensions = [".ts", ".tsx", "/index.ts", "/index.tsx"];
        for (const ext of extensions) {
          relatedFiles.add(resolve(dir, `${imp}${ext}`));
        }
      }
    }

    // Run tsc on the changed files
    const args = [
      "--noEmit",
      "--pretty",
      "false",
      "--skipLibCheck",
      ...tsFiles,
    ];

    try {
      const { stdout, stderr } = await runTsc(args, workDir);
      const combinedOutput = `${stdout}\n${stderr}`;
      const issues = this.parseAndClassify(combinedOutput, tsFiles);

      const hasErrors = issues.some((i) => i.severity === "error");
      const result: CrossFileValidationResult = {
        valid: !hasErrors,
        issues,
        summary: this.buildSummary(issues),
      };

      logger.info(
        {
          valid: result.valid,
          issueCount: issues.length,
          byType: {
            broken_import: issues.filter((i) => i.type === "broken_import")
              .length,
            missing_export: issues.filter((i) => i.type === "missing_export")
              .length,
            type_mismatch: issues.filter((i) => i.type === "type_mismatch")
              .length,
            circular_dependency: issues.filter(
              (i) => i.type === "circular_dependency"
            ).length,
          },
        },
        "Cross-file validation complete"
      );

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Cross-file validation process failed");

      return {
        valid: false,
        issues: [
          {
            type: "broken_import",
            filePath: tsFiles[0] ?? "",
            details: `Validation process failed: ${msg}`,
            severity: "error",
          },
        ],
        summary: `Validation process failed: ${msg}`,
      };
    }
  }

  /**
   * Format validation result into a prompt suitable for an agent.
   */
  formatForAgent(result: CrossFileValidationResult): string {
    if (result.valid && result.issues.length === 0) {
      return "Cross-file validation passed. All imports, exports, and type references are consistent.";
    }

    const header = result.valid
      ? "Cross-file validation passed with warnings:"
      : "Cross-file validation FAILED:";

    const grouped = new Map<CrossFileIssueType, CrossFileIssue[]>();
    for (const issue of result.issues) {
      const existing = grouped.get(issue.type) ?? [];
      existing.push(issue);
      grouped.set(issue.type, existing);
    }

    const sections: string[] = [header, ""];

    const typeLabels: Record<CrossFileIssueType, string> = {
      broken_import: "Broken Imports",
      missing_export: "Missing Exports",
      type_mismatch: "Type Mismatches",
      circular_dependency: "Circular Dependencies",
    };

    for (const [type, issues] of grouped) {
      sections.push(`## ${typeLabels[type]} (${issues.length})`);
      for (const issue of issues) {
        const prefix = issue.severity === "error" ? "ERROR" : "WARN";
        sections.push(`  [${prefix}] ${issue.filePath}: ${issue.details}`);
      }
      sections.push("");
    }

    sections.push(result.summary);
    return sections.join("\n");
  }

  private parseAndClassify(
    output: string,
    targetFiles: string[]
  ): CrossFileIssue[] {
    const issues: CrossFileIssue[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const match = trimmed.match(TSC_DIAGNOSTIC_RE);
      if (!match) {
        continue;
      }

      const filePath = match[1] ?? "";
      const lineNum = match[2] ?? "0";
      const colNum = match[3] ?? "0";
      const code = match[4] ?? "";
      const message = match[5] ?? "";

      // Only include issues from target files or referencing them
      const isRelevant = targetFiles.some(
        (fp) =>
          filePath === fp ||
          fp.endsWith(filePath) ||
          filePath.endsWith(fp.split("/").pop() ?? "")
      );

      if (!isRelevant) {
        continue;
      }

      const type = classifyIssue(code, message);

      issues.push({
        type,
        filePath,
        details: `Line ${lineNum}:${colNum} - ${code}: ${message}`,
        severity: "error",
      });
    }

    return issues;
  }

  private buildSummary(issues: CrossFileIssue[]): string {
    if (issues.length === 0) {
      return "All cross-file references are valid.";
    }

    const counts: Record<string, number> = {};
    for (const issue of issues) {
      counts[issue.type] = (counts[issue.type] ?? 0) + 1;
    }

    const parts = Object.entries(counts)
      .map(([type, count]) => `${count} ${type.replace(/_/g, " ")}`)
      .join(", ");

    const uniqueFiles = new Set(issues.map((i) => i.filePath));
    return `Found ${issues.length} cross-file issue${issues.length === 1 ? "" : "s"} (${parts}) across ${uniqueFiles.size} file${uniqueFiles.size === 1 ? "" : "s"}.`;
  }
}
