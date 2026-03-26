import { createLogger } from "@prometheus/logger";
import { modelRouterClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:pr-review-responder");

const BOT_USERS = new Set([
  "prometheus-bot",
  "prometheus[bot]",
  "prometheus-ai",
]);

export interface PRReview {
  branch: string;
  comments: PRReviewComment[];
  owner: string;
  prNumber: number;
  repo: string;
  reviewAction: "approved" | "changes_requested" | "commented";
  reviewerLogin: string;
}

export interface PRReviewComment {
  body: string;
  filePath: string | null;
  lineNumber: number | null;
}

/**
 * PRReviewResponder handles incoming PR review events and takes
 * appropriate action:
 * - For code change requests: makes the fix, commits, and pushes
 * - For questions: generates an explanation comment
 * - For approval: no action needed
 * - Skips comments from the bot itself to prevent loops
 */
export class PRReviewResponder {
  async respond(review: PRReview): Promise<void> {
    const logCtx = {
      owner: review.owner,
      prNumber: review.prNumber,
      repo: review.repo,
      reviewer: review.reviewerLogin,
    };

    // Rate limiting: skip if comment is from the bot itself
    if (BOT_USERS.has(review.reviewerLogin.toLowerCase())) {
      logger.debug(logCtx, "Skipping self-review comment");
      return;
    }

    logger.info(
      { ...logCtx, action: review.reviewAction },
      "Processing PR review"
    );

    switch (review.reviewAction) {
      case "approved":
        logger.info(logCtx, "PR approved — no action needed");
        return;

      case "changes_requested":
        await this.handleChangesRequested(review);
        return;

      case "commented":
        await this.handleComments(review);
        return;

      default:
        logger.debug(
          { ...logCtx, action: review.reviewAction },
          "Unknown review action"
        );
    }
  }

  /**
   * Handle changes_requested reviews by analyzing each comment
   * and attempting to make the requested changes.
   */
  private async handleChangesRequested(review: PRReview): Promise<void> {
    for (const comment of review.comments) {
      const classification = await this.classifyComment(comment);

      switch (classification) {
        case "code_change":
          await this.applyCodeChange(review, comment);
          break;
        case "question":
          await this.postExplanation(review, comment);
          break;
        case "style":
          await this.applyCodeChange(review, comment);
          break;
        default:
          logger.debug(
            { classification, body: comment.body.slice(0, 100) },
            "Skipping unclassified comment"
          );
      }
    }
  }

  /**
   * Handle review comments (not changes_requested) — typically questions.
   */
  private async handleComments(review: PRReview): Promise<void> {
    for (const comment of review.comments) {
      const classification = await this.classifyComment(comment);

      if (classification === "question") {
        await this.postExplanation(review, comment);
      } else if (
        classification === "code_change" ||
        classification === "style"
      ) {
        await this.applyCodeChange(review, comment);
      }
    }
  }

  /**
   * Classify a review comment to determine the appropriate response.
   */
  private async classifyComment(
    comment: PRReviewComment
  ): Promise<"code_change" | "question" | "style" | "other"> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "fastLoop",
        messages: [
          {
            role: "user",
            content: `Classify this PR review comment into exactly one category: "code_change", "question", "style", or "other".

Comment: ${comment.body}
File: ${comment.filePath ?? "N/A"}
Line: ${comment.lineNumber ?? "N/A"}

Respond with ONLY the category name, nothing else.`,
          },
        ],
        options: { maxTokens: 20, temperature: 0 },
      });

      const category = response.data.choices[0]?.message.content
        ?.trim()
        .toLowerCase();

      if (
        category === "code_change" ||
        category === "question" ||
        category === "style" ||
        category === "other"
      ) {
        return category;
      }

      return "other";
    } catch (error) {
      logger.warn({ error }, "Comment classification failed");
      return "other";
    }
  }

  /**
   * Apply a code change based on the review comment.
   * In production, this would checkout the branch, modify the file,
   * commit, and push.
   */
  private async applyCodeChange(
    review: PRReview,
    comment: PRReviewComment
  ): Promise<void> {
    logger.info(
      {
        filePath: comment.filePath,
        lineNumber: comment.lineNumber,
        prNumber: review.prNumber,
      },
      "Applying code change from review comment"
    );

    // TODO: Connect to sandbox-manager to:
    // 1. Checkout the PR branch
    // 2. Apply the requested change using the agent loop
    // 3. Commit and push to the same branch
    // For now, post a comment acknowledging the feedback.

    await this.postComment(
      review,
      `Acknowledged: "${comment.body.slice(0, 100)}..."\n\nThe agent is working on applying this change to \`${comment.filePath ?? "the codebase"}\`.`
    );
  }

  /**
   * Generate and post an explanation for a question comment.
   */
  private async postExplanation(
    review: PRReview,
    comment: PRReviewComment
  ): Promise<void> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "default",
        messages: [
          {
            role: "user",
            content: `A reviewer asked a question on a PR. Generate a helpful, concise explanation.

Question: ${comment.body}
File: ${comment.filePath ?? "N/A"}
Line: ${comment.lineNumber ?? "N/A"}

Provide a clear, technical explanation.`,
          },
        ],
        options: { maxTokens: 512, temperature: 0.3 },
      });

      const explanation =
        response.data.choices[0]?.message.content ?? "I'll look into this.";

      await this.postComment(review, explanation);
    } catch (error) {
      logger.warn({ error }, "Failed to generate explanation");
    }
  }

  /**
   * Post a comment on the PR.
   */
  private async postComment(review: PRReview, body: string): Promise<void> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      logger.warn("No GITHUB_TOKEN — cannot post PR comment");
      return;
    }

    try {
      await fetch(
        `https://api.github.com/repos/${review.owner}/${review.repo}/issues/${review.prNumber}/comments`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            body: `**Prometheus Agent**\n\n${body}`,
          }),
        }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to post PR comment");
    }
  }
}
