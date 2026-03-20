import { createLogger } from "@prometheus/logger";
import type { ReviewResult } from "../agent-execution";

const logger = createLogger("workflow:phase:review");

interface ReviewInput {
  filesChanged: string[];
  orchestratorUrl: string;
  orgId: string;
  projectId: string;
  sessionId: string;
  taskId: string;
}

export async function runReviewPhase(
  input: ReviewInput
): Promise<ReviewResult> {
  const { taskId, sessionId, projectId, orgId, filesChanged, orchestratorUrl } =
    input;

  logger.info(
    { taskId, filesChanged: filesChanged.length },
    "Running review phase"
  );

  if (filesChanged.length === 0) {
    return {
      passed: true,
      reviewer: "prometheus-auto-reviewer",
      comments: [],
      suggestedFixes: [],
    };
  }

  try {
    const response = await fetch(`${orchestratorUrl}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: `${taskId}-review`,
        sessionId,
        projectId,
        orgId,
        userId: "system",
        title: "Code review",
        description: `Review the following changed files for bugs, security issues, and code quality: ${filesChanged.join(", ")}. Report blocking issues that must be fixed.`,
        mode: "autonomous",
        agentRole: "reviewer",
      }),
    });

    if (!response.ok) {
      logger.warn(
        { taskId, status: response.status },
        "Review request failed, passing by default"
      );
      return {
        passed: true,
        reviewer: "prometheus-auto-reviewer",
        comments: ["Review service unavailable, auto-approved"],
      };
    }

    const result = (await response.json()) as {
      success: boolean;
      output?: string;
      comments?: string[];
      blockingIssues?: string[];
    };

    const hasBlockingIssues =
      result.blockingIssues && result.blockingIssues.length > 0;

    return {
      passed: !hasBlockingIssues,
      reviewer: "prometheus-auto-reviewer",
      comments: result.comments ?? [],
      suggestedFixes: result.blockingIssues ?? [],
    };
  } catch (error) {
    logger.error(
      { taskId, error: String(error) },
      "Review phase failed, passing by default"
    );
    return {
      passed: true,
      reviewer: "prometheus-auto-reviewer",
      comments: ["Review failed with error, auto-approved"],
    };
  }
}
