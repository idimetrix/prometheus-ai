import type { ApiClient } from "../api-client";

interface ReviewFinding {
  endLine: number;
  filePath: string;
  message: string;
  severity: "critical" | "warning" | "info";
  startLine: number;
  suggestion?: string;
}

interface ReviewResult {
  findings: ReviewFinding[];
  summary: string;
}

/**
 * Fetches PR diffs and runs security + quality analysis, then posts
 * inline review comments back to the PR.
 */
export class PRReviewer {
  private readonly apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Review a pull request by number. Fetches the diff and runs
   * analysis via the Prometheus API.
   */
  async reviewPR(prNumber: number): Promise<ReviewResult> {
    const result = await this.apiClient.assignTask(
      `Review pull request #${prNumber}: analyze for security issues, code quality, and best practices.`
    );

    // The actual review findings would come from the streaming response.
    // For the structured result, we return a placeholder that the
    // streaming handler would populate.
    return {
      summary: `Review initiated for PR #${prNumber} (task: ${result.taskId})`,
      findings: [],
    };
  }

  /**
   * Post review findings as inline comments on the PR.
   * Maps each finding to a specific file + line for inline display.
   */
  async postComments(
    prNumber: number,
    findings: ReviewFinding[]
  ): Promise<number> {
    if (findings.length === 0) {
      return 0;
    }

    const comments = findings.map((f) => ({
      path: f.filePath,
      line: f.startLine,
      body: this.formatComment(f),
    }));

    await this.apiClient.assignTask(
      `Post ${comments.length} review comments on PR #${prNumber}: ${JSON.stringify(comments)}`
    );

    return comments.length;
  }

  private formatComment(finding: ReviewFinding): string {
    let severityLabel = "Info";
    if (finding.severity === "critical") {
      severityLabel = "CRITICAL";
    } else if (finding.severity === "warning") {
      severityLabel = "Warning";
    }

    let comment = `**[${severityLabel}]** ${finding.message}`;
    if (finding.suggestion) {
      comment += `\n\n**Suggestion:** ${finding.suggestion}`;
    }
    return comment;
  }
}

export type { ReviewFinding, ReviewResult };
