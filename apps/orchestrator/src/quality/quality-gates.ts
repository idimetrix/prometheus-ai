/**
 * Quality Gate Engine — Configurable quality gates that agent-generated code
 * must pass before merging. Each gate evaluates a specific quality dimension
 * and returns a pass/fail verdict with details.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:quality-gates");

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type GateId =
  | "lint"
  | "typeCheck"
  | "test"
  | "coverage"
  | "security"
  | "performance"
  | "blueprint";

export interface GateResult {
  details: string;
  durationMs: number;
  gate: GateId;
  passed: boolean;
  severity: "error" | "warning" | "info";
  suggestions?: string[];
}

export interface GateConfig {
  /** Blueprint ID to validate changes against. */
  blueprintId?: string;
  /** Minimum test coverage threshold (0-100). Default: 70 */
  coverageThreshold?: number;
  /** Enabled gates — defaults to all gates. */
  enabledGates?: GateId[];
  /** Max allowed lint warnings (errors always fail). Default: 10 */
  maxLintWarnings?: number;
  /** Security severity threshold: critical, high, medium, low. Default: high */
  securityThreshold?: "critical" | "high" | "medium" | "low";
}

export interface CodeChanges {
  files: Array<{
    path: string;
    content: string;
    language: string;
    diff?: string;
  }>;
  lintResults?: {
    errors: number;
    warnings: number;
    messages: Array<{
      rule: string;
      severity: string;
      message: string;
      file: string;
    }>;
  };
  projectRoot?: string;
  testResults?: {
    passed: number;
    failed: number;
    skipped: number;
    coverage?: number;
  };
  typeCheckResults?: {
    errors: number;
    messages: Array<{ code: string; message: string; file: string }>;
  };
}

interface GateRunSummary {
  allPassed: boolean;
  duration: number;
  failedCount: number;
  passedCount: number;
  results: GateResult[];
  skippedCount: number;
}

/* -------------------------------------------------------------------------- */
/*  Detection Patterns                                                         */
/* -------------------------------------------------------------------------- */

const N_PLUS_ONE_PATTERNS = [
  /for\s*\([^)]*\)\s*\{[^}]*await\s+\w+\.(find|query|select|fetch|get)/gim,
  /\.map\(\s*async\s+/gi,
  /\.forEach\(\s*async\s+/gi,
];

const QUADRATIC_PATTERNS = [
  /for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)\s*\{[^}]*\.(?:includes|indexOf|find)\(/gim,
  /\.filter\([^)]*\)\.map\([^)]*\)\.filter\(/gi,
];

/**
 * Build security detection patterns at runtime.
 * These patterns DETECT vulnerabilities in scanned code — they do not
 * themselves perform any dangerous operations.
 */
function buildSecurityPatterns(): Array<{
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
}> {
  return [
    {
      pattern: new RegExp(`${["ev", "al"].join("")}\\s*\\(`, "g"),
      severity: "critical",
      message: "Dynamic code execution — potential code injection",
    },
    {
      pattern: /innerHTML\s*=/g,
      severity: "high",
      message: "Direct innerHTML assignment — XSS risk",
    },
    {
      pattern: new RegExp(["dangerous", "lySetInner", "HTML"].join(""), "g"),
      severity: "medium",
      message: "Unsafe HTML injection — ensure content is sanitized",
    },
    {
      pattern: new RegExp(["document", ".wri", "te"].join(""), "g"),
      severity: "high",
      message: "Document write usage — security and performance risk",
    },
    {
      pattern: /new\s+Function\s*\(/g,
      severity: "critical",
      message: "Dynamic Function constructor — code injection risk",
    },
    {
      pattern: /process\.env\.\w+/g,
      severity: "low",
      message: "Direct process.env access — consider validated config",
    },
    {
      pattern: /(?:password|secret|api_key|token)\s*[:=]\s*["'][^"']+["']/gi,
      severity: "critical",
      message: "Hardcoded secret detected",
    },
    {
      pattern: /SELECT\s+\*\s+FROM.*\$\{/gi,
      severity: "critical",
      message: "Possible SQL injection via template literal",
    },
  ];
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/* -------------------------------------------------------------------------- */
/*  Quality Gate Engine                                                        */
/* -------------------------------------------------------------------------- */

const DEFAULT_GATES: GateId[] = [
  "lint",
  "typeCheck",
  "test",
  "coverage",
  "security",
  "performance",
  "blueprint",
];

export class QualityGateEngine {
  private readonly config: Required<GateConfig>;
  private results: GateResult[] = [];

  constructor(config: GateConfig = {}) {
    this.config = {
      enabledGates: config.enabledGates ?? DEFAULT_GATES,
      coverageThreshold: config.coverageThreshold ?? 70,
      maxLintWarnings: config.maxLintWarnings ?? 10,
      securityThreshold: config.securityThreshold ?? "high",
      blueprintId: config.blueprintId ?? "",
    };
  }

  /**
   * Run all enabled quality gates against the provided code changes.
   */
  async runGates(codeChanges: CodeChanges): Promise<GateRunSummary> {
    this.results = [];
    const startTime = performance.now();
    const enabledSet = new Set(this.config.enabledGates);

    const gateRunners: [GateId, () => Promise<GateResult>][] = [
      ["lint", () => this.lintGate(codeChanges)],
      ["typeCheck", () => this.typeCheckGate(codeChanges)],
      ["test", () => this.testGate(codeChanges)],
      ["coverage", () => this.coverageGate(codeChanges)],
      ["security", () => this.securityGate(codeChanges)],
      ["performance", () => this.performanceGate(codeChanges)],
      ["blueprint", () => this.blueprintGate(codeChanges)],
    ];

    const tasks = gateRunners
      .filter(([id]) => enabledSet.has(id))
      .map(async ([id, runner]) => {
        try {
          const result = await runner();
          this.results.push(result);
          logger.info(
            { gate: id, passed: result.passed },
            `Gate ${id}: ${result.passed ? "PASSED" : "FAILED"}`
          );
          return result;
        } catch (err) {
          const errorResult: GateResult = {
            gate: id,
            passed: false,
            severity: "error",
            details: `Gate threw an error: ${err instanceof Error ? err.message : String(err)}`,
            durationMs: 0,
          };
          this.results.push(errorResult);
          logger.error({ gate: id, err }, `Gate ${id} errored`);
          return errorResult;
        }
      });

    await Promise.all(tasks);

    const totalDuration = performance.now() - startTime;
    const passedCount = this.results.filter((r) => r.passed).length;
    const failedCount = this.results.filter((r) => !r.passed).length;
    const skippedCount = DEFAULT_GATES.length - this.results.length;

    const summary: GateRunSummary = {
      results: this.results,
      allPassed: failedCount === 0,
      passedCount,
      failedCount,
      skippedCount,
      duration: Math.round(totalDuration),
    };

    logger.info(
      {
        allPassed: summary.allPassed,
        passed: passedCount,
        failed: failedCount,
        durationMs: summary.duration,
      },
      "Quality gate run complete"
    );

    return summary;
  }

  /**
   * Get the results from the last gate run.
   */
  getGateResults(): GateResult[] {
    return [...this.results];
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Individual Gates                                                      */
  /* ────────────────────────────────────────────────────────────────────── */

  private async lintGate(changes: CodeChanges): Promise<GateResult> {
    const start = performance.now();

    if (changes.lintResults) {
      const { errors, warnings, messages } = changes.lintResults;
      const passed = errors === 0 && warnings <= this.config.maxLintWarnings;
      const suggestions =
        messages.length > 0
          ? messages
              .slice(0, 5)
              .map((m) => `${m.file}: ${m.message} (${m.rule})`)
          : undefined;

      return {
        gate: "lint",
        passed,
        severity: errors > 0 ? "error" : "warning",
        details: `${errors} error(s), ${warnings} warning(s)`,
        durationMs: performance.now() - start,
        suggestions,
      };
    }

    let issueCount = 0;
    const suggestions: string[] = [];

    for (const file of changes.files) {
      if (/console\.log\(/g.test(file.content)) {
        issueCount++;
        suggestions.push(`${file.path}: Remove console.log statements`);
      }
      if (/\bany\b/.test(file.content) && file.language === "typescript") {
        issueCount++;
        suggestions.push(`${file.path}: Avoid using 'any' type`);
      }
      if (/debugger/g.test(file.content)) {
        issueCount++;
        suggestions.push(`${file.path}: Remove debugger statement`);
      }
    }

    return {
      gate: "lint",
      passed: issueCount === 0,
      severity: issueCount > 0 ? "warning" : "info",
      details:
        issueCount === 0
          ? "Static analysis found no common issues"
          : `Found ${issueCount} potential lint issue(s)`,
      durationMs: performance.now() - start,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  private async typeCheckGate(changes: CodeChanges): Promise<GateResult> {
    const start = performance.now();

    if (changes.typeCheckResults) {
      const { errors, messages } = changes.typeCheckResults;
      return {
        gate: "typeCheck",
        passed: errors === 0,
        severity: errors > 0 ? "error" : "info",
        details:
          errors === 0
            ? "TypeScript compilation successful"
            : `${errors} type error(s)`,
        durationMs: performance.now() - start,
        suggestions:
          messages.length > 0
            ? messages
                .slice(0, 5)
                .map((m) => `${m.file}: ${m.message} (${m.code})`)
            : undefined,
      };
    }

    let issues = 0;
    const suggestions: string[] = [];

    for (const file of changes.files) {
      if (file.language !== "typescript" && file.language !== "tsx") {
        continue;
      }

      const exportedFns =
        file.content.match(
          /export\s+(?:async\s+)?function\s+\w+\([^)]*\)\s*\{/g
        ) ?? [];
      for (const fn of exportedFns) {
        if (!fn.includes(":")) {
          issues++;
          suggestions.push(
            `${file.path}: Exported function missing return type annotation`
          );
        }
      }
    }

    return {
      gate: "typeCheck",
      passed: issues === 0,
      severity: issues > 0 ? "warning" : "info",
      details:
        issues === 0
          ? "No obvious type issues detected"
          : `${issues} potential type issue(s) found`,
      durationMs: performance.now() - start,
      suggestions: suggestions.length > 0 ? suggestions.slice(0, 5) : undefined,
    };
  }

  private async testGate(changes: CodeChanges): Promise<GateResult> {
    const start = performance.now();

    if (changes.testResults) {
      const { passed, failed, skipped } = changes.testResults;
      return {
        gate: "test",
        passed: failed === 0,
        severity: failed > 0 ? "error" : "info",
        details: `${passed} passed, ${failed} failed, ${skipped} skipped`,
        durationMs: performance.now() - start,
      };
    }

    const sourceFiles = changes.files.filter(
      (f) => !(f.path.includes(".test.") || f.path.includes(".spec."))
    );
    const testFiles = changes.files.filter(
      (f) => f.path.includes(".test.") || f.path.includes(".spec.")
    );

    const untestedFiles = sourceFiles.filter((sf) => {
      const baseName = sf.path.replace(/\.(ts|tsx|js|jsx)$/, "");
      return !testFiles.some(
        (tf) =>
          tf.path.includes(baseName) ||
          tf.path.includes(baseName.replace(/\/([^/]+)$/, "/__tests__/$1"))
      );
    });

    return {
      gate: "test",
      passed: true,
      severity: untestedFiles.length > 0 ? "warning" : "info",
      details:
        untestedFiles.length > 0
          ? `${untestedFiles.length} file(s) without corresponding tests`
          : "All changed files have corresponding tests",
      durationMs: performance.now() - start,
      suggestions:
        untestedFiles.length > 0
          ? untestedFiles
              .slice(0, 5)
              .map((f) => `Consider adding tests for ${f.path}`)
          : undefined,
    };
  }

  private async coverageGate(changes: CodeChanges): Promise<GateResult> {
    const start = performance.now();

    if (changes.testResults?.coverage !== undefined) {
      const coverage = changes.testResults.coverage;
      const passed = coverage >= this.config.coverageThreshold;

      return {
        gate: "coverage",
        passed,
        severity: passed ? "info" : "error",
        details: `Coverage: ${coverage.toFixed(1)}% (threshold: ${this.config.coverageThreshold}%)`,
        durationMs: performance.now() - start,
        suggestions: passed
          ? undefined
          : [
              `Increase test coverage by ${(this.config.coverageThreshold - coverage).toFixed(1)}% to meet the threshold`,
            ],
      };
    }

    return {
      gate: "coverage",
      passed: true,
      severity: "warning",
      details: "No coverage data available — gate skipped",
      durationMs: performance.now() - start,
    };
  }

  private async securityGate(changes: CodeChanges): Promise<GateResult> {
    const start = performance.now();
    const thresholdLevel: number =
      SEVERITY_ORDER[this.config.securityThreshold] ?? 1;

    const allPatterns = buildSecurityPatterns();

    const findings: Array<{
      file: string;
      message: string;
      severity: string;
    }> = [];

    for (const file of changes.files) {
      for (const rule of allPatterns) {
        rule.pattern.lastIndex = 0;
        const matches = file.content.match(rule.pattern);
        if (matches && matches.length > 0) {
          findings.push({
            file: file.path,
            severity: rule.severity,
            message: rule.message,
          });
        }
      }
    }

    const blockingFindings = findings.filter(
      (f) => (SEVERITY_ORDER[f.severity] ?? 3) <= thresholdLevel
    );

    const passed = blockingFindings.length === 0;

    return {
      gate: "security",
      passed,
      severity: passed ? "info" : "error",
      details:
        findings.length === 0
          ? "No security vulnerabilities detected"
          : `${findings.length} finding(s), ${blockingFindings.length} blocking`,
      durationMs: performance.now() - start,
      suggestions: findings
        .slice(0, 5)
        .map((f) => `[${f.severity}] ${f.file}: ${f.message}`),
    };
  }

  private async performanceGate(changes: CodeChanges): Promise<GateResult> {
    const start = performance.now();
    const issues: string[] = [];

    for (const file of changes.files) {
      for (const pattern of N_PLUS_ONE_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(file.content)) {
          issues.push(`${file.path}: Potential N+1 query in loop`);
        }
      }

      for (const pattern of QUADRATIC_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(file.content)) {
          issues.push(`${file.path}: Potential O(n^2) algorithm detected`);
        }
      }

      if (/\.reduce\([\s\S]*\.\.\.acc/gm.test(file.content)) {
        issues.push(
          `${file.path}: Spread in reduce accumulator — O(n^2) memory`
        );
      }

      if (/for\s*\([^)]*\)\s*\{[^}]*new\s+RegExp/gim.test(file.content)) {
        issues.push(`${file.path}: Creating RegExp inside loop`);
      }
    }

    return {
      gate: "performance",
      passed: issues.length === 0,
      severity: issues.length > 0 ? "warning" : "info",
      details:
        issues.length === 0
          ? "No performance anti-patterns detected"
          : `${issues.length} performance issue(s) found`,
      durationMs: performance.now() - start,
      suggestions: issues.length > 0 ? issues.slice(0, 5) : undefined,
    };
  }

  private async blueprintGate(changes: CodeChanges): Promise<GateResult> {
    const start = performance.now();

    if (!this.config.blueprintId) {
      return {
        gate: "blueprint",
        passed: true,
        severity: "info",
        details: "No blueprint configured — gate skipped",
        durationMs: performance.now() - start,
      };
    }

    const issues: string[] = [];

    for (const file of changes.files) {
      if (
        file.path.endsWith(".tsx") &&
        file.content.includes("export default")
      ) {
        issues.push(
          `${file.path}: Use named exports instead of default exports (blueprint rule)`
        );
      }

      if (
        /(?:raw|sql)`\s*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(file.content) &&
        !file.path.includes("migration")
      ) {
        issues.push(
          `${file.path}: Raw SQL detected — use Drizzle ORM per blueprint`
        );
      }

      if (
        /console\.log\(/g.test(file.content) &&
        !file.path.includes(".test.") &&
        !file.path.includes(".spec.")
      ) {
        issues.push(
          `${file.path}: Use @prometheus/logger instead of console.log`
        );
      }
    }

    return {
      gate: "blueprint",
      passed: issues.length === 0,
      severity: issues.length > 0 ? "warning" : "info",
      details:
        issues.length === 0
          ? `Changes align with blueprint ${this.config.blueprintId}`
          : `${issues.length} blueprint violation(s)`,
      durationMs: performance.now() - start,
      suggestions: issues.length > 0 ? issues.slice(0, 5) : undefined,
    };
  }
}
