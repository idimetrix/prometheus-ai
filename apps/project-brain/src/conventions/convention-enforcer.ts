/**
 * Phase 3.3: Convention Enforcement.
 *
 * Validates agent-generated code against learned project conventions.
 * Returns violations with severity, location, and suggested fixes.
 * Can generate a system prompt addition describing project conventions.
 */
import { createLogger } from "@prometheus/logger";

import type {
  Convention,
  ConventionMemoryLayer,
} from "../layers/convention-memory";

const logger = createLogger("project-brain:convention-enforcer");

// ---- Regex constants for enforcement checks ----
const FILE_EXT_RE = /\.\w+$/;
const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CAMEL_CASE_RE = /^[a-z][a-zA-Z0-9]*$/;
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const PASCAL_CASE_RE = /^[A-Z][a-zA-Z0-9]*$/;

const IMPORT_LINE_RE = /^import\s+.*from\s+["'](.+?)["'];?\s*$/gm;
const RELATIVE_IMPORT_RE = /^\.{1,2}\//;
const CONSOLE_LOG_RE = /console\.(log|warn|error|info|debug)\s*\(/g;
const CREATE_LOGGER_RE = /createLogger\s*\(/;
const DEFAULT_EXPORT_RE = /export\s+default\s/;
const NAMED_EXPORT_RE =
  /export\s+(?:const|function|class|interface|type|enum)\s/g;
const _TYPE_IMPORT_RE = /import\s+type\s/;
const INSTANCEOF_ERROR_RE = /instanceof\s+Error/;
const _TRY_CATCH_RE = /try\s*\{/g;
const CATCH_BLOCK_RE = /catch\s*\([^)]*\)\s*\{/g;
const CLASS_COMPONENT_RE = /class\s+\w+\s+extends\s+(?:React\.)?Component/;
const _FUNCTIONAL_COMPONENT_RE =
  /(?:export\s+)?(?:const|function)\s+[A-Z]\w+\s*(?::\s*React\.FC|=\s*\()/;

export type ViolationSeverity = "error" | "warning" | "info";

export interface ConventionViolation {
  /** Category of the convention */
  category: string;
  /** The convention that was violated */
  conventionPattern: string;
  /** Line number where the violation occurs (1-based), if applicable */
  line?: number;
  /** Human-readable description of the violation */
  message: string;
  /** Severity level */
  severity: ViolationSeverity;
  /** Suggested fix */
  suggestion?: string;
}

export interface EnforcementResult {
  /** Number of conventions checked */
  conventionsChecked: number;
  /** Number of conventions that passed */
  conventionsPassed: number;
  /** Whether all conventions are satisfied */
  passed: boolean;
  /** List of violations found */
  violations: ConventionViolation[];
}

/**
 * ConventionEnforcer validates code against learned project conventions.
 */
export class ConventionEnforcer {
  private readonly conventionMemory: ConventionMemoryLayer;

  constructor(conventionMemory: ConventionMemoryLayer) {
    this.conventionMemory = conventionMemory;
  }

  /**
   * Validate code against learned conventions for a project.
   * Returns violations with severity, location, and suggested fix.
   */
  async enforce(
    projectId: string,
    code: string,
    filePath: string
  ): Promise<EnforcementResult> {
    const conventions = await this.conventionMemory.list(projectId);
    const highConfidence = conventions.filter((c) => c.confidence >= 0.6);

    const violations: ConventionViolation[] = [];
    let passed = 0;

    for (const conv of highConfidence) {
      const result = this.checkConvention(conv, code, filePath);
      if (result.length > 0) {
        for (const v of result) {
          violations.push(v);
        }
      } else {
        passed++;
      }
    }

    const hasErrors = violations.some((v) => v.severity === "error");

    logger.debug(
      {
        projectId,
        filePath,
        conventionsChecked: highConfidence.length,
        violations: violations.length,
        passed,
      },
      "Convention enforcement complete"
    );

    return {
      passed: !hasErrors,
      violations,
      conventionsChecked: highConfidence.length,
      conventionsPassed: passed,
    };
  }

  /**
   * Generate a system prompt addition describing project conventions.
   * Suitable for injection into AI agent system prompts.
   */
  async getConventionPrompt(projectId: string): Promise<string> {
    const prompt = await this.conventionMemory.buildPrompt(projectId);

    if (!prompt) {
      return "";
    }

    const parts: string[] = [
      prompt,
      "",
      "When generating code, follow these conventions strictly.",
      "Violations will be flagged during review.",
    ];

    return parts.join("\n");
  }

  // ---- Convention Checkers ----

  private checkConvention(
    conv: Convention,
    code: string,
    filePath: string
  ): ConventionViolation[] {
    const pattern = conv.pattern.toLowerCase();

    // Route to the appropriate checker based on pattern
    if (pattern.includes("kebab") && pattern.includes("file")) {
      return this.checkFileNaming(conv, filePath, "kebab-case");
    }
    if (pattern.includes("camel") && pattern.includes("file")) {
      return this.checkFileNaming(conv, filePath, "camelCase");
    }
    if (pattern.includes("snake") && pattern.includes("file")) {
      return this.checkFileNaming(conv, filePath, "snake_case");
    }
    if (pattern.includes("pascal") && pattern.includes("file")) {
      return this.checkFileNaming(conv, filePath, "PascalCase");
    }

    if (
      pattern.includes("external") &&
      pattern.includes("import") &&
      pattern.includes("first")
    ) {
      return this.checkImportOrdering(conv, code);
    }

    if (pattern.includes("named-export") || pattern.includes("named_export")) {
      return this.checkNamedExports(conv, code);
    }

    if (
      pattern.includes("type-only-import") ||
      pattern.includes("type_import")
    ) {
      return this.checkTypeImports(conv, code);
    }

    if (
      pattern.includes("structured-logger") ||
      pattern.includes("structured_logger")
    ) {
      return this.checkLoggerUsage(conv, code);
    }

    if (
      pattern.includes("instanceof-error") ||
      pattern.includes("instanceof_error")
    ) {
      return this.checkErrorHandling(conv, code);
    }

    if (
      pattern.includes("functional-component") ||
      pattern.includes("functional_component")
    ) {
      return this.checkComponentStyle(conv, code);
    }

    return [];
  }

  private checkFileNaming(
    conv: Convention,
    filePath: string,
    expectedStyle: string
  ): ConventionViolation[] {
    const fileName = filePath.split("/").pop() ?? "";
    // Strip extension for checking
    const baseName = fileName.replace(FILE_EXT_RE, "");

    if (!baseName || baseName === "index") {
      return []; // Skip index files
    }

    const matchers: Record<string, RegExp> = {
      "kebab-case": KEBAB_CASE_RE,
      camelCase: CAMEL_CASE_RE,
      snake_case: SNAKE_CASE_RE,
      PascalCase: PASCAL_CASE_RE,
    };

    const matcher = matchers[expectedStyle];
    if (!matcher || matcher.test(baseName)) {
      return [];
    }

    return [
      {
        conventionPattern: conv.pattern,
        category: conv.category ?? "naming",
        severity: conv.confidence >= 0.8 ? "warning" : "info",
        message: `File name "${fileName}" does not follow ${expectedStyle} convention`,
        suggestion: `Rename to ${convertToStyle(baseName, expectedStyle)}.${fileName.split(".").pop()}`,
      },
    ];
  }

  private checkImportOrdering(
    conv: Convention,
    code: string
  ): ConventionViolation[] {
    const importMatches = Array.from(code.matchAll(IMPORT_LINE_RE));
    if (importMatches.length < 2) {
      return [];
    }

    let lastExternalLine = -1;
    let firstRelativeLine = Number.MAX_SAFE_INTEGER;

    for (const match of importMatches) {
      const source = match[1] ?? "";
      const lineNum = code.slice(0, match.index).split("\n").length;

      if (RELATIVE_IMPORT_RE.test(source)) {
        if (lineNum < firstRelativeLine) {
          firstRelativeLine = lineNum;
        }
      } else {
        lastExternalLine = lineNum;
      }
    }

    if (lastExternalLine > firstRelativeLine) {
      return [
        {
          conventionPattern: conv.pattern,
          category: conv.category ?? "imports",
          severity: "warning",
          message:
            "Import ordering: external/package imports should come before relative imports",
          line: lastExternalLine,
          suggestion:
            "Move external imports above relative imports. Group: 1) external packages, 2) workspace packages, 3) relative imports",
        },
      ];
    }

    return [];
  }

  private checkNamedExports(
    conv: Convention,
    code: string
  ): ConventionViolation[] {
    if (!DEFAULT_EXPORT_RE.test(code)) {
      return [];
    }

    const namedExports = code.match(NAMED_EXPORT_RE);
    if (namedExports && namedExports.length > 0) {
      // File has both named and default exports; flag default as unexpected
      return [
        {
          conventionPattern: conv.pattern,
          category: conv.category ?? "other",
          severity: "info",
          message:
            "File uses default export, but project convention prefers named exports",
          suggestion:
            "Replace default export with a named export for better refactoring support",
        },
      ];
    }

    return [
      {
        conventionPattern: conv.pattern,
        category: conv.category ?? "other",
        severity: "info",
        message:
          "File uses default export, but project convention prefers named exports",
        suggestion:
          "Convert to a named export: export function/class/const X = ...",
      },
    ];
  }

  private checkTypeImports(
    _conv: Convention,
    _code: string
  ): ConventionViolation[] {
    // Type-only import detection requires full type analysis.
    // For now, this is a placeholder that returns no violations.
    // Future: integrate with TypeScript compiler API to detect
    // imports that are only used as types and should use `import type`.
    return [];
  }

  private checkLoggerUsage(
    conv: Convention,
    code: string
  ): ConventionViolation[] {
    const consoleMatches = Array.from(code.matchAll(CONSOLE_LOG_RE));
    if (consoleMatches.length === 0) {
      return [];
    }

    // Don't flag if the file already uses createLogger
    if (CREATE_LOGGER_RE.test(code)) {
      return [];
    }

    const violations: ConventionViolation[] = [];
    for (const match of consoleMatches) {
      const lineNum = code.slice(0, match.index).split("\n").length;
      violations.push({
        conventionPattern: conv.pattern,
        category: conv.category ?? "other",
        severity: "warning",
        message: `console.${match[1]} used instead of structured logger`,
        line: lineNum,
        suggestion:
          'Use createLogger("module-name") from @prometheus/logger instead of console.*',
      });
    }

    return violations;
  }

  private checkErrorHandling(
    conv: Convention,
    code: string
  ): ConventionViolation[] {
    const catchBlocks = Array.from(code.matchAll(CATCH_BLOCK_RE));
    if (catchBlocks.length === 0) {
      return [];
    }

    const violations: ConventionViolation[] = [];
    for (const match of catchBlocks) {
      const catchStart = match.index ?? 0;
      // Look ahead ~200 chars for instanceof check
      const catchRegion = code.slice(catchStart, catchStart + 300);

      if (!INSTANCEOF_ERROR_RE.test(catchRegion)) {
        const lineNum = code.slice(0, catchStart).split("\n").length;
        violations.push({
          conventionPattern: conv.pattern,
          category: conv.category ?? "error_handling",
          severity: "info",
          message: "Catch block does not use instanceof Error type guard",
          line: lineNum,
          suggestion:
            "Add: const message = err instanceof Error ? err.message : String(err)",
        });
      }
    }

    return violations;
  }

  private checkComponentStyle(
    conv: Convention,
    code: string
  ): ConventionViolation[] {
    if (!CLASS_COMPONENT_RE.test(code)) {
      return [];
    }

    // Only flag if the file looks like a React file
    if (
      !(
        code.includes("react") ||
        code.includes("React") ||
        code.includes("jsx")
      )
    ) {
      return [];
    }

    return [
      {
        conventionPattern: conv.pattern,
        category: conv.category ?? "other",
        severity: "warning",
        message:
          "Class component detected; project convention prefers functional components with hooks",
        suggestion:
          "Convert to a functional component using hooks (useState, useEffect, etc.)",
      },
    ];
  }
}

/**
 * Convert a name to the target style (best-effort).
 */
function convertToStyle(name: string, style: string): string {
  // Split on common boundaries
  const parts = name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[_-]+/g, "-")
    .toLowerCase()
    .split("-")
    .filter(Boolean);

  switch (style) {
    case "kebab-case":
      return parts.join("-");
    case "camelCase":
      return parts
        .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
        .join("");
    case "snake_case":
      return parts.join("_");
    case "PascalCase":
      return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
    default:
      return name;
  }
}
