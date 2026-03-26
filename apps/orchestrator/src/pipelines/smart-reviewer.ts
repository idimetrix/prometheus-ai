/**
 * Smart Code Reviewer (MOON-012)
 *
 * AI code reviewer that learns team preferences.
 * 1. Loads team's coding conventions from memory
 * 2. Loads past review comments and their resolutions
 * 3. Analyzes the diff for:
 *    - Style consistency
 *    - Performance issues
 *    - Security vulnerabilities
 *    - Missing tests
 *    - Documentation gaps
 *    - Naming conventions
 * 4. Generates review with categorized comments
 * 5. Learns from accepted/rejected review suggestions
 */

import { createLogger } from "@prometheus/logger";
import { modelRouterClient, projectBrainClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:smart-reviewer");

const _JSON_OBJECT_RE = /\{[\s\S]*\}/;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewCommentCategory =
  | "style"
  | "performance"
  | "security"
  | "testing"
  | "documentation"
  | "naming"
  | "logic";

export type ReviewCommentSeverity =
  | "critical"
  | "major"
  | "minor"
  | "suggestion";

export type ReviewVerdict = "approve" | "request_changes" | "comment";

export interface ReviewComment {
  /** The category of the comment */
  category: ReviewCommentCategory;
  /** The file the comment applies to */
  file: string;
  /** The line number */
  line: number;
  /** The review comment */
  message: string;
  /** Severity of the issue */
  severity: ReviewCommentSeverity;
  /** Optional suggested fix */
  suggestedFix?: string;
}

export interface ReviewInput {
  /** The diff to review */
  diff: string;
  /** Full file contents for context */
  files: Array<{ content: string; path: string }>;
  /** PR body/description */
  prBody: string;
  /** The Prometheus project ID */
  projectId: string;
  /** PR title */
  prTitle: string;
}

export interface ReviewResult {
  /** Categorized review comments */
  comments: ReviewComment[];
  /** Overall quality score (0-100) */
  overallScore: number;
  /** Summary of the review */
  summary: string;
  /** Review verdict */
  verdict: ReviewVerdict;
}

interface TeamConventions {
  namingConventions: string[];
  preferredPatterns: string[];
  reviewHistory: Array<{
    accepted: boolean;
    category: string;
    comment: string;
  }>;
  styleRules: string[];
}

interface ReviewFeedback {
  /** Whether the comment was accepted */
  accepted: boolean;
  /** The original comment ID or index */
  commentIndex: number;
  /** The project ID */
  projectId: string;
}

// ---------------------------------------------------------------------------
// Reviewer
// ---------------------------------------------------------------------------

export class SmartCodeReviewer {
  /**
   * Review code changes with team-specific knowledge.
   */
  async review(options: ReviewInput): Promise<ReviewResult> {
    const logCtx = { projectId: options.projectId };

    logger.info(
      { ...logCtx, files: options.files.length },
      "Starting smart code review"
    );

    try {
      // Step 1: Load team conventions and review history
      const conventions = await this.loadTeamConventions(options.projectId);
      logger.info(
        {
          ...logCtx,
          styleRules: conventions.styleRules.length,
          reviewHistory: conventions.reviewHistory.length,
        },
        "Team conventions loaded"
      );

      // Step 2: Analyze the diff across multiple dimensions
      const comments = await this.analyzeDiff(options, conventions);
      logger.info(
        { ...logCtx, comments: comments.length },
        "Diff analysis complete"
      );

      // Step 3: Filter based on past review acceptance patterns
      const filteredComments = this.filterByHistory(
        comments,
        conventions.reviewHistory
      );

      // Step 4: Calculate overall score and verdict
      const overallScore = this.calculateScore(filteredComments);
      const verdict = this.determineVerdict(filteredComments, overallScore);

      // Step 5: Generate summary
      const summary = this.generateSummary(
        filteredComments,
        overallScore,
        verdict
      );

      logger.info(
        {
          ...logCtx,
          overallScore,
          verdict,
          commentCount: filteredComments.length,
        },
        "Code review complete"
      );

      return {
        overallScore,
        verdict,
        comments: filteredComments,
        summary,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ ...logCtx, error: msg }, "Smart review failed");

      return {
        overallScore: 50,
        verdict: "comment",
        comments: [],
        summary: `Review failed: ${msg}`,
      };
    }
  }

  /**
   * Record feedback on a review comment to improve future reviews.
   */
  async recordFeedback(feedback: ReviewFeedback): Promise<void> {
    try {
      await projectBrainClient.post(
        `/api/projects/${feedback.projectId}/review-feedback`,
        {
          commentIndex: feedback.commentIndex,
          accepted: feedback.accepted,
        }
      );

      logger.info(
        {
          projectId: feedback.projectId,
          accepted: feedback.accepted,
        },
        "Review feedback recorded"
      );
    } catch (error) {
      logger.warn({ error }, "Failed to record review feedback");
    }
  }

  // -------------------------------------------------------------------------
  // Step implementations
  // -------------------------------------------------------------------------

  /**
   * Load team coding conventions and past review history.
   */
  private async loadTeamConventions(
    projectId: string
  ): Promise<TeamConventions> {
    const defaults: TeamConventions = {
      styleRules: [],
      namingConventions: [],
      preferredPatterns: [],
      reviewHistory: [],
    };

    try {
      const response = await projectBrainClient.get<TeamConventions>(
        `/api/projects/${projectId}/conventions`
      );
      return response.data;
    } catch {
      logger.info({ projectId }, "No team conventions found, using defaults");
      return defaults;
    }
  }

  /**
   * Analyze the diff across multiple dimensions using the LLM.
   */
  private async analyzeDiff(
    options: ReviewInput,
    conventions: TeamConventions
  ): Promise<ReviewComment[]> {
    const allComments: ReviewComment[] = [];

    // Run multiple analysis passes in parallel
    const [styleComments, securityComments, logicComments] = await Promise.all([
      this.analyzeStyle(options, conventions),
      this.analyzeSecurity(options),
      this.analyzeLogic(options),
    ]);

    allComments.push(...styleComments);
    allComments.push(...securityComments);
    allComments.push(...logicComments);

    // Sort by severity (critical first)
    const severityOrder: Record<ReviewCommentSeverity, number> = {
      critical: 0,
      major: 1,
      minor: 2,
      suggestion: 3,
    };
    allComments.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    );

    return allComments;
  }

  /**
   * Analyze style, naming, and documentation.
   */
  private async analyzeStyle(
    options: ReviewInput,
    conventions: TeamConventions
  ): Promise<ReviewComment[]> {
    try {
      const conventionContext =
        conventions.styleRules.length > 0
          ? `Team style rules:\n${conventions.styleRules.join("\n")}\n\nNaming conventions:\n${conventions.namingConventions.join("\n")}`
          : "No specific team conventions loaded — use general best practices.";

      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Review this code diff for style, naming, and documentation issues.

PR: ${options.prTitle}
Description: ${options.prBody.slice(0, 500)}

${conventionContext}

Diff:
${options.diff.slice(0, 6000)}

For each issue found, output a JSON array of objects with:
- "file": string
- "line": number (approximate)
- "category": "style" | "naming" | "documentation"
- "severity": "minor" | "suggestion"
- "message": string
- "suggestedFix": string (optional)

Output ONLY the JSON array. If no issues, output [].`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.2 },
      });

      return this.parseComments(response.data.choices[0]?.message.content);
    } catch (error) {
      logger.warn({ error }, "Style analysis failed");
      return [];
    }
  }

  /**
   * Analyze for security vulnerabilities.
   */
  private async analyzeSecurity(
    options: ReviewInput
  ): Promise<ReviewComment[]> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Review this code diff for security vulnerabilities.

Check for:
- SQL injection
- XSS (cross-site scripting)
- CSRF
- Authentication/authorization issues
- Secret exposure
- Insecure dependencies
- Input validation gaps
- Race conditions

Diff:
${options.diff.slice(0, 6000)}

Files:
${options.files
  .slice(0, 5)
  .map((f) => `### ${f.path}\n${f.content.slice(0, 1000)}`)
  .join("\n\n")}

For each issue, output a JSON array of objects with:
- "file": string
- "line": number
- "category": "security"
- "severity": "critical" | "major" | "minor"
- "message": string
- "suggestedFix": string (optional)

Output ONLY the JSON array. If no issues, output [].`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.1 },
      });

      return this.parseComments(response.data.choices[0]?.message.content);
    } catch (error) {
      logger.warn({ error }, "Security analysis failed");
      return [];
    }
  }

  /**
   * Analyze for logic issues, performance, and missing tests.
   */
  private async analyzeLogic(options: ReviewInput): Promise<ReviewComment[]> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Review this code diff for logic issues, performance problems, and missing tests.

Check for:
- Logic errors (off-by-one, null checks, edge cases)
- Performance issues (N+1 queries, unnecessary iterations, memory leaks)
- Missing error handling
- Missing test coverage for new code
- Race conditions in async code

PR: ${options.prTitle}
Description: ${options.prBody.slice(0, 500)}

Diff:
${options.diff.slice(0, 6000)}

For each issue, output a JSON array of objects with:
- "file": string
- "line": number
- "category": "logic" | "performance" | "testing"
- "severity": "critical" | "major" | "minor" | "suggestion"
- "message": string
- "suggestedFix": string (optional)

Output ONLY the JSON array. If no issues, output [].`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.2 },
      });

      return this.parseComments(response.data.choices[0]?.message.content);
    } catch (error) {
      logger.warn({ error }, "Logic analysis failed");
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Parse LLM response into review comments.
   */
  private parseComments(content?: string): ReviewComment[] {
    if (!content) {
      return [];
    }

    try {
      const jsonMatch = content.match(JSON_ARRAY_RE);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ReviewComment[];
        return parsed.filter(
          (c) => c.file && c.message && c.category && c.severity
        );
      }
    } catch {
      logger.warn("Failed to parse review comments from LLM response");
    }

    return [];
  }

  /**
   * Filter comments based on past review acceptance patterns.
   * Demotes comments that are frequently rejected by the team.
   */
  private filterByHistory(
    comments: ReviewComment[],
    history: TeamConventions["reviewHistory"]
  ): ReviewComment[] {
    if (history.length === 0) {
      return comments;
    }

    // Calculate acceptance rate per category
    const categoryStats = new Map<
      string,
      { accepted: number; total: number }
    >();

    for (const item of history) {
      const stats = categoryStats.get(item.category) ?? {
        accepted: 0,
        total: 0,
      };
      stats.total += 1;
      if (item.accepted) {
        stats.accepted += 1;
      }
      categoryStats.set(item.category, stats);
    }

    // Filter out comments from categories with low acceptance rate
    return comments.filter((comment) => {
      const stats = categoryStats.get(comment.category);
      if (!stats || stats.total < 5) {
        // Not enough data — keep the comment
        return true;
      }

      const acceptanceRate = stats.accepted / stats.total;

      // Drop suggestions from categories rejected > 80% of the time
      if (comment.severity === "suggestion" && acceptanceRate < 0.2) {
        return false;
      }

      return true;
    });
  }

  /**
   * Calculate an overall quality score from the comments.
   */
  private calculateScore(comments: ReviewComment[]): number {
    const maxScore = 100;
    let deductions = 0;

    const severityPenalties: Record<ReviewCommentSeverity, number> = {
      critical: 25,
      major: 15,
      minor: 5,
      suggestion: 1,
    };

    for (const comment of comments) {
      deductions += severityPenalties[comment.severity];
    }

    return Math.max(0, maxScore - deductions);
  }

  /**
   * Determine the review verdict based on comments and score.
   */
  private determineVerdict(
    comments: ReviewComment[],
    score: number
  ): ReviewVerdict {
    const hasCritical = comments.some((c) => c.severity === "critical");
    const hasMajor = comments.some((c) => c.severity === "major");

    if (hasCritical) {
      return "request_changes";
    }

    if (hasMajor || score < 60) {
      return "request_changes";
    }

    if (score >= 85) {
      return "approve";
    }

    return "comment";
  }

  /**
   * Generate a human-readable summary of the review.
   */
  private generateSummary(
    comments: ReviewComment[],
    score: number,
    verdict: ReviewVerdict
  ): string {
    if (comments.length === 0) {
      return "No issues found. The code looks clean and well-structured.";
    }

    const bySeverity = {
      critical: comments.filter((c) => c.severity === "critical").length,
      major: comments.filter((c) => c.severity === "major").length,
      minor: comments.filter((c) => c.severity === "minor").length,
      suggestion: comments.filter((c) => c.severity === "suggestion").length,
    };

    const byCategory = new Map<string, number>();
    for (const c of comments) {
      byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
    }

    const lines: string[] = [
      `Score: ${score}/100 | Verdict: ${verdict.replace("_", " ")}`,
      "",
      `Found ${comments.length} issue(s):`,
    ];

    if (bySeverity.critical > 0) {
      lines.push(`  - ${bySeverity.critical} critical`);
    }
    if (bySeverity.major > 0) {
      lines.push(`  - ${bySeverity.major} major`);
    }
    if (bySeverity.minor > 0) {
      lines.push(`  - ${bySeverity.minor} minor`);
    }
    if (bySeverity.suggestion > 0) {
      lines.push(`  - ${bySeverity.suggestion} suggestion(s)`);
    }

    lines.push("");
    lines.push("By category:");
    for (const [category, count] of byCategory) {
      lines.push(`  - ${category}: ${count}`);
    }

    return lines.join("\n");
  }
}
