/**
 * Code Review Runner
 *
 * Orchestrates a full code review by combining the DiffReviewer (structural
 * analysis of git diffs) with the reviewer agent role prompt (semantic
 * analysis via LLM). Produces a unified review report.
 */

import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import { DiffReviewer, type DiffReviewResult } from "./diff-reviewer";

const logger = createLogger("orchestrator:review:runner");

export interface CodeReviewRequest {
  /** Optional: blueprint acceptance criteria */
  blueprint?: string;
  /** Files that were changed (for targeted review) */
  changedFiles: string[];
  /** Optional: project conventions to check against */
  conventions?: string;
  /** The git diff to review */
  diff: string;
  /** Description of the task that produced the changes */
  taskDescription: string;
}

export interface ReviewFinding {
  /** Review category */
  category: string;
  /** Description of the finding */
  description: string;
  /** File path where the issue was found */
  filePath: string;
  /** Line number (if applicable) */
  line?: number;
  /** Severity of the finding */
  severity: "critical" | "warning" | "suggestion" | "nitpick";
  /** Suggested fix */
  suggestion?: string;
}

export interface CodeReviewResult {
  /** Number of critical issues found */
  criticalCount: number;
  /** Overall review decision */
  decision: "approve" | "request_changes" | "reject";
  /** Structural diff analysis results */
  diffAnalysis: DiffReviewResult;
  /** Individual findings */
  findings: ReviewFinding[];
  /** Overall quality score (0-1) */
  score: number;
  /** Summary of the review */
  summary: string;
  /** Number of warning issues found */
  warningCount: number;
}

/**
 * CodeReviewRunner combines automated diff analysis with LLM-powered
 * semantic review to produce comprehensive code review reports.
 */
export class CodeReviewRunner {
  private readonly diffReviewer = new DiffReviewer();

  /**
   * Run a full code review.
   */
  async review(
    agentLoop: AgentLoop,
    request: CodeReviewRequest
  ): Promise<CodeReviewResult> {
    logger.info(
      {
        changedFiles: request.changedFiles.length,
        diffLength: request.diff.length,
      },
      "Starting code review"
    );

    // Step 1: Structural diff analysis
    const diffAnalysis = await this.diffReviewer.review(
      request.diff,
      request.taskDescription
    );

    // Step 2: LLM semantic review via reviewer agent
    const semanticFindings = await this.runSemanticReview(agentLoop, request);

    // Step 3: Merge findings from both sources
    const allFindings = [
      ...this.convertDiffIssues(diffAnalysis),
      ...semanticFindings,
    ];

    // Deduplicate by file+line+description
    const deduped = this.deduplicateFindings(allFindings);

    // Calculate final score and decision
    const criticalCount = deduped.filter(
      (f) => f.severity === "critical"
    ).length;
    const warningCount = deduped.filter((f) => f.severity === "warning").length;

    const score = this.calculateScore(
      diffAnalysis.score,
      criticalCount,
      warningCount
    );
    const decision = this.determineDecision(criticalCount, warningCount);

    const summary = this.buildSummary(
      decision,
      deduped,
      criticalCount,
      warningCount
    );

    logger.info(
      {
        decision,
        score,
        criticalCount,
        warningCount,
        totalFindings: deduped.length,
      },
      "Code review complete"
    );

    return {
      decision,
      score,
      summary,
      findings: deduped,
      diffAnalysis,
      criticalCount,
      warningCount,
    };
  }

  /**
   * Run semantic review via the reviewer agent.
   */
  private async runSemanticReview(
    agentLoop: AgentLoop,
    request: CodeReviewRequest
  ): Promise<ReviewFinding[]> {
    const prompt = `Review the following code changes. For each issue found, output it on a line in this exact format:
[SEVERITY] FILE:LINE - CATEGORY: description

Severity must be one of: CRITICAL, WARNING, SUGGESTION, NITPICK
Categories: type_safety, error_handling, security, performance, data_integrity, testing, code_quality

Task: ${request.taskDescription}
Changed files: ${request.changedFiles.join(", ")}

Diff:
\`\`\`
${request.diff.slice(0, 8000)}
\`\`\`

${request.conventions ? `Conventions:\n${request.conventions}` : ""}
${request.blueprint ? `Blueprint:\n${request.blueprint}` : ""}

Review each file for:
1. Type safety (no any, proper error types)
2. Error handling (try/catch, proper error messages)
3. Security (no hardcoded secrets, proper auth)
4. Performance (no N+1, proper pagination)
5. Data integrity (transactions, orgId scoping)
6. Testing (adequate coverage)
7. Code quality (naming, complexity, formatting)`;

    try {
      const result = await agentLoop.executeTask(prompt, "backend_coder");
      return this.parseSemanticFindings(result.output);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: msg }, "Semantic review failed");
      return [];
    }
  }

  /**
   * Parse findings from semantic review output.
   */
  private parseSemanticFindings(output: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const findingRegex =
      /\[(CRITICAL|WARNING|SUGGESTION|NITPICK)]\s+(\S+?)(?::(\d+))?\s*-\s*(\w+):\s*(.+)/gi;

    let match = findingRegex.exec(output);
    while (match !== null) {
      const severity = (match[1]?.toLowerCase() ?? "suggestion") as
        | "critical"
        | "warning"
        | "suggestion"
        | "nitpick";
      findings.push({
        severity,
        filePath: match[2] ?? "",
        line: match[3] ? Number.parseInt(match[3], 10) : undefined,
        category: match[4] ?? "code_quality",
        description: match[5]?.trim() ?? "",
      });
      match = findingRegex.exec(output);
    }

    return findings;
  }

  /**
   * Convert diff analysis issues to findings.
   */
  private convertDiffIssues(diffResult: DiffReviewResult): ReviewFinding[] {
    return diffResult.issues.map((issue) => ({
      severity:
        issue.severity === "info" ? ("suggestion" as const) : issue.severity,
      filePath: issue.filePath,
      line: issue.line,
      description: issue.description,
      category: "diff_analysis",
    }));
  }

  /**
   * Deduplicate findings that reference the same file, line, and issue.
   */
  private deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
    const seen = new Set<string>();
    const deduped: ReviewFinding[] = [];

    for (const finding of findings) {
      const key = `${finding.filePath}:${finding.line ?? 0}:${finding.description.slice(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(finding);
      }
    }

    // Sort by severity (critical first)
    const severityOrder = {
      critical: 0,
      warning: 1,
      suggestion: 2,
      nitpick: 3,
    };
    deduped.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    );

    return deduped;
  }

  /**
   * Calculate overall quality score.
   */
  private calculateScore(
    diffScore: number,
    criticalCount: number,
    warningCount: number
  ): number {
    let score = diffScore;
    score -= criticalCount * 0.2;
    score -= warningCount * 0.05;
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Determine the review decision based on findings.
   */
  private determineDecision(
    criticalCount: number,
    warningCount: number
  ): "approve" | "request_changes" | "reject" {
    if (criticalCount > 0) {
      return "reject";
    }
    if (warningCount > 3) {
      return "request_changes";
    }
    if (warningCount > 0) {
      return "request_changes";
    }
    return "approve";
  }

  /**
   * Build a human-readable review summary.
   */
  private buildSummary(
    decision: string,
    findings: ReviewFinding[],
    criticalCount: number,
    warningCount: number
  ): string {
    const parts = [`Review decision: ${decision.toUpperCase()}`];

    if (criticalCount > 0) {
      parts.push(
        `${criticalCount} critical issue(s) must be fixed before merge`
      );
    }
    if (warningCount > 0) {
      parts.push(`${warningCount} warning(s) should be addressed`);
    }

    const suggestionCount = findings.filter(
      (f) => f.severity === "suggestion"
    ).length;
    if (suggestionCount > 0) {
      parts.push(`${suggestionCount} suggestion(s) for improvement`);
    }

    if (findings.length === 0) {
      parts.push("No issues found. Code looks good.");
    }

    return parts.join(". ");
  }
}
