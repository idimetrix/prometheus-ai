import * as core from "@actions/core";
import * as github from "@actions/github";
import { PrometheusApiClient } from "./api-client";

const PR_NUMBER_RE = /\/pull\/(\d+)/;

/**
 * Extract a task description from a GitHub issue event payload.
 * Returns the issue title + body, or null if the event is not an issue event.
 */
function extractTaskFromIssueEvent(
  context: typeof github.context,
  taskLabel: string
): string | null {
  const eventName = context.eventName;

  if (eventName !== "issues") {
    return null;
  }

  const payload = context.payload;
  const action = payload.action;
  const issue = payload.issue;

  if (!issue) {
    return null;
  }

  // Only trigger on issue opened or labeled
  if (action !== "opened" && action !== "labeled") {
    return null;
  }

  // Check if the issue has the required label
  const labels = (issue.labels ?? []) as Array<{ name: string }>;
  const hasLabel = labels.some(
    (l) => l.name.toLowerCase() === taskLabel.toLowerCase()
  );

  if (!hasLabel) {
    core.info(
      `Issue #${issue.number} does not have the "${taskLabel}" label, skipping.`
    );
    return null;
  }

  const title = issue.title ?? "Untitled issue";
  const body = issue.body ?? "";
  return `GitHub Issue #${issue.number}: ${title}\n\n${body}`;
}

/**
 * Comment on a GitHub issue with the result of the Prometheus agent task.
 */
async function commentOnIssue(
  issueNumber: number,
  message: string
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    core.warning("GITHUB_TOKEN not available, cannot comment on issue.");
    return;
  }

  const octokit = github.getOctokit(token);
  const context = github.context;

  await octokit.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    body: message,
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: GitHub Action entry point handles inputs, retries, polling, and summary generation
async function run(): Promise<void> {
  try {
    // Read inputs
    const taskLabel = core.getInput("task-label") || "prometheus";
    const context = github.context;

    // Determine task description: from input or from issue event
    const issueTask = extractTaskFromIssueEvent(context, taskLabel);
    const inputTask = core.getInput("task");
    const task = inputTask || issueTask;

    if (!task) {
      core.info(
        "No task provided and no matching issue event detected. Skipping."
      );
      return;
    }

    const projectId = core.getInput("project-id", { required: true });
    const apiKey = core.getInput("api-key", { required: true });
    const apiUrl = core.getInput("api-url") || "https://api.prometheus.dev";
    const mode = core.getInput("mode") || "task";
    const timeoutSec = Number.parseInt(core.getInput("timeout") || "600", 10);
    const shouldWait = core.getInput("wait") !== "false";
    const branch = core.getInput("branch") || "";
    const labels = core.getInput("labels") || "prometheus-ai";
    const maxRetries = Number.parseInt(core.getInput("max-retries") || "3", 10);
    const logLevel = core.getInput("log-level") || "info";

    if (logLevel === "debug") {
      core.debug(`Task: ${task}`);
      core.debug(`Project: ${projectId}`);
      core.debug(`Mode: ${mode}`);
      core.debug(`API URL: ${apiUrl}`);
      core.debug(`Timeout: ${timeoutSec}s`);
      core.debug(`Branch: ${branch || "(auto)"}`);
      core.debug(`Labels: ${labels}`);
      core.debug(`Max retries: ${maxRetries}`);
    }

    core.info(`Triggering Prometheus agent on project ${projectId}`);
    core.info(`Task: ${task}`);
    core.info(`Mode: ${mode}`);
    core.info(`API URL: ${apiUrl}`);

    // Gather context from the GitHub event
    const repoFullName = `${context.repo.owner}/${context.repo.repo}`;

    // Create client and trigger task with retries
    const client = new PrometheusApiClient(apiUrl, apiKey);
    const startTime = Date.now();

    let createResult: Awaited<ReturnType<typeof client.createTask>> | undefined;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        createResult = await client.createTask({
          projectId,
          description: task,
          mode,
          branch: branch || undefined,
          labels: labels ? labels.split(",").map((l) => l.trim()) : undefined,
          repo: repoFullName,
          sha: context.sha,
          ref: context.ref,
        });
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** attempt, 10_000);
          core.warning(
            `Attempt ${attempt}/${maxRetries} failed: ${lastError.message}. Retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (!createResult) {
      throw lastError || new Error("Failed to create task after retries");
    }

    core.info(`Task created: ${createResult.taskId}`);
    core.info(`Session: ${createResult.sessionId}`);

    // Set outputs immediately
    core.setOutput("task-id", createResult.taskId);
    core.setOutput("session-id", createResult.sessionId);
    core.setOutput("status", createResult.status);

    // If wait is enabled, poll until completion
    if (shouldWait) {
      core.info(`Waiting for task completion (timeout: ${timeoutSec}s)...`);

      const result = await client.pollUntilComplete(
        createResult.taskId,
        timeoutSec * 1000
      );

      const durationSec = Math.round((Date.now() - startTime) / 1000);

      core.setOutput("status", result.status);
      core.setOutput("duration", String(durationSec));
      core.setOutput("result-json", JSON.stringify(result));

      if (result.prUrl) {
        core.setOutput("pr-url", result.prUrl);
        // Extract PR number from URL
        const prMatch = result.prUrl.match(PR_NUMBER_RE);
        if (prMatch) {
          core.setOutput("pr-number", prMatch[1]);
        }
        core.info(`PR created: ${result.prUrl}`);
      }

      // Write step summary
      await core.summary
        .addHeading("Prometheus Agent Result")
        .addTable([
          [{ data: "Task ID", header: true }, { data: result.taskId }],
          [{ data: "Session", header: true }, { data: result.sessionId }],
          [{ data: "Status", header: true }, { data: result.status }],
          [{ data: "Duration", header: true }, { data: `${durationSec}s` }],
          ...(result.prUrl
            ? [[{ data: "PR URL", header: true }, { data: result.prUrl }]]
            : []),
          ...(result.completedAt
            ? [
                [
                  { data: "Completed", header: true },
                  { data: result.completedAt },
                ],
              ]
            : []),
        ])
        .write();

      if (result.status === "failed" || result.status === "error") {
        core.setFailed(
          `Task ${result.status}: ${JSON.stringify(result.result)}`
        );
        return;
      }

      // If triggered from an issue event, comment back on the issue
      const issuePayload = context.payload.issue as
        | { number: number }
        | undefined;
      if (issuePayload) {
        const prInfo = result.prUrl ? `\n\nPR: ${result.prUrl}` : "";
        const statusEmoji =
          result.status === "completed" ? "white_check_mark" : "x";
        const comment = [
          `## :${statusEmoji}: Prometheus Agent Result`,
          "",
          `**Status:** ${result.status}`,
          `**Duration:** ${durationSec}s`,
          `**Task ID:** \`${result.taskId}\``,
          prInfo,
        ].join("\n");

        try {
          await commentOnIssue(issuePayload.number, comment);
          core.info(`Commented on issue #${issuePayload.number}`);
        } catch (commentErr) {
          const errMsg =
            commentErr instanceof Error
              ? commentErr.message
              : String(commentErr);
          core.warning(`Failed to comment on issue: ${errMsg}`);
        }
      }

      core.info(`Task completed with status: ${result.status}`);
    } else {
      const durationSec = Math.round((Date.now() - startTime) / 1000);
      core.setOutput("duration", String(durationSec));
      core.setOutput("result-json", JSON.stringify(createResult));

      // Write a minimal summary
      await core.summary
        .addHeading("Prometheus Agent Triggered")
        .addTable([
          [{ data: "Task ID", header: true }, { data: createResult.taskId }],
          [{ data: "Session", header: true }, { data: createResult.sessionId }],
          [{ data: "Status", header: true }, { data: "queued (not waiting)" }],
        ])
        .write();

      core.info("Task queued successfully (not waiting for completion).");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

run();
