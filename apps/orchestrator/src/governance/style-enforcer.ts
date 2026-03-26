/**
 * Team Style Enforcement Engine
 *
 * Learns a team's coding style from the codebase and enforces
 * conventions automatically during code review.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:style-enforcer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StyleConvention {
  category: string;
  confidence: number;
  examples: string[];
  rule: string;
}

export interface StyleViolation {
  autoFixable: boolean;
  file: string;
  line: number;
  message: string;
  rule: string;
  suggestedFix?: string;
}

export interface StyleEnforcementResult {
  /** Overall style compliance score 0-100 */
  score: number;
  violations: StyleViolation[];
}

export interface LearnedStyle {
  conventions: StyleConvention[];
}

interface FileInput {
  content: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Constants & Patterns
// ---------------------------------------------------------------------------

const NAMING_CAMEL_RE = /\b(const|let|function)\s+([a-z][a-zA-Z0-9]*)\b/g;
const NAMING_PASCAL_RE =
  /\b(class|interface|type|enum)\s+([A-Z][a-zA-Z0-9]*)\b/g;
const NAMING_SCREAMING_RE = /\bconst\s+([A-Z][A-Z0-9_]+)\s*=/g;
const ARROW_FN_RE = /=>\s*\{/g;
const FUNCTION_KEYWORD_RE = /\bfunction\s+\w+/g;
const SINGLE_QUOTE_RE = /:\s*'[^']*'/g;
const DOUBLE_QUOTE_RE = /:\s*"[^"]*"/g;
const TRAILING_SEMICOLON_RE = /;\s*$/gm;
const NO_SEMICOLON_LINE_RE = /[^;{}\s/]\s*$/gm;
const EXPLICIT_RETURN_TYPE_RE = /\)\s*:\s*\w+/g;
const IMPORT_TYPE_RE = /import\s+type\s+/g;
const CONST_ASSERTION_RE = /\bas\s+const\b/g;
const ASYNC_AWAIT_RE = /\basync\b.*\bawait\b/gs;
const PROMISE_THEN_RE = /\.then\s*\(/g;
const OPTIONAL_CHAIN_RE = /\?\./g;
const NULLISH_COALESCE_RE = /\?\?/g;
const TEMPLATE_LITERAL_RE = /`[^`]*\$\{/g;
const STRING_CONCAT_RE = /["']\s*\+\s*\w+\s*\+\s*["']/g;

const CAMEL_CASE_VAR_RE = /\b(?:const|let)\s+([A-Z][a-z]\w*)\s*=/;
const PASCAL_CASE_TYPE_RE = /\b(?:interface|type)\s+([a-z]\w*)/;
const THEN_CHAIN_RE = /\.then\s*\(/;
const CONCAT_STRING_RE = /["']\s*\+\s*\w+\s*\+\s*["']/;

const MAX_SCORE = 100;
const VIOLATION_PENALTY = 2;

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function countMatches(content: string, pattern: RegExp): number {
  const matches = content.match(pattern);
  return matches?.length ?? 0;
}

function detectNamingConventions(content: string): StyleConvention[] {
  const conventions: StyleConvention[] = [];

  const camelCount = countMatches(content, NAMING_CAMEL_RE);
  const pascalCount = countMatches(content, NAMING_PASCAL_RE);
  const screamingCount = countMatches(content, NAMING_SCREAMING_RE);

  if (camelCount > 0) {
    conventions.push({
      category: "naming",
      rule: "camelCase for variables and functions",
      examples: ["const myVariable", "function doSomething"],
      confidence: Math.min(camelCount / 10, 1),
    });
  }

  if (pascalCount > 0) {
    conventions.push({
      category: "naming",
      rule: "PascalCase for types, interfaces, and classes",
      examples: ["interface UserProfile", "class DataManager"],
      confidence: Math.min(pascalCount / 5, 1),
    });
  }

  if (screamingCount > 0) {
    conventions.push({
      category: "naming",
      rule: "SCREAMING_SNAKE_CASE for constants",
      examples: ["const MAX_RETRIES = 3", "const API_BASE_URL"],
      confidence: Math.min(screamingCount / 5, 1),
    });
  }

  return conventions;
}

function detectFunctionStyle(content: string): StyleConvention[] {
  const conventions: StyleConvention[] = [];

  const arrowCount = countMatches(content, ARROW_FN_RE);
  const functionCount = countMatches(content, FUNCTION_KEYWORD_RE);
  const total = arrowCount + functionCount;

  if (total === 0) {
    return conventions;
  }

  const arrowRatio = arrowCount / total;

  if (arrowRatio > 0.7) {
    conventions.push({
      category: "functions",
      rule: "Prefer arrow functions",
      examples: ["const fn = () => {}", "items.map((item) => item.id)"],
      confidence: arrowRatio,
    });
  } else if (arrowRatio < 0.3) {
    conventions.push({
      category: "functions",
      rule: "Prefer function declarations",
      examples: ["function processData() {}", "function handleClick() {}"],
      confidence: 1 - arrowRatio,
    });
  }

  return conventions;
}

function detectQuoteStyle(content: string): StyleConvention[] {
  const conventions: StyleConvention[] = [];

  const singleCount = countMatches(content, SINGLE_QUOTE_RE);
  const doubleCount = countMatches(content, DOUBLE_QUOTE_RE);
  const total = singleCount + doubleCount;

  if (total === 0) {
    return conventions;
  }

  if (doubleCount > singleCount) {
    conventions.push({
      category: "formatting",
      rule: "Use double quotes for strings",
      examples: ['const name = "value"'],
      confidence: doubleCount / total,
    });
  } else {
    conventions.push({
      category: "formatting",
      rule: "Use single quotes for strings",
      examples: ["const name = 'value'"],
      confidence: singleCount / total,
    });
  }

  return conventions;
}

function detectSemicolonStyle(content: string): StyleConvention[] {
  const conventions: StyleConvention[] = [];

  const withSemicolons = countMatches(content, TRAILING_SEMICOLON_RE);
  const withoutSemicolons = countMatches(content, NO_SEMICOLON_LINE_RE);
  const total = withSemicolons + withoutSemicolons;

  if (total === 0) {
    return conventions;
  }

  const semiRatio = withSemicolons / total;

  if (semiRatio > 0.7) {
    conventions.push({
      category: "formatting",
      rule: "Always use semicolons",
      examples: ["const x = 1;", "return value;"],
      confidence: semiRatio,
    });
  } else if (semiRatio < 0.3) {
    conventions.push({
      category: "formatting",
      rule: "Omit semicolons (ASI style)",
      examples: ["const x = 1", "return value"],
      confidence: 1 - semiRatio,
    });
  }

  return conventions;
}

function detectTypeScriptPatterns(content: string): StyleConvention[] {
  const conventions: StyleConvention[] = [];

  const explicitReturnTypes = countMatches(content, EXPLICIT_RETURN_TYPE_RE);
  if (explicitReturnTypes > 5) {
    conventions.push({
      category: "typescript",
      rule: "Use explicit return types on functions",
      examples: ["function getName(): string {}", "const fn = (): number => 0"],
      confidence: Math.min(explicitReturnTypes / 20, 1),
    });
  }

  const importTypeCount = countMatches(content, IMPORT_TYPE_RE);
  if (importTypeCount > 2) {
    conventions.push({
      category: "typescript",
      rule: "Use import type for type-only imports",
      examples: ['import type { User } from "./types"'],
      confidence: Math.min(importTypeCount / 10, 1),
    });
  }

  const constAssertions = countMatches(content, CONST_ASSERTION_RE);
  if (constAssertions > 1) {
    conventions.push({
      category: "typescript",
      rule: "Use const assertions for literal types",
      examples: ["const values = [1, 2, 3] as const"],
      confidence: Math.min(constAssertions / 5, 1),
    });
  }

  return conventions;
}

function detectAsyncPatterns(content: string): StyleConvention[] {
  const conventions: StyleConvention[] = [];

  const asyncAwaitCount = countMatches(content, ASYNC_AWAIT_RE);
  const promiseThenCount = countMatches(content, PROMISE_THEN_RE);
  const total = asyncAwaitCount + promiseThenCount;

  if (total > 0 && asyncAwaitCount > promiseThenCount) {
    conventions.push({
      category: "async",
      rule: "Prefer async/await over .then() chains",
      examples: ["const data = await fetchData()"],
      confidence: asyncAwaitCount / total,
    });
  }

  return conventions;
}

function detectModernPatterns(content: string): StyleConvention[] {
  const conventions: StyleConvention[] = [];

  const optionalChainCount = countMatches(content, OPTIONAL_CHAIN_RE);
  if (optionalChainCount > 3) {
    conventions.push({
      category: "modern_js",
      rule: "Use optional chaining for safe property access",
      examples: ["user?.profile?.name"],
      confidence: Math.min(optionalChainCount / 10, 1),
    });
  }

  const nullishCount = countMatches(content, NULLISH_COALESCE_RE);
  if (nullishCount > 2) {
    conventions.push({
      category: "modern_js",
      rule: "Use nullish coalescing for default values",
      examples: ["const name = user.name ?? 'Unknown'"],
      confidence: Math.min(nullishCount / 8, 1),
    });
  }

  const templateLiteralCount = countMatches(content, TEMPLATE_LITERAL_RE);
  const concatCount = countMatches(content, STRING_CONCAT_RE);

  if (templateLiteralCount > concatCount && templateLiteralCount > 2) {
    conventions.push({
      category: "modern_js",
      rule: "Prefer template literals over string concatenation",
      examples: ["`Hello $\\{name}`"],
      confidence: Math.min(templateLiteralCount / 10, 1),
    });
  }

  return conventions;
}

// ---------------------------------------------------------------------------
// Enforcement helpers
// ---------------------------------------------------------------------------

function enforceNaming(
  filePath: string,
  content: string,
  conventions: StyleConvention[]
): StyleViolation[] {
  const violations: StyleViolation[] = [];
  const lines = content.split("\n");

  const hasCamelRule = conventions.some(
    (c) => c.category === "naming" && c.rule.includes("camelCase")
  );
  const hasPascalRule = conventions.some(
    (c) => c.category === "naming" && c.rule.includes("PascalCase")
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (hasCamelRule) {
      const varMatch = CAMEL_CASE_VAR_RE.exec(line);
      if (varMatch?.[1]) {
        violations.push({
          file: filePath,
          line: i + 1,
          rule: "naming/camelCase",
          message: `Variable "${varMatch[1]}" should use camelCase`,
          autoFixable: true,
          suggestedFix: line.replace(
            varMatch[1],
            varMatch[1].charAt(0).toLowerCase() + varMatch[1].slice(1)
          ),
        });
      }
    }

    if (hasPascalRule) {
      const typeMatch = PASCAL_CASE_TYPE_RE.exec(line);
      if (typeMatch?.[1]) {
        violations.push({
          file: filePath,
          line: i + 1,
          rule: "naming/PascalCase",
          message: `Type "${typeMatch[1]}" should use PascalCase`,
          autoFixable: true,
          suggestedFix: line.replace(
            typeMatch[1],
            typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1)
          ),
        });
      }
    }
  }

  return violations;
}

function enforceAsyncStyle(
  filePath: string,
  content: string,
  conventions: StyleConvention[]
): StyleViolation[] {
  const violations: StyleViolation[] = [];
  const prefersAwait = conventions.some(
    (c) => c.category === "async" && c.rule.includes("async/await")
  );

  if (!prefersAwait) {
    return violations;
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (THEN_CHAIN_RE.test(line)) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "async/prefer-await",
        message: "Prefer async/await over .then() chains",
        autoFixable: false,
        suggestedFix: "Refactor to use async/await pattern",
      });
    }
  }

  return violations;
}

function enforceModernPatterns(
  filePath: string,
  content: string,
  conventions: StyleConvention[]
): StyleViolation[] {
  const violations: StyleViolation[] = [];
  const lines = content.split("\n");

  const prefersTemplates = conventions.some(
    (c) => c.category === "modern_js" && c.rule.includes("template literals")
  );

  if (!prefersTemplates) {
    return violations;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (CONCAT_STRING_RE.test(line)) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "modern/template-literals",
        message: "Use template literals instead of string concatenation",
        autoFixable: false,
        suggestedFix: "Replace with template literal using backticks",
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class StyleEnforcer {
  private readonly learnedConventions: Map<string, StyleConvention[]> =
    new Map();

  /**
   * Analyze a project's codebase and learn its conventions.
   */
  learnStyle(
    projectId: string,
    files: Map<string, string> = new Map()
  ): Promise<LearnedStyle> {
    logger.info({ projectId, fileCount: files.size }, "Learning project style");

    const allConventions: StyleConvention[] = [];

    for (const [_filePath, content] of files) {
      allConventions.push(...detectNamingConventions(content));
      allConventions.push(...detectFunctionStyle(content));
      allConventions.push(...detectQuoteStyle(content));
      allConventions.push(...detectSemicolonStyle(content));
      allConventions.push(...detectTypeScriptPatterns(content));
      allConventions.push(...detectAsyncPatterns(content));
      allConventions.push(...detectModernPatterns(content));
    }

    // Merge and deduplicate conventions by rule, averaging confidence
    const ruleMap = new Map<
      string,
      { total: number; count: number; convention: StyleConvention }
    >();
    for (const conv of allConventions) {
      const existing = ruleMap.get(conv.rule);
      if (existing) {
        existing.total += conv.confidence;
        existing.count += 1;
      } else {
        ruleMap.set(conv.rule, {
          total: conv.confidence,
          count: 1,
          convention: conv,
        });
      }
    }

    const mergedConventions: StyleConvention[] = [];
    for (const entry of ruleMap.values()) {
      mergedConventions.push({
        ...entry.convention,
        confidence: entry.total / entry.count,
      });
    }

    // Sort by confidence descending
    mergedConventions.sort((a, b) => b.confidence - a.confidence);

    this.learnedConventions.set(projectId, mergedConventions);

    logger.info(
      { projectId, conventionCount: mergedConventions.length },
      "Style learning complete"
    );

    return Promise.resolve({ conventions: mergedConventions });
  }

  /**
   * Enforce learned style conventions on a set of files.
   */
  enforce(
    projectId: string,
    files: FileInput[]
  ): Promise<StyleEnforcementResult> {
    const conventions = this.learnedConventions.get(projectId) ?? [];

    if (conventions.length === 0) {
      logger.warn(
        { projectId },
        "No learned conventions for project; run learnStyle first"
      );
      return Promise.resolve({ violations: [], score: MAX_SCORE });
    }

    logger.info(
      {
        projectId,
        fileCount: files.length,
        conventionCount: conventions.length,
      },
      "Enforcing style conventions"
    );

    const allViolations: StyleViolation[] = [];

    for (const file of files) {
      allViolations.push(
        ...enforceNaming(file.path, file.content, conventions)
      );
      allViolations.push(
        ...enforceAsyncStyle(file.path, file.content, conventions)
      );
      allViolations.push(
        ...enforceModernPatterns(file.path, file.content, conventions)
      );
    }

    const score = Math.max(
      0,
      MAX_SCORE - allViolations.length * VIOLATION_PENALTY
    );

    logger.info(
      { projectId, violationCount: allViolations.length, score },
      "Style enforcement complete"
    );

    return Promise.resolve({ violations: allViolations, score });
  }
}
