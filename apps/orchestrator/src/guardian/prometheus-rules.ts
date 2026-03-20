import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:guardian:prometheus-rules");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuleSeverity = "info" | "warning" | "error" | "critical";

export interface PrometheusRule {
  category: string;
  description: string;
  fix: string;
  id: string;
  name: string;
  pattern: RegExp;
  severity: RuleSeverity;
}

export interface RuleViolation {
  column: number;
  file: string;
  fix: string;
  line: number;
  matched: string;
  rule: PrometheusRule;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Prometheus-specific security and convention rules enforced during
 * code review and CI scanning.
 */
export const PROMETHEUS_SECURITY_RULES: PrometheusRule[] = [
  {
    id: "rls-enforcement",
    name: "RLS Enforcement",
    description:
      "Database queries on tenant-scoped tables must include an orgId filter to enforce row-level security",
    category: "security",
    severity: "critical",
    pattern:
      /\.(?:select|update|delete)\(\)[\s\S]{0,200}\.from\((?!.*\.where\(.*org[Ii]d)/,
    fix: "Add .where(eq(table.orgId, ctx.auth.orgId)) to every tenant-scoped query",
  },
  {
    id: "auth-required",
    name: "Auth Required for Mutations",
    description:
      "All tRPC mutation endpoints must use protectedProcedure to enforce authentication",
    category: "security",
    severity: "error",
    pattern: /publicProcedure\s*\.mutation\(/,
    fix: "Replace publicProcedure with protectedProcedure for mutation endpoints",
  },
  {
    id: "no-raw-sql",
    name: "No Raw SQL",
    description:
      "Raw SQL queries are not allowed outside approved patterns. Use Drizzle ORM for all database operations.",
    category: "security",
    severity: "error",
    pattern: /\b(?:db|client|pool)\s*\.\s*(?:query|execute)\s*\(\s*[`'"]/,
    fix: "Use Drizzle ORM query builder instead of raw SQL strings",
  },
  {
    id: "credential-handling",
    name: "Credential Handling",
    description:
      "Secrets and credentials must not be hardcoded in source code. Use environment variables.",
    category: "security",
    severity: "critical",
    pattern:
      /(?:password|secret|api[_-]?key|token)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i,
    fix: "Move secrets to environment variables and reference via process.env",
  },
  {
    id: "input-validation",
    name: "Input Validation Required",
    description:
      "All tRPC procedures with inputs must validate using .input() with a Zod schema",
    category: "security",
    severity: "warning",
    pattern: /\.(?:mutation|query)\(\s*(?:async\s*)?\(\s*\{\s*(?:ctx|input)/,
    fix: "Add .input(z.object({ ... })) before .mutation() or .query() to validate inputs",
  },
  {
    id: "sql-injection",
    name: "SQL Injection Risk",
    description:
      "String interpolation in SQL queries can lead to SQL injection attacks",
    category: "security",
    severity: "critical",
    pattern: /sql`[^`]*\$\{(?!sql\b)/,
    fix: "Use parameterized queries with sql.placeholder() or Drizzle query builder",
  },
  {
    id: "async-error-handling",
    name: "Async Error Handling",
    description:
      "Async route handlers should have proper error handling to prevent unhandled rejections",
    category: "reliability",
    severity: "warning",
    pattern:
      /\.(?:get|post|put|patch|delete)\s*\(\s*["'][^"']+["']\s*,\s*async/,
    fix: "Wrap async handlers in try/catch or use an error-handling middleware",
  },
  {
    id: "no-internal-errors",
    name: "No Internal Error Exposure",
    description:
      "Internal error details should not be exposed to clients in production responses",
    category: "security",
    severity: "warning",
    pattern:
      /res\.(?:json|send)\(\s*\{\s*(?:error|message)\s*:\s*(?:err|error)\.(?:message|stack)/,
    fix: "Return a generic error message to clients and log the detailed error server-side",
  },
];

// ---------------------------------------------------------------------------
// Rule Scanner
// ---------------------------------------------------------------------------

/**
 * Scan source code against Prometheus security rules.
 */
export function scanWithPrometheusRules(
  code: string,
  filePath: string
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of PROMETHEUS_SECURITY_RULES) {
    const flags = rule.pattern.flags.includes("g")
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`;
    const re = new RegExp(rule.pattern.source, flags);
    let match: RegExpExecArray | null = null;

    while (true) {
      match = re.exec(code);
      if (!match) {
        break;
      }

      // Calculate line number from match index
      const beforeMatch = code.slice(0, match.index);
      const lineNumber = beforeMatch.split("\n").length;
      const lastNewline = beforeMatch.lastIndexOf("\n");
      const column = match.index - lastNewline;

      violations.push({
        rule,
        file: filePath,
        line: lineNumber,
        column,
        matched: match[0].slice(0, 80),
        fix: rule.fix,
      });

      // Avoid infinite loops on zero-length matches
      if (match[0].length === 0) {
        re.lastIndex++;
      }
    }
  }

  if (violations.length > 0) {
    logger.warn(
      {
        filePath,
        violationCount: violations.length,
        rules: [...new Set(violations.map((v) => v.rule.id))],
      },
      "Prometheus rule violations detected"
    );
  }

  return violations;
}

/**
 * Check if any violations are blocking (critical or error severity).
 */
export function hasBlockingViolations(violations: RuleViolation[]): boolean {
  return violations.some(
    (v) => v.rule.severity === "critical" || v.rule.severity === "error"
  );
}
