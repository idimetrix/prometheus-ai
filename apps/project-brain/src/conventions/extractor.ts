/**
 * Convention Auto-Extractor
 *
 * Mines codebase AST for naming patterns, framework conventions,
 * git history style preferences. Stores as structured conventions in Mem0.
 *
 * Runs on initial indexing + incrementally when >10 files change.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:conventions");

const CAMEL_CASE_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9_]*$/;
const PASCAL_CASE_PATTERN = /^[A-Z][a-zA-Z0-9]*$/;

export interface Convention {
  category: ConventionCategory;
  confidence: number;
  description: string;
  examples: string[];
  pattern: string;
}

export type ConventionCategory =
  | "naming"
  | "file_structure"
  | "imports"
  | "error_handling"
  | "testing"
  | "api_patterns"
  | "state_management"
  | "styling";

interface FileAnalysis {
  content: string;
  exports: string[];
  filePath: string;
  imports: string[];
  language: string;
}

export class ConventionExtractor {
  extract(files: FileAnalysis[]): Convention[] {
    const conventions: Convention[] = [];

    conventions.push(...this.extractNamingConventions(files));
    conventions.push(...this.extractImportPatterns(files));
    conventions.push(...this.extractFileStructure(files));
    conventions.push(...this.extractErrorHandling(files));
    conventions.push(...this.extractAPIPatterns(files));

    // Deduplicate by pattern
    const seen = new Set<string>();
    const unique = conventions.filter((c) => {
      if (seen.has(c.pattern)) {
        return false;
      }
      seen.add(c.pattern);
      return true;
    });

    logger.info(
      { totalConventions: unique.length, fileCount: files.length },
      "Conventions extracted"
    );

    return unique;
  }

  private extractNamingConventions(files: FileAnalysis[]): Convention[] {
    const conventions: Convention[] = [];
    const tsFiles = files.filter((f) => f.language === "typescript");

    // Check for camelCase vs snake_case in exports
    let camelCount = 0;
    let snakeCount = 0;
    const allExports: string[] = [];

    for (const file of tsFiles) {
      for (const exp of file.exports) {
        allExports.push(exp);
        if (CAMEL_CASE_PATTERN.test(exp)) {
          camelCount++;
        } else if (SNAKE_CASE_PATTERN.test(exp)) {
          snakeCount++;
        }
      }
    }

    if (camelCount > snakeCount && camelCount > 5) {
      conventions.push({
        category: "naming",
        pattern: "camelCase for function/variable names",
        description: "Functions and variables use camelCase naming",
        confidence: camelCount / (camelCount + snakeCount),
        examples: allExports
          .filter((e) => CAMEL_CASE_PATTERN.test(e))
          .slice(0, 3),
      });
    }

    // Check for PascalCase components
    const pascalExports = allExports.filter((e) => PASCAL_CASE_PATTERN.test(e));
    if (pascalExports.length > 3) {
      conventions.push({
        category: "naming",
        pattern: "PascalCase for classes/components/types",
        description: "Classes, React components, and types use PascalCase",
        confidence: 0.9,
        examples: pascalExports.slice(0, 3),
      });
    }

    return conventions;
  }

  private extractImportPatterns(files: FileAnalysis[]): Convention[] {
    const conventions: Convention[] = [];

    // Check for @prometheus/* workspace imports
    let workspaceImportCount = 0;
    let _relativeImportCount = 0;

    for (const file of files) {
      for (const imp of file.imports) {
        if (imp.startsWith("@prometheus/")) {
          workspaceImportCount++;
        } else if (imp.startsWith(".")) {
          _relativeImportCount++;
        }
      }
    }

    if (workspaceImportCount > 10) {
      conventions.push({
        category: "imports",
        pattern: "@prometheus/* workspace imports for shared packages",
        description:
          "Use @prometheus/* workspace imports for shared packages instead of relative paths",
        confidence: 0.95,
        examples: ["@prometheus/db", "@prometheus/logger", "@prometheus/utils"],
      });
    }

    return conventions;
  }

  private extractFileStructure(files: FileAnalysis[]): Convention[] {
    const conventions: Convention[] = [];

    // Check for index.ts barrel files
    const indexFiles = files.filter((f) => f.filePath.endsWith("/index.ts"));
    if (indexFiles.length > 5) {
      conventions.push({
        category: "file_structure",
        pattern: "index.ts barrel exports in packages",
        description: "Each package uses index.ts for public API exports",
        confidence: 0.85,
        examples: indexFiles.map((f) => f.filePath).slice(0, 3),
      });
    }

    return conventions;
  }

  private extractErrorHandling(files: FileAnalysis[]): Convention[] {
    const conventions: Convention[] = [];

    let _trycatchCount = 0;
    let loggerErrorCount = 0;

    for (const file of files) {
      const matches = file.content.match(/try\s*\{/g);
      if (matches) {
        _trycatchCount += matches.length;
      }
      const loggerMatches = file.content.match(/logger\.(error|warn)/g);
      if (loggerMatches) {
        loggerErrorCount += loggerMatches.length;
      }
    }

    if (loggerErrorCount > 10) {
      conventions.push({
        category: "error_handling",
        pattern: "Structured logging with @prometheus/logger",
        description:
          "Use createLogger() from @prometheus/logger for structured error logging",
        confidence: 0.9,
        examples: ['logger.error({ err }, "Operation failed")'],
      });
    }

    return conventions;
  }

  private extractAPIPatterns(files: FileAnalysis[]): Convention[] {
    const conventions: Convention[] = [];

    let trpcRouterCount = 0;
    let honoRouteCount = 0;

    for (const file of files) {
      if (file.content.includes("createTRPCRouter")) {
        trpcRouterCount++;
      }
      if (file.content.includes("new Hono()")) {
        honoRouteCount++;
      }
    }

    if (trpcRouterCount > 3) {
      conventions.push({
        category: "api_patterns",
        pattern: "tRPC routers for type-safe API endpoints",
        description: "Use tRPC routers with Zod validation for API endpoints",
        confidence: 0.95,
        examples: ["createTRPCRouter", "protectedProcedure", "z.object()"],
      });
    }

    if (honoRouteCount > 3) {
      conventions.push({
        category: "api_patterns",
        pattern: "Hono for HTTP framework",
        description: "Use Hono as the HTTP framework with middleware chaining",
        confidence: 0.95,
        examples: ["new Hono()", 'app.get("/health")', "serve()"],
      });
    }

    return conventions;
  }
}
