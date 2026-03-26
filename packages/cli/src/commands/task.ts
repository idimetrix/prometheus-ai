import { Command } from "commander";
import type { SessionEvent } from "../api-client";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";
import { parsePrometheusRules } from "../prometheus-md";
import { StreamRenderer } from "../renderer/stream-renderer";

interface HeadlessResult {
  error?: string;
  filesChanged: string[];
  prUrl?: string;
  sessionId: string;
  success: boolean;
}

interface TaskOpts {
  apiKey?: string;
  apiUrl?: string;
  headless?: boolean;
  json?: boolean;
  mode: string;
  project?: string;
  timeout?: string;
  wait?: boolean;
}

function exitWithJsonError(message: string): never {
  const err: HeadlessResult = {
    success: false,
    sessionId: "",
    filesChanged: [],
    error: message,
  };
  console.log(JSON.stringify(err));
  process.exit(1);
}

function handleInteractiveEvent(
  event: SessionEvent,
  renderer: StreamRenderer,
  state: { filesChanged: string[]; prUrl?: string }
): void {
  switch (event.type) {
    case "token": {
      renderer.renderTextDelta(
        String((event.data as { content: string }).content)
      );
      break;
    }
    case "tool_call": {
      const data = event.data as { toolName: string };
      renderer.renderToolCall(data.toolName);
      break;
    }
    case "file_change": {
      const data = event.data as { filePath: string };
      state.filesChanged.push(data.filePath);
      renderer.renderInfo(`File: ${data.filePath}`);
      break;
    }
    case "pr_created": {
      const data = event.data as { prUrl: string };
      state.prUrl = data.prUrl;
      renderer.renderSuccess(`PR created: ${data.prUrl}`);
      break;
    }
    case "error": {
      renderer.renderError(
        String((event.data as { error?: string }).error ?? "Unknown error")
      );
      break;
    }
    default:
      break;
  }
}

function handleCompletion(
  event: SessionEvent,
  sessionId: string,
  state: { filesChanged: string[]; prUrl?: string },
  isStructured: boolean,
  renderer: StreamRenderer,
  timeoutHandle?: ReturnType<typeof setTimeout>
): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  const data = event.data as { success: boolean };

  if (isStructured) {
    const finalResult: HeadlessResult = {
      success: data.success,
      sessionId,
      prUrl: state.prUrl,
      filesChanged: state.filesChanged,
    };
    console.log(JSON.stringify(finalResult));
  } else {
    renderer.clear();
    console.log(`\nTask ${data.success ? "completed" : "failed"}`);
    if (state.filesChanged.length > 0) {
      console.log(`Files changed: ${state.filesChanged.length}`);
    }
    if (state.prUrl) {
      console.log(`PR: ${state.prUrl}`);
    }
  }
  process.exit(data.success ? 0 : 1);
}

export const taskCommand = new Command("task")
  .description("Submit a task to Prometheus agents")
  .argument("<description>", "Task description")
  .option("-p, --project <id>", "Project ID")
  .option("-m, --mode <mode>", "Execution mode (task|plan|ask|fleet)", "task")
  .option("-w, --wait", "Wait for completion, exit 0/1")
  .option("--headless", "Non-interactive mode for CI/CD (JSON progress events)")
  .option("--json", "Output all results as structured JSON")
  .option("--timeout <seconds>", "Timeout in seconds")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (description: string, opts: TaskOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = config.projectId;
    const isStructured = opts.headless === true || opts.json === true;
    const timeoutSec = opts.timeout
      ? Number.parseInt(opts.timeout, 10)
      : undefined;

    if (!projectId) {
      if (isStructured) {
        exitWithJsonError(
          "Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
        );
      }
      console.error(
        "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
      );
      process.exit(1);
    }

    const rules = parsePrometheusRules(process.cwd());

    try {
      if (!isStructured) {
        console.log(`Submitting ${opts.mode} task...`);
      }

      const result = await client.submitTask({
        title: description,
        description,
        projectId,
        mode: opts.mode,
        rules: rules.length > 0 ? rules : undefined,
      });

      if (isStructured) {
        console.log(
          JSON.stringify({
            event: "task_created",
            sessionId: result.sessionId,
            taskId: result.taskId,
          })
        );
      } else {
        console.log(`Task created: ${result.taskId}`);
        console.log(`Session: ${result.sessionId}`);
        console.log("\nStreaming output...\n");
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      if (timeoutSec && timeoutSec > 0) {
        timeoutHandle = setTimeout(() => {
          if (isStructured) {
            exitWithJsonError(`Timeout exceeded (${timeoutSec}s)`);
          }
          console.error(`\nTimeout exceeded (${timeoutSec}s)`);
          process.exit(1);
        }, timeoutSec * 1000);
      }

      const renderer = new StreamRenderer();
      const state: { filesChanged: string[]; prUrl?: string } = {
        filesChanged: [],
      };

      const stream = client.streamSession(
        result.sessionId,
        (event) => {
          if (isStructured) {
            console.log(JSON.stringify(event));
          }

          if (event.type === "complete") {
            stream.close();
            handleCompletion(
              event,
              result.sessionId,
              state,
              isStructured,
              renderer,
              timeoutHandle
            );
            return;
          }

          if (!isStructured) {
            handleInteractiveEvent(event, renderer, state);
          } else if (event.type === "file_change") {
            state.filesChanged.push(
              (event.data as { filePath: string }).filePath
            );
          } else if (event.type === "pr_created") {
            state.prUrl = (event.data as { prUrl: string }).prUrl;
          }
        },
        (error) => {
          if (!isStructured) {
            renderer.renderError(`Connection error: ${error.message}`);
          }
        }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isStructured) {
        exitWithJsonError(msg);
      }
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
