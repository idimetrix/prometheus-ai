/**
 * PR Review Handler
 *
 * Orchestrates the end-to-end flow when a PR review is submitted:
 * 1. Receives the webhook event payload (review comments)
 * 2. Anti-loop: ignores comments from bot users
 * 3. Parses the review to understand requested changes
 * 4. Creates an agent session to address the review
 * 5. The agent reads the review, makes changes in a sandbox
 * 6. Commits and pushes to the same PR branch
 * 7. Posts a reply comment on the PR
 *
 * This handler coordinates between the GitHub webhook (in API) and
 * the PRReviewResponder pipeline (classification + code changes).
 */

import { db, projects, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import {
  type PRReview,
  type PRReviewComment,
  PRReviewResponder,
} from "./pr-review-responder";

const logger = createLogger("orchestrator:pipeline:pr-review-handler");

const BOT_USERS = new Set([
  "prometheus-bot",
  "prometheus[bot]",
  "prometheus-ai",
  "github-actions[bot]",
  "dependabot[bot]",
  "renovate[bot]",
]);

/** Maximum number of comments to process in a single review. */
const MAX_COMMENTS_PER_REVIEW = 20;

/** Cooldown window in ms to avoid processing the same PR too frequently. */
const PR_COOLDOWN_MS = 30_000;

/** Track recent PR processing to enforce cooldown. */
const recentPRProcessing = new Map<string, number>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRReviewWebhookPayload {
  action: "submitted" | "edited" | "dismissed";
  installationId?: number;
  pullRequest: {
    body: string;
    headBranch: string;
    headSha: string;
    number: number;
    title: string;
  };
  repository: {
    cloneUrl: string;
    fullName: string;
    owner: string;
    repo: string;
  };
  review: {
    body: string;
    comments: Array<{
      body: string;
      diffHunk?: string;
      path: string | null;
      position: number | null;
    }>;
    state: "approved" | "changes_requested" | "commented" | "dismissed";
    user: { login: string };
  };
}

export interface PRCommentWebhookPayload {
  action: "created" | "edited";
  comment: {
    body: string;
    diffHunk?: string;
    path: string | null;
    position: number | null;
    user: { login: string };
  };
  pullRequest: {
    body: string;
    headBranch: string;
    headSha: string;
    number: number;
    title: string;
  };
  repository: {
    cloneUrl: string;
    fullName: string;
    owner: string;
    repo: string;
  };
}

// ---------------------------------------------------------------------------
// Helper: find project by repo
// ---------------------------------------------------------------------------

async function findProjectByRepo(
  repoFullName: string
): Promise<{ id: string; orgId: string } | null> {
  const result = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.repoUrl, `https://github.com/${repoFullName}`))
    .limit(1);

  return result[0] ?? null;
}

// ---------------------------------------------------------------------------
// PRReviewHandler
// ---------------------------------------------------------------------------

export class PRReviewHandler {
  private readonly responder = new PRReviewResponder();

  /**
   * Handle a PR review submission event.
   * Called from the GitHub App webhook handler.
   */
  async handleReviewSubmitted(
    payload: PRReviewWebhookPayload
  ): Promise<{ sessionId: string; taskId: string } | null> {
    const { review, pullRequest, repository } = payload;
    const prKey = `${repository.fullName}#${pullRequest.number}`;

    // Anti-loop: ignore reviews from bot users
    if (BOT_USERS.has(review.user.login.toLowerCase())) {
      logger.debug(
        { prKey, reviewer: review.user.login },
        "Ignoring review from bot user"
      );
      return null;
    }

    // Ignore approved reviews (no action needed)
    if (review.state === "approved" || review.state === "dismissed") {
      logger.info(
        { prKey, state: review.state },
        "Review state requires no action"
      );
      return null;
    }

    // Cooldown check to prevent rapid re-processing
    const lastProcessed = recentPRProcessing.get(prKey);
    if (lastProcessed && Date.now() - lastProcessed < PR_COOLDOWN_MS) {
      logger.debug(
        { prKey },
        "PR review processed recently, skipping (cooldown)"
      );
      return null;
    }
    recentPRProcessing.set(prKey, Date.now());

    // Clean up old cooldown entries
    if (recentPRProcessing.size > 1000) {
      const cutoff = Date.now() - PR_COOLDOWN_MS * 2;
      for (const [key, ts] of recentPRProcessing) {
        if (ts < cutoff) {
          recentPRProcessing.delete(key);
        }
      }
    }

    logger.info(
      {
        prKey,
        state: review.state,
        commentCount: review.comments.length,
        reviewer: review.user.login,
      },
      "Processing PR review"
    );

    // Find the project for this repo
    const project = await findProjectByRepo(repository.fullName);
    if (!project) {
      logger.warn(
        { repo: repository.fullName },
        "No project found for repository"
      );
      return null;
    }

    // Build review comments (limit to MAX_COMMENTS_PER_REVIEW)
    const comments: PRReviewComment[] = review.comments
      .slice(0, MAX_COMMENTS_PER_REVIEW)
      .map((c) => ({
        body: c.body,
        filePath: c.path,
        lineNumber: c.position,
      }));

    // Include the review body as a comment if present
    if (review.body.trim()) {
      comments.unshift({
        body: review.body,
        filePath: null,
        lineNumber: null,
      });
    }

    if (comments.length === 0) {
      logger.debug({ prKey }, "No comments to process in review");
      return null;
    }

    // Build the task description
    const commentSummary = comments
      .map((c) => {
        const loc = c.filePath ? ` (${c.filePath}:${c.lineNumber ?? "?"})` : "";
        return `- ${c.body.slice(0, 200)}${loc}`;
      })
      .join("\n");

    const taskDescription = [
      `Address PR review comments on PR #${pullRequest.number}: ${pullRequest.title}`,
      `\nReviewer: ${review.user.login}`,
      `Review state: ${review.state}`,
      `Branch: ${pullRequest.headBranch}`,
      `Repository: ${repository.fullName}`,
      `\nComments to address:\n${commentSummary}`,
      "\nInstructions:",
      `1. Checkout branch: ${pullRequest.headBranch}`,
      "2. Address each review comment by making the requested changes",
      "3. Run linting and tests to verify changes",
      "4. Commit and push changes to the same branch",
      "5. Post a reply comment on the PR acknowledging the changes",
    ].join("\n");

    // Create a session and task for the agent
    const taskId = generateId("task");
    const sessionId = generateId("ses");

    await db.insert(sessions).values({
      id: sessionId,
      projectId: project.id,
      userId: project.orgId,
      status: "active",
      mode: "task",
    });

    await db.insert(tasks).values({
      id: taskId,
      sessionId,
      projectId: project.id,
      orgId: project.orgId,
      title: `PR review: ${pullRequest.title} (#${pullRequest.number})`,
      description: taskDescription,
      status: "queued",
      priority: 70, // Higher priority for review responses
    });

    // Enqueue the agent task
    await agentTaskQueue.add(`pr-review-${pullRequest.number}-${Date.now()}`, {
      taskId,
      sessionId,
      projectId: project.id,
      orgId: project.orgId,
      userId: project.orgId,
      title: `Address review for PR #${pullRequest.number}`,
      description: taskDescription,
      mode: "task",
      agentRole: "security_auditor",
      creditsReserved: 150,
      planTier: "pro",
    });

    // Kick off the responder in parallel (classification + immediate responses)
    const reviewData: PRReview = {
      owner: repository.owner,
      repo: repository.repo,
      prNumber: pullRequest.number,
      branch: pullRequest.headBranch,
      reviewerLogin: review.user.login,
      reviewAction: review.state as
        | "approved"
        | "changes_requested"
        | "commented",
      comments,
    };

    this.responder.respond(reviewData).catch((err) => {
      logger.error({ error: String(err), prKey }, "PR review responder failed");
    });

    logger.info(
      { taskId, sessionId, prKey },
      "Agent session created for PR review"
    );

    return { sessionId, taskId };
  }

  /**
   * Handle an individual PR review comment event.
   * Called when a single inline comment is posted (not part of a full review).
   */
  async handleReviewComment(
    payload: PRCommentWebhookPayload
  ): Promise<{ sessionId: string; taskId: string } | null> {
    const { comment, pullRequest, repository } = payload;
    const prKey = `${repository.fullName}#${pullRequest.number}`;

    // Anti-loop: ignore comments from bot users
    if (BOT_USERS.has(comment.user.login.toLowerCase())) {
      logger.debug(
        { prKey, commenter: comment.user.login },
        "Ignoring comment from bot user"
      );
      return null;
    }

    logger.info(
      {
        prKey,
        commenter: comment.user.login,
        path: comment.path,
      },
      "Processing individual PR review comment"
    );

    // Convert single comment into a review submission payload
    return await this.handleReviewSubmitted({
      action: "submitted",
      installationId: undefined,
      pullRequest: payload.pullRequest,
      repository: payload.repository,
      review: {
        body: "",
        comments: [
          {
            body: comment.body,
            path: comment.path,
            position: comment.position,
            diffHunk: comment.diffHunk,
          },
        ],
        state: "commented",
        user: comment.user,
      },
    });
  }
}

/** Singleton instance for use across the orchestrator. */
export const prReviewHandler = new PRReviewHandler();
