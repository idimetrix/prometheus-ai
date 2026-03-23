/**
 * Phase 6.3: Convention Enforcement Hook.
 *
 * Loads detected conventions for a project and checks code compliance.
 * Returns violations with rule, severity, file, line, and suggestion.
 * Provides an overall compliance score.
 */
import { createLogger } from "@prometheus/logger";

import type { AntiPatternRule } from "./anti-pattern-rules";
import { ANTI_PATTERN_RULES } from "./anti-pattern-rules";
import type { DetectedConvention } from "./convention-detector";

const logger = createLogger("project-brain:convention-enforcer-v2");

const FILE_EXT_RE = /\.\w+$/;
const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** A convention violation found during compliance checking. */
export interface ComplianceViolation {
  /** Source file path */
  file: string;
  /** Line number (1-based), if applicable */
  line?: number;
  /** The convention or rule that was violated */
  rule: string;
  /** Severity level */
  severity: "error" | "info" | "warning";
  /** Suggested fix */
  suggestion: string;
}

/** Result of checking a file against conventions. */
export interface ComplianceResult {
  /** File path checked */
  file: string;
  /** Whether the file passes all error-level checks */
  passed: boolean;
  /** Violations found */
  violations: ComplianceViolation[];
}

/**
 * Enforces detected conventions and anti-pattern rules against code.
 */
export class ConventionEnforcerV2 {
  /** Stored conventions per project */
  private readonly projectConventions = new Map<string, DetectedConvention[]>();

  /**
   * Load conventions for a project.
   */
  loadConventions(projectId: string, conventions: DetectedConvention[]): void {
    this.projectConventions.set(projectId, conventions);

    logger.info(
      { projectId, conventionCount: conventions.length },
      "Conventions loaded for project"
    );
  }

  /**
   * Check a file's content against loaded conventions and anti-pattern rules.
   */
  checkCompliance(
    filePath: string,
    content: string,
    conventions: DetectedConvention[]
  ): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];

    // Check against anti-pattern rules
    const language = detectLanguage(filePath);
    const applicableRules = ANTI_PATTERN_RULES.filter(
      (r) => r.language === language || r.language === "general"
    );

    for (const rule of applicableRules) {
      if (rule.pattern === "STRUCTURAL_CHECK") {
        // Structural checks require special handling
        const structuralViolations = this.checkStructural(
          rule,
          filePath,
          content
        );
        for (const v of structuralViolations) {
          violations.push(v);
        }
        continue;
      }

      try {
        const regex = new RegExp(rule.pattern, "gm");
        let match: RegExpExecArray | null = regex.exec(content);
        while (match !== null) {
          const lineNum = content.slice(0, match.index).split("\n").length;
          violations.push({
            rule: rule.id,
            severity: rule.severity,
            file: filePath,
            line: lineNum,
            suggestion: rule.description,
          });
          match = regex.exec(content);
        }
      } catch {
        // Skip invalid regex patterns
      }
    }

    // Check against project conventions
    for (const convention of conventions) {
      const convViolations = this.checkConvention(
        convention,
        filePath,
        content
      );
      for (const v of convViolations) {
        violations.push(v);
      }
    }

    return violations;
  }

  /**
   * Get the overall compliance score for a project (0-100).
   */
  getComplianceScore(projectId: string): number {
    const conventions = this.projectConventions.get(projectId);
    if (!conventions || conventions.length === 0) {
      return 100; // No conventions = fully compliant
    }

    // Score based on average confidence of detected conventions
    const totalConfidence = conventions.reduce(
      (sum, c) => sum + c.confidence,
      0
    );
    const avgConfidence = totalConfidence / conventions.length;

    // Higher average confidence means conventions are well-established
    const score = Math.round(avgConfidence * 100);

    logger.debug(
      { projectId, conventionCount: conventions.length, score },
      "Compliance score calculated"
    );

    return score;
  }

  /**
   * Structural checks (e.g., god function detection).
   */
  private checkStructural(
    rule: AntiPatternRule,
    filePath: string,
    content: string
  ): ComplianceViolation[] {
    if (rule.id !== "gen-god-function") {
      return [];
    }

    const violations: ComplianceViolation[] = [];
    const functionStartRe =
      /(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)\s*\{/g;
    let match: RegExpExecArray | null = functionStartRe.exec(content);

    while (match !== null) {
      const startLine = content.slice(0, match.index).split("\n").length;
      const lineCount = this.countFunctionLines(content.slice(match.index));

      if (lineCount > 100) {
        violations.push({
          rule: rule.id,
          severity: rule.severity,
          file: filePath,
          line: startLine,
          suggestion: `Function has ${lineCount} lines (>100). Consider breaking into smaller functions.`,
        });
      }

      match = functionStartRe.exec(content);
    }

    return violations;
  }

  private countFunctionLines(remaining: string): number {
    let braceDepth = 0;
    let lineCount = 0;
    let foundOpen = false;

    for (const char of remaining) {
      if (char === "{") {
        braceDepth++;
        foundOpen = true;
      }
      if (char === "}") {
        braceDepth--;
      }
      if (char === "\n") {
        lineCount++;
      }
      if (foundOpen && braceDepth === 0) {
        break;
      }
    }

    return lineCount;
  }

  /**
   * Check a single convention against file content.
   */
  private checkConvention(
    convention: DetectedConvention,
    filePath: string,
    _content: string
  ): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];

    // For naming conventions on files
    if (convention.type === "naming" && convention.pattern.includes("file")) {
      const fileName = filePath.split("/").pop() ?? "";
      const baseName = fileName.replace(FILE_EXT_RE, "");

      if (
        baseName &&
        baseName !== "index" &&
        convention.pattern.includes("kebab") &&
        !KEBAB_CASE_RE.test(baseName)
      ) {
        violations.push({
          rule: convention.pattern,
          severity: "info",
          file: filePath,
          suggestion: `File name "${fileName}" does not follow kebab-case convention`,
        });
      }
    }

    return violations;
  }
}

/**
 * Detect the language of a file from its extension.
 */
function detectLanguage(filePath: string): "general" | "python" | "typescript" {
  if (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".jsx")
  ) {
    return "typescript";
  }
  if (filePath.endsWith(".py")) {
    return "python";
  }
  return "general";
}
