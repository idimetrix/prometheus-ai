/**
 * Phase 6.1: Convention Detection.
 *
 * Analyzes codebase files to detect naming conventions, file organization
 * patterns, import ordering patterns, and error handling conventions.
 * Returns detected conventions with confidence scores and examples.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:convention-detector");

/** A detected convention with metadata. */
export interface DetectedConvention {
  /** Confidence level 0-1 */
  confidence: number;
  /** Example occurrences */
  examples: string[];
  /** Human-readable description */
  pattern: string;
  /** Convention category */
  type: "error_handling" | "file_organization" | "import_ordering" | "naming";
}

/** Symbol info for naming analysis. */
export interface SymbolInfo {
  kind: "class" | "constant" | "enum" | "function" | "interface" | "variable";
  name: string;
}

/** Import info for import pattern analysis. */
export interface ImportInfo {
  file: string;
  imports: string[];
}

// ---- Naming pattern regexes ----
const CAMEL_CASE_RE = /^[a-z][a-zA-Z0-9]*$/;
const PASCAL_CASE_RE = /^[A-Z][a-zA-Z0-9]*$/;
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const SCREAMING_SNAKE_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

// ---- File extension regex ----
const FILE_EXT_RE = /\.\w+$/;

// ---- Import classification regexes ----
const SCOPED_IMPORT_RE = /^@/;
const RELATIVE_IMPORT_RE = /^\.\/?/;

// ---- Error handling regexes ----
const TRY_CATCH_RE = /try\s*\{/;
const INSTANCEOF_ERROR_RE = /instanceof\s+Error/;
const CUSTOM_ERROR_RE = /class\s+\w+\s+extends\s+\w*Error/;
const RESULT_TYPE_RE = /Result<|Either<|Ok\(|Err\(/;

/**
 * Detects conventions from code analysis data.
 */
export class ConventionDetector {
  /**
   * Detect naming conventions from symbol data.
   */
  detectNamingConventions(
    files: Array<{ path: string; symbols: SymbolInfo[] }>
  ): DetectedConvention[] {
    const conventions: DetectedConvention[] = [];

    // Analyze function naming
    const functionNames = files.flatMap((f) =>
      f.symbols.filter((s) => s.kind === "function").map((s) => s.name)
    );
    const funcConvention = detectNamingPattern(functionNames, "function");
    if (funcConvention) {
      conventions.push({ ...funcConvention, type: "naming" });
    }

    // Analyze class/interface naming
    const typeNames = files.flatMap((f) =>
      f.symbols
        .filter(
          (s) =>
            s.kind === "class" || s.kind === "interface" || s.kind === "enum"
        )
        .map((s) => s.name)
    );
    const typeConvention = detectNamingPattern(typeNames, "type");
    if (typeConvention) {
      conventions.push({ ...typeConvention, type: "naming" });
    }

    // Analyze constant naming
    const constantNames = files.flatMap((f) =>
      f.symbols.filter((s) => s.kind === "constant").map((s) => s.name)
    );
    const constConvention = detectNamingPattern(constantNames, "constant");
    if (constConvention) {
      conventions.push({ ...constConvention, type: "naming" });
    }

    // Analyze file naming
    const fileNames = files.map((f) => {
      const name = f.path.split("/").pop() ?? "";
      return name.replace(FILE_EXT_RE, "");
    });
    const fileConvention = detectNamingPattern(
      fileNames.filter((n) => n !== "index"),
      "file"
    );
    if (fileConvention) {
      conventions.push({ ...fileConvention, type: "naming" });
    }

    logger.debug(
      { conventionCount: conventions.length },
      "Naming conventions detected"
    );

    return conventions;
  }

  /**
   * Detect file organization patterns from a file tree.
   */
  detectFileOrganization(fileTree: string[]): DetectedConvention[] {
    const conventions: DetectedConvention[] = [];

    // Detect src/ directory pattern
    const srcFiles = fileTree.filter((f) => f.includes("/src/"));
    if (srcFiles.length > fileTree.length * 0.5) {
      conventions.push({
        type: "file_organization",
        pattern: "Source files organized under src/ directory",
        confidence: srcFiles.length / fileTree.length,
        examples: srcFiles.slice(0, 3),
      });
    }

    // Detect __tests__ directory pattern
    const testDirFiles = fileTree.filter((f) => f.includes("__tests__"));
    const colocatedTests = fileTree.filter(
      (f) =>
        (f.includes(".test.") || f.includes(".spec.")) &&
        !f.includes("__tests__")
    );

    if (
      testDirFiles.length > colocatedTests.length &&
      testDirFiles.length > 2
    ) {
      conventions.push({
        type: "file_organization",
        pattern: "Tests placed in __tests__ directories",
        confidence: Math.min(
          1,
          testDirFiles.length / (testDirFiles.length + colocatedTests.length)
        ),
        examples: testDirFiles.slice(0, 3),
      });
    } else if (
      colocatedTests.length > testDirFiles.length &&
      colocatedTests.length > 2
    ) {
      conventions.push({
        type: "file_organization",
        pattern: "Tests co-located with source files",
        confidence: Math.min(
          1,
          colocatedTests.length / (testDirFiles.length + colocatedTests.length)
        ),
        examples: colocatedTests.slice(0, 3),
      });
    }

    // Detect barrel file (index.ts) pattern
    const indexFiles = fileTree.filter(
      (f) => f.endsWith("/index.ts") || f.endsWith("/index.js")
    );
    const directories = new Set(
      fileTree.map((f) => {
        const parts = f.split("/");
        parts.pop();
        return parts.join("/");
      })
    );
    if (indexFiles.length > directories.size * 0.3 && indexFiles.length > 3) {
      conventions.push({
        type: "file_organization",
        pattern: "Index barrel files for module exports",
        confidence: Math.min(1, indexFiles.length / directories.size),
        examples: indexFiles.slice(0, 3),
      });
    }

    logger.debug(
      { conventionCount: conventions.length },
      "File organization conventions detected"
    );

    return conventions;
  }

  /**
   * Detect import ordering patterns.
   */
  detectImportPatterns(imports: ImportInfo[]): DetectedConvention[] {
    const conventions: DetectedConvention[] = [];
    let externalFirstCount = 0;
    let analyzedCount = 0;

    for (const entry of imports) {
      if (entry.imports.length < 2) {
        continue;
      }
      analyzedCount++;

      const classified = entry.imports.map((imp) => {
        if (RELATIVE_IMPORT_RE.test(imp)) {
          return "relative";
        }
        if (SCOPED_IMPORT_RE.test(imp)) {
          return "scoped";
        }
        return "external";
      });

      let lastExternalIdx = -1;
      let firstRelativeIdx = classified.length;

      for (let i = 0; i < classified.length; i++) {
        if (classified[i] === "external" || classified[i] === "scoped") {
          lastExternalIdx = i;
        }
        if (classified[i] === "relative" && i < firstRelativeIdx) {
          firstRelativeIdx = i;
        }
      }

      if (lastExternalIdx < firstRelativeIdx) {
        externalFirstCount++;
      }
    }

    if (analyzedCount >= 3) {
      const ratio = externalFirstCount / analyzedCount;
      if (ratio >= 0.6) {
        conventions.push({
          type: "import_ordering",
          pattern: "External/package imports before relative imports",
          confidence: ratio,
          examples: [
            'import { X } from "package" // external first',
            'import { Y } from "./local" // relative after',
          ],
        });
      }
    }

    logger.debug(
      { conventionCount: conventions.length, analyzedFiles: analyzedCount },
      "Import patterns detected"
    );

    return conventions;
  }

  /**
   * Detect error handling conventions.
   */
  detectErrorHandling(errorPatterns: string[]): DetectedConvention[] {
    const conventions: DetectedConvention[] = [];

    let tryCatchCount = 0;
    let instanceofCount = 0;
    let customErrorCount = 0;
    let resultTypeCount = 0;

    for (const content of errorPatterns) {
      if (TRY_CATCH_RE.test(content)) {
        tryCatchCount++;
      }
      if (INSTANCEOF_ERROR_RE.test(content)) {
        instanceofCount++;
      }
      if (CUSTOM_ERROR_RE.test(content)) {
        customErrorCount++;
      }
      if (RESULT_TYPE_RE.test(content)) {
        resultTypeCount++;
      }
    }

    const total = errorPatterns.length;

    if (instanceofCount >= 3 && tryCatchCount > 0) {
      conventions.push({
        type: "error_handling",
        pattern: "instanceof Error type guards in catch blocks",
        confidence: Math.min(1, instanceofCount / tryCatchCount),
        examples: ["catch (err) { if (err instanceof Error) { ... } }"],
      });
    }

    if (customErrorCount >= 2) {
      conventions.push({
        type: "error_handling",
        pattern: "Custom Error subclasses for domain errors",
        confidence: Math.min(1, customErrorCount / Math.max(total * 0.1, 1)),
        examples: ["class NotFoundError extends Error { ... }"],
      });
    }

    if (resultTypeCount >= 3) {
      conventions.push({
        type: "error_handling",
        pattern: "Result/Either types for error handling",
        confidence: Math.min(1, resultTypeCount / total),
        examples: ["Result<T, E>", "Either<L, R>"],
      });
    }

    logger.debug(
      { conventionCount: conventions.length },
      "Error handling conventions detected"
    );

    return conventions;
  }
}

/**
 * Detect the dominant naming pattern in a set of identifiers.
 */
function detectNamingPattern(
  names: string[],
  category: string
): Omit<DetectedConvention, "type"> | null {
  if (names.length < 3) {
    return null;
  }

  const camelCase: string[] = [];
  const pascalCase: string[] = [];
  const snakeCase: string[] = [];
  const screamingSnake: string[] = [];
  const kebabCase: string[] = [];

  for (const name of names) {
    if (CAMEL_CASE_RE.test(name)) {
      camelCase.push(name);
    }
    if (PASCAL_CASE_RE.test(name)) {
      pascalCase.push(name);
    }
    if (SNAKE_CASE_RE.test(name)) {
      snakeCase.push(name);
    }
    if (SCREAMING_SNAKE_RE.test(name)) {
      screamingSnake.push(name);
    }
    if (KEBAB_CASE_RE.test(name)) {
      kebabCase.push(name);
    }
  }

  const entries: [string, string[]][] = [
    ["camelCase", camelCase],
    ["PascalCase", pascalCase],
    ["snake_case", snakeCase],
    ["SCREAMING_SNAKE", screamingSnake],
    ["kebab-case", kebabCase],
  ];

  entries.sort((a, b) => b[1].length - a[1].length);

  const [topStyle, topNames] = entries[0] as [string, string[]];
  if (topNames.length < 2) {
    return null;
  }

  const confidence = topNames.length / names.length;
  if (confidence < 0.4) {
    return null;
  }

  return {
    pattern: `${category} names use ${topStyle}`,
    confidence,
    examples: topNames.slice(0, 5),
  };
}
