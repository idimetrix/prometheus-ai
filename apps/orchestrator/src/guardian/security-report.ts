import { createLogger } from "@prometheus/logger";
import type { DependencyScanResult } from "./dependency-scanner";
import type { RuleViolation } from "./prometheus-rules";
import type { ScanResult } from "./secrets-scanner";
import type { SemgrepResult } from "./semgrep-scanner";

const logger = createLogger("orchestrator:guardian:security-report");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityScanResults {
  dependencies?: DependencyScanResult;
  prometheusRules?: RuleViolation[];
  secrets?: ScanResult;
  semgrep?: SemgrepResult;
}

export type ComplianceStatus = "pass" | "fail" | "warning";

export interface SecurityReportData {
  compliance: {
    details: string[];
    status: ComplianceStatus;
  };
  criticalFindings: ReportFinding[];
  generatedAt: number;
  projectId: string;
  recommendations: string[];
  summary: ReportSummary;
  warnings: ReportFinding[];
}

export interface ReportSummary {
  critical: number;
  high: number;
  info: number;
  low: number;
  moderate: number;
  overallStatus: ComplianceStatus;
  totalFindings: number;
}

export interface ReportFinding {
  category: string;
  description: string;
  fix: string;
  location: string;
  severity: string;
}

// ---------------------------------------------------------------------------
// SecurityReportGenerator
// ---------------------------------------------------------------------------

/**
 * Generates comprehensive security audit reports from multiple scan sources:
 * Semgrep results, Prometheus custom rules, secret scanning, and dependency
 * vulnerability data.
 */
export class SecurityReportGenerator {
  private report: SecurityReportData | null = null;

  /**
   * Generate a full security report from scan results.
   */
  generateReport(
    projectId: string,
    scanResults: SecurityScanResults
  ): SecurityReportData {
    logger.info({ projectId }, "Generating security report");

    const findings = this.collectFindings(scanResults);
    const critical = findings.filter(
      (f) => f.severity === "critical" || f.severity === "HIGH"
    );
    const warnings = findings.filter(
      (f) =>
        f.severity === "warning" ||
        f.severity === "moderate" ||
        f.severity === "MEDIUM"
    );

    const summary = this.buildSummary(findings);
    const compliance = this.assessCompliance(scanResults);
    const recommendations = this.buildRecommendations(scanResults);

    this.report = {
      projectId,
      generatedAt: Date.now(),
      summary,
      criticalFindings: critical,
      warnings,
      recommendations,
      compliance,
    };

    logger.info(
      {
        projectId,
        totalFindings: summary.totalFindings,
        status: summary.overallStatus,
      },
      "Security report generated"
    );

    return this.report;
  }

  /**
   * Export the report as a markdown string.
   */
  toMarkdown(): string {
    if (!this.report) {
      return "No report generated yet.";
    }

    const r = this.report;
    const lines: string[] = [];

    // Header
    lines.push("# Security Audit Report");
    lines.push("");
    lines.push(`**Project:** ${r.projectId}`);
    lines.push(`**Generated:** ${new Date(r.generatedAt).toISOString()}`);
    lines.push(`**Status:** ${r.summary.overallStatus.toUpperCase()}`);
    lines.push("");

    // Summary
    lines.push("## Summary");
    lines.push("");
    lines.push("| Severity | Count |");
    lines.push("|----------|-------|");
    lines.push(`| Critical | ${r.summary.critical} |`);
    lines.push(`| High | ${r.summary.high} |`);
    lines.push(`| Moderate | ${r.summary.moderate} |`);
    lines.push(`| Low | ${r.summary.low} |`);
    lines.push(`| Info | ${r.summary.info} |`);
    lines.push(`| **Total** | **${r.summary.totalFindings}** |`);
    lines.push("");

    // Critical findings
    if (r.criticalFindings.length > 0) {
      lines.push("## Critical Findings");
      lines.push("");
      for (const finding of r.criticalFindings) {
        lines.push(
          `### [${finding.severity.toUpperCase()}] ${finding.category}`
        );
        lines.push("");
        lines.push(`- **Location:** ${finding.location}`);
        lines.push(`- **Description:** ${finding.description}`);
        lines.push(`- **Fix:** ${finding.fix}`);
        lines.push("");
      }
    }

    // Warnings
    if (r.warnings.length > 0) {
      lines.push("## Warnings");
      lines.push("");
      for (const warning of r.warnings) {
        lines.push(`- **${warning.category}** at ${warning.location}`);
        lines.push(`  ${warning.description}`);
        lines.push("");
      }
    }

    // Recommendations
    if (r.recommendations.length > 0) {
      lines.push("## Recommendations");
      lines.push("");
      for (const rec of r.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push("");
    }

    // Compliance
    lines.push("## Compliance");
    lines.push("");
    lines.push(`**Status:** ${r.compliance.status.toUpperCase()}`);
    lines.push("");
    for (const detail of r.compliance.details) {
      lines.push(`- ${detail}`);
    }
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Export the report as a JSON-serializable object for API/UI consumption.
   */
  toJSON(): SecurityReportData | null {
    return this.report ? { ...this.report } : null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private collectFindings(scanResults: SecurityScanResults): ReportFinding[] {
    const findings: ReportFinding[] = [];

    // Semgrep findings
    if (scanResults.semgrep) {
      for (const f of scanResults.semgrep.findings) {
        findings.push({
          severity: f.severity,
          category: "static-analysis",
          description: f.message,
          location: `${f.filePath}:${f.line}:${f.column}`,
          fix: `Address semgrep rule ${f.ruleId}`,
        });
      }
    }

    // Prometheus rule violations
    if (scanResults.prometheusRules) {
      for (const v of scanResults.prometheusRules) {
        findings.push({
          severity: v.rule.severity,
          category: v.rule.category,
          description: v.rule.description,
          location: `${v.file}:${v.line}:${v.column}`,
          fix: v.fix,
        });
      }
    }

    // Secret scan findings
    if (scanResults.secrets?.matches) {
      for (const m of scanResults.secrets.matches) {
        findings.push({
          severity: "critical",
          category: "secrets",
          description: m.description,
          location: `line ${m.line}`,
          fix: "Remove hardcoded secret and use environment variables",
        });
      }
    }

    // Dependency vulnerabilities
    if (scanResults.dependencies) {
      for (const v of scanResults.dependencies.vulnerabilities) {
        findings.push({
          severity: v.severity,
          category: "dependency",
          description: `${v.advisory} (${v.package}@${v.version})`,
          location: `package.json: ${v.package}`,
          fix: v.fixedIn
            ? `Upgrade to ${v.package}@${v.fixedIn}`
            : "No fix available yet",
        });
      }
    }

    return findings;
  }

  private buildSummary(findings: ReportFinding[]): ReportSummary {
    const critical = findings.filter((f) => f.severity === "critical").length;
    const high = findings.filter(
      (f) => f.severity === "HIGH" || f.severity === "high"
    ).length;
    const moderate = findings.filter(
      (f) =>
        f.severity === "moderate" ||
        f.severity === "MEDIUM" ||
        f.severity === "warning"
    ).length;
    const low = findings.filter(
      (f) => f.severity === "LOW" || f.severity === "low"
    ).length;
    const info = findings.filter((f) => f.severity === "info").length;

    let overallStatus: ComplianceStatus = "pass";
    if (critical > 0 || high > 0) {
      overallStatus = "fail";
    } else if (moderate > 0) {
      overallStatus = "warning";
    }

    return {
      totalFindings: findings.length,
      critical,
      high,
      moderate,
      low,
      info,
      overallStatus,
    };
  }

  private assessCompliance(scanResults: SecurityScanResults): {
    details: string[];
    status: ComplianceStatus;
  } {
    const details: string[] = [];
    let status: ComplianceStatus = "pass";

    // Check secrets
    if (scanResults.secrets?.blocked) {
      status = "fail";
      details.push("FAIL: Hardcoded secrets detected in source code");
    } else {
      details.push("PASS: No hardcoded secrets detected");
    }

    // Check semgrep high-severity
    if (scanResults.semgrep && scanResults.semgrep.summary.high > 0) {
      status = "fail";
      details.push(
        `FAIL: ${scanResults.semgrep.summary.high} high-severity static analysis findings`
      );
    } else {
      details.push("PASS: No high-severity static analysis findings");
    }

    // Check Prometheus rules
    if (scanResults.prometheusRules) {
      const blocking = scanResults.prometheusRules.filter(
        (v) => v.rule.severity === "critical" || v.rule.severity === "error"
      );
      if (blocking.length > 0) {
        status = "fail";
        details.push(
          `FAIL: ${blocking.length} Prometheus security rule violations`
        );
      } else {
        details.push("PASS: Prometheus security rules satisfied");
      }
    }

    // Check dependencies
    if (scanResults.dependencies) {
      const criticalVulns = scanResults.dependencies.vulnerabilities.filter(
        (v) => v.severity === "critical"
      );
      if (criticalVulns.length > 0) {
        status = "fail";
        details.push(
          `FAIL: ${criticalVulns.length} critical dependency vulnerabilities`
        );
      } else if (scanResults.dependencies.vulnerabilities.length > 0) {
        if (status !== "fail") {
          status = "warning";
        }
        details.push(
          `WARNING: ${scanResults.dependencies.vulnerabilities.length} dependency vulnerabilities (non-critical)`
        );
      } else {
        details.push("PASS: No known dependency vulnerabilities");
      }
    }

    return { status, details };
  }

  private buildRecommendations(scanResults: SecurityScanResults): string[] {
    const recs: string[] = [];

    if (scanResults.secrets?.blocked) {
      recs.push(
        "Immediately remove all hardcoded secrets and rotate any exposed credentials"
      );
    }

    if (scanResults.dependencies?.outdated.length) {
      recs.push(
        `Update ${scanResults.dependencies.outdated.length} outdated or deprecated packages`
      );
    }

    if (scanResults.dependencies?.recommendations) {
      for (const rec of scanResults.dependencies.recommendations) {
        recs.push(`[${rec.package}] ${rec.message}`);
      }
    }

    if (
      scanResults.prometheusRules?.some((v) => v.rule.id === "rls-enforcement")
    ) {
      recs.push(
        "Ensure all tenant-scoped database queries include orgId filter for row-level security"
      );
    }

    if (scanResults.prometheusRules?.some((v) => v.rule.id === "no-raw-sql")) {
      recs.push(
        "Migrate raw SQL queries to Drizzle ORM for type safety and injection prevention"
      );
    }

    if (recs.length === 0) {
      recs.push(
        "No immediate action items. Continue regular security scanning."
      );
    }

    return recs;
  }
}
