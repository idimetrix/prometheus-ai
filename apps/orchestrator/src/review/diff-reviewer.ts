import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:review:diff");

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

const REVIEW_SCORE_RE = /SCORE:\s*([\d.]+)/;
const REVIEW_SUMMARY_RE = /SUMMARY:\s*(.+?)(?:\n|$)/;
const REVIEW_ISSUE_RE = /\[(CRITICAL|WARNING|INFO)\]\s*(.+?)(?:\n|$)/gi;
const REVIEW_FILE_LINE_RE = /^(\S+):(\d+)\s+(.*)/;

export interface DiffHunk {
  added: string[];
  context: string[];
  endLine: number;
  filePath: string;
  removed: string[];
  startLine: number;
}

export interface DiffReviewResult {
  hunks: number;
  issues: Array<{
    filePath: string;
    severity: "critical" | "warning" | "info";
    description: string;
    line?: number;
  }>;
  score: number;
  summary: string;
}

const DIFF_FILE_HEADER_RE = /^diff --git a\/.+ b\/(.+)$/;
const DIFF_HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * DiffReviewer analyzes actual git diffs to catch bugs, style issues,
 * and security problems that text-only review would miss.
 */
export class DiffReviewer {
  /**
   * Review a unified diff and return structured feedback.
   */
  async review(
    diff: string,
    taskDescription: string
  ): Promise<DiffReviewResult> {
    if (!diff || diff.trim().length === 0) {
      return {
        score: 1.0,
        summary: "No changes to review",
        issues: [],
        hunks: 0,
      };
    }

    const hunks = this.parseDiff(diff);

    if (hunks.length === 0) {
      return {
        score: 1.0,
        summary: "No code hunks found",
        issues: [],
        hunks: 0,
      };
    }

    // Send diff to review model for analysis
    const reviewResult = await this.llmReview(hunks, taskDescription);

    logger.info(
      {
        hunks: hunks.length,
        issues: reviewResult.issues.length,
        score: reviewResult.score,
      },
      "Diff review complete"
    );

    return reviewResult;
  }

  /**
   * Parse a unified diff into structured hunks.
   */
  parseDiff(diff: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = diff.split("\n");
    let currentFile = "";
    let currentHunk: DiffHunk | null = null;

    for (const line of lines) {
      const result = this.parseDiffLine(line, currentFile, currentHunk, hunks);
      currentFile = result.currentFile;
      currentHunk = result.currentHunk;
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  private parseDiffLine(
    line: string,
    currentFile: string,
    currentHunk: DiffHunk | null,
    hunks: DiffHunk[]
  ): { currentFile: string; currentHunk: DiffHunk | null } {
    const fileMatch = line.match(DIFF_FILE_HEADER_RE);
    if (fileMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      return { currentFile: fileMatch[1] ?? "", currentHunk: null };
    }

    const hunkMatch = line.match(DIFF_HUNK_HEADER_RE);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      return {
        currentFile,
        currentHunk: {
          filePath: currentFile,
          startLine: Number.parseInt(hunkMatch[1] ?? "0", 10),
          endLine: 0,
          added: [],
          removed: [],
          context: [],
        },
      };
    }

    if (currentHunk) {
      this.classifyDiffContent(line, currentHunk);
    }

    return { currentFile, currentHunk };
  }

  private classifyDiffContent(line: string, hunk: DiffHunk): void {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      hunk.added.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      hunk.removed.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      hunk.context.push(line.slice(1));
    }
  }

  private async llmReview(
    hunks: DiffHunk[],
    taskDescription: string
  ): Promise<DiffReviewResult> {
    // Format hunks for review
    const formattedHunks = hunks
      .slice(0, 20)
      .map((h, i) => {
        const removed =
          h.removed.length > 0
            ? `Removed:\n${h.removed
                .slice(0, 10)
                .map((l) => `- ${l}`)
                .join("\n")}`
            : "";
        const added =
          h.added.length > 0
            ? `Added:\n${h.added
                .slice(0, 10)
                .map((l) => `+ ${l}`)
                .join("\n")}`
            : "";
        return `### Hunk ${i + 1}: ${h.filePath} (line ${h.startLine})\n${removed}\n${added}`;
      })
      .join("\n\n");

    try {
      const response = await fetch(`${MODEL_ROUTER_URL}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: "review",
          messages: [
            {
              role: "user",
              content: `Review these code changes for bugs, security issues, and style problems.

Task: ${taskDescription}

${formattedHunks}

Respond with:
SCORE: <0.0-1.0 overall quality>
SUMMARY: <one line summary>
ISSUES:
- [CRITICAL|WARNING|INFO] <file>:<line> <description>

If there are no issues, respond with SCORE: 1.0 and no ISSUES section.`,
            },
          ],
          options: { maxTokens: 2048, temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        const content = data.choices[0]?.message.content ?? "";
        return this.parseReviewOutput(content, hunks.length);
      }
    } catch (err) {
      logger.warn({ error: err }, "LLM diff review failed");
    }

    return {
      score: 0.7,
      summary: "Review unavailable",
      issues: [],
      hunks: hunks.length,
    };
  }

  private parseReviewOutput(
    output: string,
    hunkCount: number
  ): DiffReviewResult {
    const scoreMatch = output.match(REVIEW_SCORE_RE);
    const score = scoreMatch
      ? Math.min(1, Math.max(0, Number.parseFloat(scoreMatch[1] ?? "0.7")))
      : 0.7;

    const summaryMatch = output.match(REVIEW_SUMMARY_RE);
    const summary = summaryMatch?.[1]?.trim() ?? "Review completed";

    const issues: DiffReviewResult["issues"] = [];
    REVIEW_ISSUE_RE.lastIndex = 0;
    const issueMatches = output.matchAll(REVIEW_ISSUE_RE);
    for (const match of issueMatches) {
      const severity = (match[1]?.toLowerCase() ?? "info") as
        | "critical"
        | "warning"
        | "info";
      const desc = match[2]?.trim() ?? "";
      const fileMatch = desc.match(REVIEW_FILE_LINE_RE);
      if (fileMatch) {
        issues.push({
          filePath: fileMatch[1] ?? "",
          line: Number.parseInt(fileMatch[2] ?? "0", 10),
          severity,
          description: fileMatch[3] ?? desc,
        });
      } else {
        issues.push({ filePath: "", severity, description: desc });
      }
    }

    return { score, summary, issues, hunks: hunkCount };
  }
}
