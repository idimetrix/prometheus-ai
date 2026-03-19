import { createLogger } from "@prometheus/logger";
import { sandboxManagerClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:guardian:semgrep");

export interface SemgrepFinding {
  column: number;
  filePath: string;
  line: number;
  message: string;
  ruleId: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface SemgrepResult {
  findings: SemgrepFinding[];
  summary: {
    high: number;
    low: number;
    medium: number;
  };
}

/**
 * SemgrepScanner runs static analysis via semgrep inside a sandbox
 * to detect security issues, anti-patterns, and convention violations
 * before code is merged.
 */
export class SemgrepScanner {
  /**
   * Run semgrep analysis inside the given sandbox.
   *
   * @param sandboxId - The sandbox to run the scan in
   * @param path - Optional sub-path to scan (defaults to workspace root)
   */
  async scan(sandboxId: string, path?: string): Promise<SemgrepResult> {
    const targetPath = path ?? ".";

    try {
      const response = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${sandboxId}/exec`, {
        command: "semgrep",
        args: [
          "--config",
          "auto",
          "--config",
          "/etc/semgrep/prometheus.yaml",
          "--json",
          targetPath,
        ],
        timeout: 120_000,
      });

      return this.parseOutput(response.data.stdout);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ sandboxId, error: msg }, "Semgrep scan failed");
      return { findings: [], summary: { high: 0, medium: 0, low: 0 } };
    }
  }

  /**
   * Determine whether the scan results should block PR creation.
   * Returns true if any HIGH severity findings exist.
   */
  shouldBlockPR(result: SemgrepResult): boolean {
    return result.summary.high > 0;
  }

  /**
   * Format scan findings into a human-readable summary suitable
   * for inclusion in a PR description or log output.
   */
  formatFindings(result: SemgrepResult): string {
    if (result.findings.length === 0) {
      return "No security findings detected.";
    }

    const lines: string[] = [
      "## Security Scan Results",
      "",
      "| Severity | Count |",
      "|----------|-------|",
      `| HIGH | ${result.summary.high} |`,
      `| MEDIUM | ${result.summary.medium} |`,
      `| LOW | ${result.summary.low} |`,
      "",
    ];

    if (result.summary.high > 0) {
      lines.push("### High Severity Findings", "");
    }

    for (const finding of result.findings) {
      if (finding.severity === "HIGH") {
        lines.push(
          `- **${finding.ruleId}** at \`${finding.filePath}:${finding.line}:${finding.column}\``,
          `  ${finding.message}`,
          ""
        );
      }
    }

    if (result.summary.medium > 0) {
      lines.push("### Medium Severity Findings", "");
      for (const finding of result.findings) {
        if (finding.severity === "MEDIUM") {
          lines.push(
            `- **${finding.ruleId}** at \`${finding.filePath}:${finding.line}:${finding.column}\``,
            `  ${finding.message}`,
            ""
          );
        }
      }
    }

    return lines.join("\n");
  }

  private parseOutput(stdout: string): SemgrepResult {
    try {
      const parsed = JSON.parse(stdout) as {
        results?: Array<{
          check_id: string;
          end: { col: number; line: number };
          extra: {
            message: string;
            metadata?: { severity?: string };
            severity: string;
          };
          path: string;
          start: { col: number; line: number };
        }>;
      };

      const findings: SemgrepFinding[] = (parsed.results ?? []).map(
        (result) => ({
          ruleId: result.check_id,
          severity: this.normalizeSeverity(
            result.extra.metadata?.severity ?? result.extra.severity
          ),
          message: result.extra.message,
          filePath: result.path,
          line: result.start.line,
          column: result.start.col,
        })
      );

      const summary = {
        high: findings.filter((f) => f.severity === "HIGH").length,
        medium: findings.filter((f) => f.severity === "MEDIUM").length,
        low: findings.filter((f) => f.severity === "LOW").length,
      };

      return { findings, summary };
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "Failed to parse semgrep JSON output"
      );
      return { findings: [], summary: { high: 0, medium: 0, low: 0 } };
    }
  }

  private normalizeSeverity(severity: string): "HIGH" | "MEDIUM" | "LOW" {
    const upper = severity.toUpperCase();
    if (upper === "ERROR" || upper === "HIGH") {
      return "HIGH";
    }
    if (upper === "WARNING" || upper === "MEDIUM") {
      return "MEDIUM";
    }
    return "LOW";
  }
}
