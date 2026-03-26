/**
 * GitHub Action entry point for Prometheus CLI.
 * Reads inputs from GITHUB_* environment variables, runs a task in headless mode,
 * and sets outputs and step summary.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { APIClient } from "./api-client";
import type { CLIConfig } from "./config";

interface HeadlessResult {
  error?: string;
  filesChanged: string[];
  prUrl?: string;
  sessionId: string;
  success: boolean;
}

function getInput(name: string, required?: boolean): string {
  const envKey = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  const value = process.env[envKey] ?? "";
  if (required && !value) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value;
}

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

function setStepSummary(markdown: string): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    writeFileSync(summaryFile, markdown);
  }
}

async function run(): Promise<void> {
  const task = getInput("task", true);
  const projectId = getInput("project-id", true);
  const apiKey = getInput("api-key", true);
  const apiUrl = getInput("api-url") || "https://api.prometheus.dev";
  const timeout = Number.parseInt(getInput("timeout") || "600", 10);
  const mode = getInput("mode") || "task";

  const config: CLIConfig = {
    apiUrl,
    apiKey,
    projectId,
  };

  const client = new APIClient(config);

  console.log(`Prometheus AI Agent - ${mode} mode`);
  console.log(`Task: ${task}`);
  console.log(`Project: ${projectId}`);
  console.log(`Timeout: ${timeout}s`);

  try {
    const result = await client.submitTask({
      title: task,
      description: task,
      projectId,
      mode,
    });

    console.log(`Session created: ${result.sessionId}`);

    // Wait for completion with timeout
    const finalResult = await waitForCompletion(
      client,
      result.sessionId,
      timeout
    );

    // Set outputs
    setOutput("session-id", finalResult.sessionId);
    setOutput("success", String(finalResult.success));
    setOutput("files-changed", JSON.stringify(finalResult.filesChanged));
    if (finalResult.prUrl) {
      setOutput("pr-url", finalResult.prUrl);
    }

    // Set step summary
    const summaryLines = [
      "## Prometheus AI Agent Results",
      "",
      `**Status:** ${finalResult.success ? "Success" : "Failed"}`,
      `**Session:** \`${finalResult.sessionId}\``,
      `**Mode:** ${mode}`,
      "",
    ];

    if (finalResult.prUrl) {
      summaryLines.push(`**Pull Request:** ${finalResult.prUrl}`);
      summaryLines.push("");
    }

    if (finalResult.filesChanged.length > 0) {
      summaryLines.push("### Files Changed");
      for (const file of finalResult.filesChanged) {
        summaryLines.push(`- \`${file}\``);
      }
      summaryLines.push("");
    }

    if (finalResult.error) {
      summaryLines.push("### Error");
      summaryLines.push(`\`\`\`\n${finalResult.error}\n\`\`\``);
    }

    setStepSummary(summaryLines.join("\n"));

    if (!finalResult.success) {
      process.exitCode = 1;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${msg}`);

    setOutput("success", "false");
    setStepSummary(
      `## Prometheus AI Agent Results\n\n**Status:** Failed\n\n\`\`\`\n${msg}\n\`\`\``
    );

    process.exitCode = 1;
  }
}

function waitForCompletion(
  client: APIClient,
  sessionId: string,
  timeoutSec: number
): Promise<HeadlessResult> {
  return new Promise((resolve, reject) => {
    const filesChanged: string[] = [];
    let prUrl: string | undefined;
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        stream.close();
        resolve({
          success: false,
          sessionId,
          filesChanged,
          prUrl,
          error: `Timeout exceeded (${timeoutSec}s)`,
        });
      }
    }, timeoutSec * 1000);

    const stream = client.streamSession(
      sessionId,
      (event) => {
        if (settled) {
          return;
        }

        // Log progress for GitHub Actions log
        switch (event.type) {
          case "token": {
            process.stdout.write(
              String((event.data as { content: string }).content)
            );
            break;
          }
          case "tool_call": {
            const data = event.data as { toolName: string };
            console.log(`[Tool] ${data.toolName}`);
            break;
          }
          case "file_change": {
            const data = event.data as { filePath: string };
            filesChanged.push(data.filePath);
            console.log(`[File] ${data.filePath}`);
            break;
          }
          case "pr_created": {
            const data = event.data as { prUrl: string };
            prUrl = data.prUrl;
            console.log(`[PR] ${data.prUrl}`);
            break;
          }
          case "error": {
            const data = event.data as { error?: string };
            console.error(`[Error] ${data.error ?? "Unknown error"}`);
            break;
          }
          case "complete": {
            clearTimeout(timeoutHandle);
            settled = true;
            stream.close();
            const data = event.data as { success: boolean };
            resolve({
              success: data.success,
              sessionId,
              filesChanged,
              prUrl,
            });
            break;
          }
          default:
            break;
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          reject(error);
        }
      }
    );
  });
}

run().catch((error) => {
  console.error("Unhandled error:", error);
  process.exitCode = 1;
});
