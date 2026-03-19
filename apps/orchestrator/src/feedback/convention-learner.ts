/**
 * ConventionLearner: Analyzes a project's codebase to extract coding
 * conventions (naming, imports, structure, patterns, style) using regex
 * heuristics. The learned conventions are formatted into agent prompts
 * so generated code matches the project's existing style.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:convention-learner");

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface Convention {
  confidence: number;
  examples: string[];
  rule: string;
  source: string;
  type: "naming" | "structure" | "pattern" | "import" | "style";
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface FileAnalysis {
  exportStyle: "named" | "default" | "mixed";
  importStyle: "relative" | "alias" | "mixed";
  indentation: "tabs" | "2-spaces" | "4-spaces";
  namingStyle:
    | "camelCase"
    | "kebab-case"
    | "PascalCase"
    | "snake_case"
    | "mixed";
  path: string;
  quotes: "single" | "double" | "mixed";
  semicolons: boolean;
  trailingCommas: boolean;
  usesBarrelFiles: boolean;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const PATTERNS = {
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  kebabCase: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
  pascalCase: /^[A-Z][a-zA-Z0-9]*$/,
  snakeCase: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,

  namedExport: /export\s+(?:const|function|class|type|interface|enum)\s+/g,
  defaultExport: /export\s+default\s+/g,
  barrelExport: /export\s+\{[^}]*\}\s+from\s+/g,
  barrelReExport: /export\s+\*\s+from\s+/g,

  relativeImport: /from\s+["']\.\.?\//g,
  aliasImport: /from\s+["']@\//g,
  packageImport: /from\s+["'][a-z@][^"']*["']/g,

  arrowFunction:
    /(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*\w+(?:<[^>]+>)?)?\s*=>/g,
  regularFunction: /function\s+\w+\s*\(/g,

  reactFC: /React\.FC|React\.FunctionComponent/g,
  explicitProps: /:\s*\w+Props\b/g,

  semicolon: /;\s*$/gm,
  noSemicolon: /[^;{}\s]\s*$/gm,
  singleQuote: /from\s+'[^']+'/g,
  doubleQuote: /from\s+"[^"]+"/g,
  trailingComma: /,\s*[}\])]/g,
  noTrailingComma: /[^,\s]\s*[}\])]/g,

  tabIndent: /^\t+/gm,
  twoSpaceIndent: /^ {2}(?! )/gm,
  fourSpaceIndent: /^ {4}(?! )/gm,
} as const;

// ---------------------------------------------------------------------------
// Top-level regex patterns used inside class methods
// ---------------------------------------------------------------------------

const FILE_EXTENSION_RE = /\.[^.]+$/;
const VARIABLE_DECLARATION_RE =
  /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*[=:]/g;
const SCREAMING_SNAKE_RE = /^[A-Z][A-Z0-9_]+$/;
const USE_CALLBACK_RE = /useCallback\(/g;
const USE_MEMO_RE = /useMemo\(/g;

// ---------------------------------------------------------------------------
// Ternary replacement helpers
// ---------------------------------------------------------------------------

function getExportRule(winner: string): string {
  if (winner === "named") {
    return "Prefer named exports over default exports";
  }
  if (winner === "default") {
    return "Use default exports for main module exports";
  }
  return "Mixed export style: use named exports for utilities, default for components";
}

function getImportRule(winner: string): string {
  if (winner === "alias") {
    return "Use path aliases (@/) for imports instead of relative paths";
  }
  if (winner === "relative") {
    return "Use relative imports for local module references";
  }
  return "Mixed import style: aliases for cross-boundary, relative for same-directory";
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) {
    return "strong";
  }
  if (confidence >= 0.6) {
    return "moderate";
  }
  return "weak";
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function countMatches(content: string, pattern: RegExp): number {
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

function detectFileNamingStyle(fileName: string): FileAnalysis["namingStyle"] {
  // Strip extension
  const name = fileName.replace(FILE_EXTENSION_RE, "");

  if (PATTERNS.kebabCase.test(name)) {
    return "kebab-case";
  }
  if (PATTERNS.pascalCase.test(name)) {
    return "PascalCase";
  }
  if (PATTERNS.camelCase.test(name)) {
    return "camelCase";
  }
  if (PATTERNS.snakeCase.test(name)) {
    return "snake_case";
  }
  return "mixed";
}

function detectExportStyle(content: string): FileAnalysis["exportStyle"] {
  const named = countMatches(content, PATTERNS.namedExport);
  const defaultExport = countMatches(content, PATTERNS.defaultExport);

  if (named > 0 && defaultExport === 0) {
    return "named";
  }
  if (defaultExport > 0 && named === 0) {
    return "default";
  }
  return "mixed";
}

function detectImportStyle(content: string): FileAnalysis["importStyle"] {
  const relative = countMatches(content, PATTERNS.relativeImport);
  const alias = countMatches(content, PATTERNS.aliasImport);

  if (alias > relative * 2) {
    return "alias";
  }
  if (relative > alias * 2) {
    return "relative";
  }
  return "mixed";
}

function detectIndentation(content: string): FileAnalysis["indentation"] {
  const tabs = countMatches(content, PATTERNS.tabIndent);
  const twoSpaces = countMatches(content, PATTERNS.twoSpaceIndent);
  const fourSpaces = countMatches(content, PATTERNS.fourSpaceIndent);

  if (tabs > twoSpaces && tabs > fourSpaces) {
    return "tabs";
  }
  if (fourSpaces > twoSpaces) {
    return "4-spaces";
  }
  return "2-spaces";
}

function detectSemicolons(content: string): boolean {
  const semi = countMatches(content, PATTERNS.semicolon);
  const noSemi = countMatches(content, PATTERNS.noSemicolon);
  return semi > noSemi;
}

function detectQuotes(content: string): FileAnalysis["quotes"] {
  const single = countMatches(content, PATTERNS.singleQuote);
  const double = countMatches(content, PATTERNS.doubleQuote);

  if (single > double * 2) {
    return "single";
  }
  if (double > single * 2) {
    return "double";
  }
  return "mixed";
}

function detectTrailingCommas(content: string): boolean {
  const trailing = countMatches(content, PATTERNS.trailingComma);
  const noTrailing = countMatches(content, PATTERNS.noTrailingComma);
  return trailing > noTrailing * 0.3;
}

function analyzeFile(path: string, content: string): FileAnalysis {
  const fileName = path.split("/").pop() ?? path;
  const barrel =
    countMatches(content, PATTERNS.barrelExport) +
    countMatches(content, PATTERNS.barrelReExport);

  return {
    path,
    namingStyle: detectFileNamingStyle(fileName),
    exportStyle: detectExportStyle(content),
    importStyle: detectImportStyle(content),
    usesBarrelFiles: barrel > 0 && fileName.startsWith("index"),
    indentation: detectIndentation(content),
    semicolons: detectSemicolons(content),
    trailingCommas: detectTrailingCommas(content),
    quotes: detectQuotes(content),
  };
}

function majorityVote<T>(
  values: T[]
): { winner: T; count: number; total: number } | null {
  if (values.length === 0) {
    return null;
  }

  const counts = new Map<T, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  let winner = values[0] as T;
  let maxCount = 0;
  for (const [key, count] of counts) {
    if (count > maxCount) {
      winner = key;
      maxCount = count;
    }
  }

  return { winner, count: maxCount, total: values.length };
}

// ---------------------------------------------------------------------------
// ConventionLearner class
// ---------------------------------------------------------------------------

export class ConventionLearner {
  /**
   * Analyze all project files and extract coding conventions.
   */
  learnFromProject(
    projectId: string,
    files: Array<{ path: string; content: string }>
  ): Convention[] {
    logger.info(
      { projectId, fileCount: files.length },
      "Learning conventions from project"
    );

    // Filter to source files only
    const sourceFiles = files.filter(
      (f) =>
        (f.path.endsWith(".ts") ||
          f.path.endsWith(".tsx") ||
          f.path.endsWith(".js") ||
          f.path.endsWith(".jsx")) &&
        !f.path.includes("node_modules") &&
        !f.path.includes(".d.ts") &&
        f.content.length > 50
    );

    if (sourceFiles.length === 0) {
      logger.warn(
        { projectId },
        "No source files found for convention analysis"
      );
      return [];
    }

    const analyses = sourceFiles.map((f) => analyzeFile(f.path, f.content));
    const conventions: Convention[] = [];

    // Naming conventions
    const namingVote = majorityVote(analyses.map((a) => a.namingStyle));
    if (namingVote && namingVote.count > namingVote.total * 0.5) {
      conventions.push({
        type: "naming",
        rule: `Use ${namingVote.winner} for file names`,
        confidence: namingVote.count / namingVote.total,
        examples: analyses
          .filter((a) => a.namingStyle === namingVote.winner)
          .slice(0, 5)
          .map((a) => a.path.split("/").pop() ?? a.path),
        source: `Detected from ${namingVote.count}/${namingVote.total} files`,
      });
    }

    // Variable naming from content
    const variableConventions = this.analyzeVariableNaming(sourceFiles);
    conventions.push(...variableConventions);

    // Export style
    const exportVote = majorityVote(analyses.map((a) => a.exportStyle));
    if (exportVote && exportVote.count > exportVote.total * 0.4) {
      conventions.push({
        type: "pattern",
        rule: getExportRule(exportVote.winner),
        confidence: exportVote.count / exportVote.total,
        examples: analyses
          .filter((a) => a.exportStyle === exportVote.winner)
          .slice(0, 3)
          .map((a) => a.path),
        source: `Detected from ${exportVote.count}/${exportVote.total} files`,
      });
    }

    // Import style
    const importVote = majorityVote(analyses.map((a) => a.importStyle));
    if (importVote && importVote.count > importVote.total * 0.4) {
      conventions.push({
        type: "import",
        rule: getImportRule(importVote.winner),
        confidence: importVote.count / importVote.total,
        examples: analyses
          .filter((a) => a.importStyle === importVote.winner)
          .slice(0, 3)
          .map((a) => a.path),
        source: `Detected from ${importVote.count}/${importVote.total} files`,
      });
    }

    // Barrel files
    const barrelCount = analyses.filter((a) => a.usesBarrelFiles).length;
    const indexFiles = analyses.filter((a) =>
      (a.path.split("/").pop() ?? "").startsWith("index")
    ).length;
    if (indexFiles > 0) {
      const usesBarrels = barrelCount > indexFiles * 0.5;
      conventions.push({
        type: "structure",
        rule: usesBarrels
          ? "Use barrel files (index.ts) to re-export from directories"
          : "Avoid barrel files; import directly from source modules",
        confidence: usesBarrels
          ? barrelCount / indexFiles
          : 1 - barrelCount / Math.max(indexFiles, 1),
        examples: analyses
          .filter((a) => a.usesBarrelFiles === usesBarrels)
          .slice(0, 3)
          .map((a) => a.path),
        source: `Detected ${barrelCount} barrel files out of ${indexFiles} index files`,
      });
    }

    // Indentation
    const indentVote = majorityVote(analyses.map((a) => a.indentation));
    if (indentVote) {
      conventions.push({
        type: "style",
        rule: `Use ${indentVote.winner} for indentation`,
        confidence: indentVote.count / indentVote.total,
        examples: [],
        source: `Detected from ${indentVote.count}/${indentVote.total} files`,
      });
    }

    // Semicolons
    const semiVote = majorityVote(analyses.map((a) => a.semicolons));
    if (semiVote) {
      conventions.push({
        type: "style",
        rule: semiVote.winner
          ? "Use semicolons at the end of statements"
          : "Omit semicolons (ASI style)",
        confidence: semiVote.count / semiVote.total,
        examples: [],
        source: `Detected from ${semiVote.count}/${semiVote.total} files`,
      });
    }

    // Quotes
    const quoteVote = majorityVote(analyses.map((a) => a.quotes));
    if (quoteVote && quoteVote.winner !== "mixed") {
      conventions.push({
        type: "style",
        rule: `Use ${quoteVote.winner} quotes for string literals and imports`,
        confidence: quoteVote.count / quoteVote.total,
        examples: [],
        source: `Detected from ${quoteVote.count}/${quoteVote.total} files`,
      });
    }

    // Trailing commas
    const commaVote = majorityVote(analyses.map((a) => a.trailingCommas));
    if (commaVote) {
      conventions.push({
        type: "style",
        rule: commaVote.winner
          ? "Use trailing commas in multi-line constructs"
          : "Omit trailing commas",
        confidence: commaVote.count / commaVote.total,
        examples: [],
        source: `Detected from ${commaVote.count}/${commaVote.total} files`,
      });
    }

    // Function style (arrow vs regular)
    const functionConventions = this.analyzeFunctionStyle(sourceFiles);
    conventions.push(...functionConventions);

    // React-specific conventions
    const reactConventions = this.analyzeReactPatterns(sourceFiles);
    conventions.push(...reactConventions);

    // Sort by confidence descending
    conventions.sort((a, b) => b.confidence - a.confidence);

    logger.info(
      { projectId, conventionCount: conventions.length },
      "Convention learning complete"
    );

    return conventions;
  }

  /**
   * Format learned conventions into a prompt-friendly string for agent
   * system prompts.
   */
  formatForPrompt(conventions: Convention[]): string {
    if (conventions.length === 0) {
      return "No specific coding conventions detected. Follow standard TypeScript best practices.";
    }

    // Only include high-confidence conventions
    const highConfidence = conventions.filter((c) => c.confidence >= 0.5);

    if (highConfidence.length === 0) {
      return "No strong coding conventions detected. Follow standard TypeScript best practices.";
    }

    const sections: Record<Convention["type"], Convention[]> = {
      naming: [],
      structure: [],
      pattern: [],
      import: [],
      style: [],
    };

    for (const conv of highConfidence) {
      sections[conv.type].push(conv);
    }

    const lines: string[] = ["## Project Coding Conventions", ""];

    const sectionTitles: Record<Convention["type"], string> = {
      naming: "Naming",
      structure: "Project Structure",
      pattern: "Code Patterns",
      import: "Imports",
      style: "Code Style",
    };

    for (const [type, title] of Object.entries(sectionTitles)) {
      const items = sections[type as Convention["type"]];
      if (items.length === 0) {
        continue;
      }

      lines.push(`### ${title}`);
      for (const item of items) {
        const confidenceLabel = getConfidenceLabel(item.confidence);
        lines.push(`- ${item.rule} (${confidenceLabel} convention)`);
        if (item.examples.length > 0) {
          lines.push(`  Examples: ${item.examples.slice(0, 3).join(", ")}`);
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Private analysis helpers
  // -------------------------------------------------------------------------

  private analyzeVariableNaming(
    files: Array<{ path: string; content: string }>
  ): Convention[] {
    const conventions: Convention[] = [];

    let camelCaseVars = 0;
    let snakeCaseVars = 0;
    let pascalCaseConstants = 0;
    let screamingSnakeConstants = 0;
    const examples: string[] = [];

    for (const file of files) {
      // Match variable declarations
      const varMatches = file.content.matchAll(VARIABLE_DECLARATION_RE);
      for (const m of varMatches) {
        const name = m[1];
        if (!name || name.length < 2) {
          continue;
        }

        if (PATTERNS.camelCase.test(name)) {
          camelCaseVars++;
        } else if (PATTERNS.snakeCase.test(name)) {
          snakeCaseVars++;
        }

        if (SCREAMING_SNAKE_RE.test(name)) {
          screamingSnakeConstants++;
        } else if (PATTERNS.pascalCase.test(name)) {
          pascalCaseConstants++;
        }
      }
    }

    const total = camelCaseVars + snakeCaseVars;
    if (total > 5) {
      const prefersCamel = camelCaseVars > snakeCaseVars;
      conventions.push({
        type: "naming",
        rule: prefersCamel
          ? "Use camelCase for variable and function names"
          : "Use snake_case for variable and function names",
        confidence: Math.max(camelCaseVars, snakeCaseVars) / total,
        examples,
        source: `Detected from ${total} variable declarations`,
      });
    }

    const constantTotal = pascalCaseConstants + screamingSnakeConstants;
    if (constantTotal > 3) {
      conventions.push({
        type: "naming",
        rule:
          screamingSnakeConstants > pascalCaseConstants
            ? "Use SCREAMING_SNAKE_CASE for constants"
            : "Use PascalCase for constant/enum-like values",
        confidence:
          Math.max(screamingSnakeConstants, pascalCaseConstants) /
          constantTotal,
        examples: [],
        source: `Detected from ${constantTotal} constant declarations`,
      });
    }

    return conventions;
  }

  private analyzeFunctionStyle(
    files: Array<{ path: string; content: string }>
  ): Convention[] {
    const conventions: Convention[] = [];
    let arrowCount = 0;
    let regularCount = 0;

    for (const file of files) {
      arrowCount += countMatches(file.content, PATTERNS.arrowFunction);
      regularCount += countMatches(file.content, PATTERNS.regularFunction);
    }

    const total = arrowCount + regularCount;
    if (total > 5) {
      const prefersArrow = arrowCount > regularCount;
      conventions.push({
        type: "pattern",
        rule: prefersArrow
          ? "Prefer arrow functions for function declarations and callbacks"
          : "Use function declarations for top-level functions, arrow functions for callbacks",
        confidence: Math.max(arrowCount, regularCount) / total,
        examples: [],
        source: `Detected ${arrowCount} arrow functions and ${regularCount} regular functions`,
      });
    }

    return conventions;
  }

  private analyzeReactPatterns(
    files: Array<{ path: string; content: string }>
  ): Convention[] {
    const conventions: Convention[] = [];

    const reactFiles = files.filter(
      (f) =>
        (f.path.endsWith(".tsx") || f.path.endsWith(".jsx")) &&
        (f.content.includes("React") || f.content.includes("from 'react'"))
    );

    if (reactFiles.length === 0) {
      return conventions;
    }

    let fcCount = 0;
    let explicitPropsCount = 0;

    for (const file of reactFiles) {
      fcCount += countMatches(file.content, PATTERNS.reactFC);
      explicitPropsCount += countMatches(file.content, PATTERNS.explicitProps);
    }

    if (fcCount + explicitPropsCount > 3) {
      conventions.push({
        type: "pattern",
        rule:
          explicitPropsCount > fcCount
            ? "Use explicit prop type annotations instead of React.FC"
            : "Use React.FC for component type declarations",
        confidence:
          Math.max(fcCount, explicitPropsCount) /
          (fcCount + explicitPropsCount),
        examples: [],
        source: `Detected from ${reactFiles.length} React component files`,
      });
    }

    // Check for hooks pattern usage
    let useCallbackCount = 0;
    let useMemoCount = 0;
    for (const file of reactFiles) {
      useCallbackCount += countMatches(file.content, USE_CALLBACK_RE);
      useMemoCount += countMatches(file.content, USE_MEMO_RE);
    }

    if (useCallbackCount + useMemoCount > 5) {
      conventions.push({
        type: "pattern",
        rule: "Use useCallback and useMemo for memoization of callbacks and computed values",
        confidence: 0.7,
        examples: [],
        source: `Detected ${useCallbackCount} useCallback and ${useMemoCount} useMemo calls`,
      });
    }

    return conventions;
  }
}
