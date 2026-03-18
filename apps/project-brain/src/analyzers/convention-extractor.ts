/**
 * Phase 9.6: Convention Extraction.
 *
 * Analyzes a codebase for patterns and extracts conventions:
 *  - Naming conventions (camelCase, PascalCase, kebab-case for files)
 *  - File structure patterns (feature folders, barrel exports)
 *  - Import style (relative vs absolute, type-only imports)
 *  - Code patterns (error handling, logging, ID generation)
 *
 * Stores extracted conventions in conversational memory for injection
 * into agent system prompts.
 */
import { createLogger } from "@prometheus/logger";
import type { ConversationalMemoryLayer } from "../memory/conversational";
import type { SymbolStore } from "../parsers/symbols";

const logger = createLogger("project-brain:convention-extractor");

export interface ExtractedConvention {
  category: ConventionCategory;
  confidence: number; // 0-1, how confident we are this is an actual convention
  description: string;
  examples: string[];
  fileCount: number; // How many files exhibit this pattern
  pattern: string;
}

export type ConventionCategory =
  | "naming"
  | "file_structure"
  | "import_style"
  | "error_handling"
  | "logging"
  | "testing"
  | "type_usage"
  | "export_style"
  | "code_pattern";

export interface ConventionExtractionResult {
  conventions: ExtractedConvention[];
  timestamp: string;
  totalFilesAnalyzed: number;
}

/**
 * ConventionExtractor analyzes source files and symbol tables to
 * identify recurring patterns that constitute project conventions.
 */
export class ConventionExtractor {
  constructor(
    readonly _symbolStore: SymbolStore,
    private readonly conversationalMemory: ConversationalMemoryLayer
  ) {}

  /**
   * Analyze a set of files and extract conventions.
   */
  async extractFromFiles(
    projectId: string,
    files: Array<{ path: string; content: string }>
  ): Promise<ConventionExtractionResult> {
    const conventions: ExtractedConvention[] = [];

    // Naming conventions
    conventions.push(...this.analyzeNamingConventions(files));

    // File structure
    conventions.push(...this.analyzeFileStructure(files));

    // Import style
    conventions.push(...this.analyzeImportStyle(files));

    // Error handling patterns
    conventions.push(...this.analyzeErrorHandling(files));

    // Logging patterns
    conventions.push(...this.analyzeLoggingPatterns(files));

    // Export patterns
    conventions.push(...this.analyzeExportPatterns(files));

    // Type usage patterns
    conventions.push(...this.analyzeTypeUsage(files));

    // Testing patterns
    conventions.push(...this.analyzeTestingPatterns(files));

    // Filter to only high-confidence conventions
    const filtered = conventions.filter((c) => c.confidence >= 0.6);

    // Store in conversational memory
    for (const conv of filtered) {
      await this.conversationalMemory.store(projectId, {
        content: `Convention: ${conv.description} (${conv.category}). Examples: ${conv.examples.slice(0, 3).join(", ")}`,
        category: "convention",
        importance: conv.confidence,
        tags: ["convention", conv.category, "auto-extracted"],
      });
    }

    logger.info(
      {
        projectId,
        totalFiles: files.length,
        conventionsFound: filtered.length,
        categories: [...new Set(filtered.map((c) => c.category))],
      },
      "Convention extraction complete"
    );

    return {
      conventions: filtered,
      totalFilesAnalyzed: files.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate a convention summary suitable for injection into agent system prompts.
   */
  async getConventionPrompt(projectId: string): Promise<string> {
    const memories = await this.conversationalMemory.getAll(
      projectId,
      "convention"
    );

    if (memories.length === 0) {
      return "";
    }

    const parts: string[] = [
      "## Project Conventions (auto-detected)",
      "Follow these conventions when writing code:",
      "",
    ];

    // Group by tags
    const grouped = new Map<string, string[]>();
    for (const mem of memories) {
      const category =
        mem.tags.find((t) => t !== "convention" && t !== "auto-extracted") ??
        "general";
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)?.push(mem.content);
    }

    for (const [category, items] of grouped) {
      parts.push(
        `### ${category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`
      );
      for (const item of items.slice(0, 5)) {
        // Limit per category
        parts.push(`- ${item}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }

  // ─── Analysis Methods ────────────────────────────────────────────

  private analyzeNamingConventions(
    files: Array<{ path: string; content: string }>
  ): ExtractedConvention[] {
    const conventions: ExtractedConvention[] = [];

    // File naming patterns
    const fileNames = files.map((f) => f.path.split("/").pop() ?? "");
    const kebabFiles = fileNames.filter((n) =>
      /^[a-z][a-z0-9]*(-[a-z0-9]+)+\.\w+$/.test(n)
    );
    const camelFiles = fileNames.filter((n) =>
      /^[a-z][a-zA-Z0-9]+\.\w+$/.test(n)
    );
    const _pascalFiles = fileNames.filter((n) =>
      /^[A-Z][a-zA-Z0-9]+\.\w+$/.test(n)
    );

    if (kebabFiles.length > files.length * 0.5) {
      conventions.push({
        category: "naming",
        pattern: "kebab-case-files",
        description: "Files use kebab-case naming (e.g., file-name.ts)",
        confidence: kebabFiles.length / fileNames.length,
        examples: kebabFiles.slice(0, 5),
        fileCount: kebabFiles.length,
      });
    }

    if (camelFiles.length > files.length * 0.3) {
      conventions.push({
        category: "naming",
        pattern: "camelCase-files",
        description: "Files use camelCase naming (e.g., fileName.ts)",
        confidence: camelFiles.length / fileNames.length,
        examples: camelFiles.slice(0, 5),
        fileCount: camelFiles.length,
      });
    }

    // Variable naming
    const codeFiles = files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f.path));
    let camelVarCount = 0;
    let snakeVarCount = 0;

    for (const file of codeFiles) {
      const camelMatches = file.content.match(
        /(?:const|let|var)\s+([a-z][a-zA-Z0-9]+)\b/g
      );
      const snakeMatches = file.content.match(
        /(?:const|let|var)\s+([a-z]+_[a-z_]+)\b/g
      );
      camelVarCount += camelMatches?.length ?? 0;
      snakeVarCount += snakeMatches?.length ?? 0;
    }

    const totalVars = camelVarCount + snakeVarCount;
    if (totalVars > 10 && camelVarCount / totalVars > 0.8) {
      conventions.push({
        category: "naming",
        pattern: "camelCase-variables",
        description: "Variables use camelCase naming",
        confidence: camelVarCount / totalVars,
        examples: ["const myVariable", "let isActive", "const itemCount"],
        fileCount: codeFiles.length,
      });
    }

    // Interface naming (I-prefix vs no prefix)
    let iPrefixCount = 0;
    let noPrefixCount = 0;
    for (const file of codeFiles) {
      const iInterfaces = file.content.match(/interface\s+I[A-Z]\w+/g);
      const plainInterfaces = file.content.match(/interface\s+(?!I[A-Z])\w+/g);
      iPrefixCount += iInterfaces?.length ?? 0;
      noPrefixCount += plainInterfaces?.length ?? 0;
    }

    const totalInterfaces = iPrefixCount + noPrefixCount;
    if (totalInterfaces > 3 && noPrefixCount / totalInterfaces > 0.7) {
      conventions.push({
        category: "naming",
        pattern: "no-interface-prefix",
        description:
          "Interfaces do NOT use 'I' prefix (e.g., UserProfile, not IUserProfile)",
        confidence: noPrefixCount / totalInterfaces,
        examples: [],
        fileCount: codeFiles.length,
      });
    }

    return conventions;
  }

  private analyzeFileStructure(
    files: Array<{ path: string; content: string }>
  ): ExtractedConvention[] {
    const conventions: ExtractedConvention[] = [];

    // Barrel exports (index.ts files that re-export)
    const indexFiles = files.filter(
      (f) => f.path.endsWith("/index.ts") || f.path.endsWith("/index.js")
    );
    const barrelFiles = indexFiles.filter(
      (f) =>
        /^export\s+/m.test(f.content) &&
        (f.content.match(/export/g)?.length ?? 0) > 1
    );

    if (barrelFiles.length > 2) {
      conventions.push({
        category: "file_structure",
        pattern: "barrel-exports",
        description:
          "Uses barrel exports (index.ts) to re-export from directories",
        confidence: Math.min(
          barrelFiles.length / Math.max(indexFiles.length, 1),
          1
        ),
        examples: barrelFiles.slice(0, 3).map((f) => f.path),
        fileCount: barrelFiles.length,
      });
    }

    // Co-located tests
    const testFiles = files.filter((f) =>
      /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f.path)
    );
    const colocatedTests = testFiles.filter((f) => {
      const dir = f.path.split("/").slice(0, -1).join("/");
      return (
        dir.includes("__tests__") ||
        files.some((src) => {
          const srcDir = src.path.split("/").slice(0, -1).join("/");
          return (
            srcDir === dir &&
            !src.path.includes("test") &&
            !src.path.includes("spec")
          );
        })
      );
    });

    if (colocatedTests.length > 2) {
      conventions.push({
        category: "file_structure",
        pattern: "colocated-tests",
        description:
          "Tests are co-located with source files (same directory or __tests__ subdirectory)",
        confidence: colocatedTests.length / Math.max(testFiles.length, 1),
        examples: colocatedTests.slice(0, 3).map((f) => f.path),
        fileCount: colocatedTests.length,
      });
    }

    return conventions;
  }

  private analyzeImportStyle(
    files: Array<{ path: string; content: string }>
  ): ExtractedConvention[] {
    const conventions: ExtractedConvention[] = [];
    const codeFiles = files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f.path));

    let _relativeImports = 0;
    let _absoluteImports = 0;
    let typeOnlyImports = 0;
    let totalImports = 0;
    let aliasImports = 0;

    for (const file of codeFiles) {
      const importLines =
        file.content.match(/import\s+.*?\s+from\s+["'](.+?)["']/g) ?? [];
      totalImports += importLines.length;

      for (const line of importLines) {
        const source = line.match(/from\s+["'](.+?)["']/)?.[1] ?? "";
        if (source.startsWith(".") || source.startsWith("..")) {
          _relativeImports++;
        } else if (source.startsWith("@") || source.startsWith("~")) {
          aliasImports++;
        } else {
          _absoluteImports++;
        }
      }

      const typeImports = file.content.match(/import\s+type\s+/g);
      typeOnlyImports += typeImports?.length ?? 0;
    }

    if (totalImports > 20) {
      // Path alias usage
      if (aliasImports / totalImports > 0.2) {
        conventions.push({
          category: "import_style",
          pattern: "path-aliases",
          description:
            "Uses path aliases (@ or ~) for imports instead of deep relative paths",
          confidence: aliasImports / totalImports,
          examples: [
            "import { X } from '@prometheus/db'",
            "import { Y } from '@/utils'",
          ],
          fileCount: codeFiles.length,
        });
      }

      // Type-only imports
      if (typeOnlyImports / totalImports > 0.1) {
        conventions.push({
          category: "import_style",
          pattern: "type-only-imports",
          description: "Uses 'import type' for type-only imports",
          confidence: Math.min(typeOnlyImports / (totalImports * 0.3), 1),
          examples: ["import type { User } from './types'"],
          fileCount: codeFiles.length,
        });
      }
    }

    return conventions;
  }

  private analyzeErrorHandling(
    files: Array<{ path: string; content: string }>
  ): ExtractedConvention[] {
    const conventions: ExtractedConvention[] = [];
    const codeFiles = files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f.path));

    let tryCatchCount = 0;
    let instanceofErrorCount = 0;
    let customErrorCount = 0;
    const errorFiles: string[] = [];

    for (const file of codeFiles) {
      const tryCatches = file.content.match(/try\s*\{/g);
      if (tryCatches) {
        tryCatchCount += tryCatches.length;
        errorFiles.push(file.path);
      }

      if (/instanceof\s+Error/.test(file.content)) {
        instanceofErrorCount++;
      }

      if (/extends\s+Error/.test(file.content)) {
        customErrorCount++;
      }
    }

    if (instanceofErrorCount > 3) {
      conventions.push({
        category: "error_handling",
        pattern: "instanceof-error-check",
        description:
          "Uses 'instanceof Error' pattern for error type checking in catch blocks",
        confidence: instanceofErrorCount / Math.max(tryCatchCount, 1),
        examples: [
          "const msg = error instanceof Error ? error.message : String(error)",
        ],
        fileCount: errorFiles.length,
      });
    }

    if (customErrorCount > 1) {
      conventions.push({
        category: "error_handling",
        pattern: "custom-error-classes",
        description: "Uses custom Error classes for domain-specific errors",
        confidence: Math.min(customErrorCount / 5, 1),
        examples: [],
        fileCount: customErrorCount,
      });
    }

    return conventions;
  }

  private analyzeLoggingPatterns(
    files: Array<{ path: string; content: string }>
  ): ExtractedConvention[] {
    const conventions: ExtractedConvention[] = [];
    const codeFiles = files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f.path));

    let structuredLoggerCount = 0;
    let consoleLogCount = 0;
    const loggerFiles: string[] = [];

    for (const file of codeFiles) {
      if (/createLogger|getLogger|pino|winston|bunyan/.test(file.content)) {
        structuredLoggerCount++;
        loggerFiles.push(file.path);
      }
      if (/console\.(log|warn|error|info)\s*\(/.test(file.content)) {
        consoleLogCount++;
      }
    }

    if (structuredLoggerCount > 3 && structuredLoggerCount > consoleLogCount) {
      conventions.push({
        category: "logging",
        pattern: "structured-logger",
        description:
          "Uses structured logger (createLogger) instead of console.log",
        confidence:
          structuredLoggerCount / (structuredLoggerCount + consoleLogCount),
        examples: ['const logger = createLogger("service-name")'],
        fileCount: loggerFiles.length,
      });
    }

    return conventions;
  }

  private analyzeExportPatterns(
    files: Array<{ path: string; content: string }>
  ): ExtractedConvention[] {
    const conventions: ExtractedConvention[] = [];
    const codeFiles = files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f.path));

    let namedExportCount = 0;
    let defaultExportCount = 0;

    for (const file of codeFiles) {
      const namedExports = file.content.match(
        /export\s+(?:const|function|class|interface|type|enum)\s/g
      );
      const defaultExports = file.content.match(/export\s+default\s/g);
      namedExportCount += namedExports?.length ?? 0;
      defaultExportCount += defaultExports?.length ?? 0;
    }

    const totalExports = namedExportCount + defaultExportCount;
    if (totalExports > 10 && namedExportCount / totalExports > 0.8) {
      conventions.push({
        category: "export_style",
        pattern: "named-exports",
        description: "Prefer named exports over default exports",
        confidence: namedExportCount / totalExports,
        examples: [
          "export function foo()",
          "export class Bar",
          "export const config",
        ],
        fileCount: codeFiles.length,
      });
    }

    return conventions;
  }

  private analyzeTypeUsage(
    files: Array<{ path: string; content: string }>
  ): ExtractedConvention[] {
    const conventions: ExtractedConvention[] = [];
    const tsFiles = files.filter((f) => /\.(ts|tsx)$/.test(f.path));

    let zodSchemaCount = 0;
    let interfaceCount = 0;
    let typeAliasCount = 0;

    for (const file of tsFiles) {
      const zodSchemas = file.content.match(/z\.\w+\(/g);
      zodSchemaCount += zodSchemas?.length ?? 0;

      const interfaces = file.content.match(/\binterface\s+\w+/g);
      interfaceCount += interfaces?.length ?? 0;

      const typeAliases = file.content.match(/\btype\s+\w+\s*=/g);
      typeAliasCount += typeAliases?.length ?? 0;
    }

    if (zodSchemaCount > 5) {
      conventions.push({
        category: "type_usage",
        pattern: "zod-validation",
        description: "Uses Zod schemas for runtime validation",
        confidence: Math.min(zodSchemaCount / 20, 1),
        examples: ["const schema = z.object({ ... })"],
        fileCount: tsFiles.length,
      });
    }

    if (interfaceCount > typeAliasCount * 2 && interfaceCount > 10) {
      conventions.push({
        category: "type_usage",
        pattern: "prefer-interfaces",
        description: "Prefers interfaces over type aliases for object shapes",
        confidence: interfaceCount / (interfaceCount + typeAliasCount),
        examples: ["interface User { ... }"],
        fileCount: tsFiles.length,
      });
    }

    return conventions;
  }

  private analyzeTestingPatterns(
    files: Array<{ path: string; content: string }>
  ): ExtractedConvention[] {
    const conventions: ExtractedConvention[] = [];
    const testFiles = files.filter((f) =>
      /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f.path)
    );

    if (testFiles.length === 0) {
      return conventions;
    }

    let vitestCount = 0;
    let jestCount = 0;
    let describeItCount = 0;
    let testFnCount = 0;

    for (const file of testFiles) {
      if (/from\s+['"]vitest['"]/.test(file.content)) {
        vitestCount++;
      }
      if (/from\s+['"]@jest['"]|jest\.fn/.test(file.content)) {
        jestCount++;
      }

      const describes = file.content.match(/describe\s*\(/g);
      const its = file.content.match(/\bit\s*\(/g);
      const tests = file.content.match(/\btest\s*\(/g);
      describeItCount += (describes?.length ?? 0) + (its?.length ?? 0);
      testFnCount += tests?.length ?? 0;
    }

    if (vitestCount > jestCount && vitestCount > 2) {
      conventions.push({
        category: "testing",
        pattern: "vitest",
        description: "Uses Vitest as the test runner",
        confidence: vitestCount / testFiles.length,
        examples: ['import { describe, it, expect } from "vitest"'],
        fileCount: vitestCount,
      });
    }

    if (describeItCount > testFnCount && describeItCount > 5) {
      conventions.push({
        category: "testing",
        pattern: "describe-it-style",
        description: "Uses describe/it style for test organization",
        confidence: describeItCount / (describeItCount + testFnCount),
        examples: [
          'describe("Feature", () => { it("should...", () => { ... }) })',
        ],
        fileCount: testFiles.length,
      });
    }

    return conventions;
  }
}
