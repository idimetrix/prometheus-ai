import * as core from "@actions/core";
import { PrometheusApiClient } from "./api-client";

async function run(): Promise<void> {
  try {
    // Read inputs
    const task = core.getInput("task", { required: true });
    const projectId = core.getInput("project-id", { required: true });
    const apiKey = core.getInput("api-key", { required: true });
    const apiUrl = core.getInput("api-url") || "https://api.prometheus.dev";
    const mode = core.getInput("mode") || "task";
    const timeoutSec = Number.parseInt(core.getInput("timeout") || "600", 10);
    const shouldWait = core.getInput("wait") !== "false";

    core.info(`Triggering Prometheus agent on project ${projectId}`);
    core.info(`Task: ${task}`);
    core.info(`Mode: ${mode}`);
    core.info(`API URL: ${apiUrl}`);

    // Create client and trigger task
    const client = new PrometheusApiClient(apiUrl, apiKey);

    const createResult = await client.createTask({
      projectId,
      description: task,
      mode,
    });

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

      core.setOutput("status", result.status);

      if (result.prUrl) {
        core.setOutput("pr-url", result.prUrl);
        core.info(`PR created: ${result.prUrl}`);
      }

      // Write step summary
      await core.summary
        .addHeading("Prometheus Agent Result")
        .addTable([
          [{ data: "Task ID", header: true }, { data: result.taskId }],
          [{ data: "Session", header: true }, { data: result.sessionId }],
          [{ data: "Status", header: true }, { data: result.status }],
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

      core.info(`Task completed with status: ${result.status}`);
    } else {
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
