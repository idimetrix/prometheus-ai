/**
 * Phase 6.2: Anti-Pattern Rules.
 *
 * Defines common anti-patterns per language with severity levels
 * and pattern descriptions for automated detection.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:anti-pattern-rules");

/** Severity level for anti-pattern violations. */
export type AntiPatternSeverity = "error" | "info" | "warning";

/** Language scope for an anti-pattern rule. */
export type AntiPatternLanguage = "general" | "python" | "typescript";

/** An anti-pattern rule definition. */
export interface AntiPatternRule {
  /** Human-readable description */
  description: string;
  /** Unique rule identifier */
  id: string;
  /** Language this rule applies to */
  language: AntiPatternLanguage;
  /** Regex or string pattern to match */
  pattern: string;
  /** Severity level */
  severity: AntiPatternSeverity;
}

/**
 * Common anti-pattern rules for automated detection.
 */
export const ANTI_PATTERN_RULES: AntiPatternRule[] = [
  // ---- TypeScript ----
  {
    id: "ts-unused-import",
    language: "typescript",
    description: "Unused import detected",
    severity: "warning",
    pattern: "import\\s+.*\\s+from\\s+['\"].*['\"]",
  },
  {
    id: "ts-any-type",
    language: "typescript",
    description: "Usage of 'any' type weakens type safety",
    severity: "error",
    pattern: ":\\s*any\\b|<any>|as\\s+any",
  },
  {
    id: "ts-missing-error-handling",
    language: "typescript",
    description: "Async function without try-catch error handling",
    severity: "warning",
    pattern: "async\\s+function.*\\{(?!.*try\\s*\\{)",
  },
  {
    id: "ts-nested-callbacks",
    language: "typescript",
    description:
      "Deeply nested callbacks reduce readability; prefer async/await",
    severity: "warning",
    pattern: "\\.then\\(.*\\.then\\(.*\\.then\\(",
  },
  {
    id: "ts-sync-fs",
    language: "typescript",
    description:
      "Synchronous file I/O blocks the event loop; use async variants",
    severity: "error",
    pattern: "(?:readFileSync|writeFileSync|mkdirSync|readdirSync)",
  },
  {
    id: "ts-console-log",
    language: "typescript",
    description: "Console.log in production code; use structured logger",
    severity: "warning",
    pattern: "console\\.(log|warn|error|info|debug)\\s*\\(",
  },
  {
    id: "ts-no-explicit-return-type",
    language: "typescript",
    description: "Public function missing explicit return type annotation",
    severity: "info",
    pattern: "export\\s+(?:async\\s+)?function\\s+\\w+\\([^)]*\\)\\s*\\{",
  },
  {
    id: "ts-empty-catch",
    language: "typescript",
    description: "Empty catch block silently swallows errors",
    severity: "error",
    pattern: "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}",
  },

  // ---- Python ----
  {
    id: "py-bare-except",
    language: "python",
    description: "Bare except catches all exceptions including SystemExit",
    severity: "error",
    pattern: "except:\\s*$",
  },
  {
    id: "py-mutable-default-arg",
    language: "python",
    description: "Mutable default argument shares state across function calls",
    severity: "error",
    pattern: "def\\s+\\w+\\(.*=\\s*(?:\\[\\]|\\{\\}|set\\(\\))",
  },
  {
    id: "py-string-concat-loop",
    language: "python",
    description: "String concatenation in loop; use join() instead",
    severity: "warning",
    pattern: "for\\s+.*:\\s*\\n.*\\+?=\\s*['\"]",
  },
  {
    id: "py-global-variable",
    language: "python",
    description: "Global variable mutation makes code harder to reason about",
    severity: "warning",
    pattern: "\\bglobal\\s+\\w+",
  },

  // ---- General ----
  {
    id: "gen-deep-nesting",
    language: "general",
    description:
      "Deeply nested conditionals reduce readability; prefer early returns",
    severity: "warning",
    pattern:
      "(?:if|for|while).*\\{(?:.*\\n){0,3}.*(?:if|for|while).*\\{(?:.*\\n){0,3}.*(?:if|for|while).*\\{",
  },
  {
    id: "gen-god-function",
    language: "general",
    description:
      "Function exceeds 100 lines; consider breaking into smaller functions",
    severity: "warning",
    pattern: "STRUCTURAL_CHECK",
  },
  {
    id: "gen-dead-code",
    language: "general",
    description: "Unreachable code after return/throw/break statement",
    severity: "info",
    pattern: "(?:return|throw|break)\\s+[^;]*;\\s*\\n\\s*(?!\\}|case|default)",
  },
  {
    id: "gen-magic-number",
    language: "general",
    description: "Magic number should be extracted to a named constant",
    severity: "info",
    pattern:
      "(?<!\\w)(?:0x[0-9a-f]{4,}|\\b(?:[2-9]\\d{2,}|[1-9]\\d{3,})\\b)(?!\\w)",
  },
  {
    id: "gen-todo-fixme",
    language: "general",
    description: "TODO/FIXME comment indicates unfinished work",
    severity: "info",
    pattern: "(?:TODO|FIXME|HACK|XXX)\\b",
  },
];

/**
 * Get anti-pattern rules filtered by language.
 */
export function getRulesForLanguage(
  language: AntiPatternLanguage
): AntiPatternRule[] {
  return ANTI_PATTERN_RULES.filter(
    (rule) => rule.language === language || rule.language === "general"
  );
}

/**
 * Get anti-pattern rules filtered by severity.
 */
export function getRulesBySeverity(
  severity: AntiPatternSeverity
): AntiPatternRule[] {
  return ANTI_PATTERN_RULES.filter((rule) => rule.severity === severity);
}

// Log rule count on module load
logger.debug(
  { ruleCount: ANTI_PATTERN_RULES.length },
  "Anti-pattern rules loaded"
);
