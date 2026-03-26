import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:github:ci-logs");
const GITHUB_API = "https://api.github.com";
const ERROR_LINE_RE = /error|fail|assert|exception|panic/i;
const PASSING_LINE_RE = /\d+ passing/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowRunJob {
  conclusion: string | null;
  name: string;
  status: string;
  steps: Array<{
    conclusion: string | null;
    name: string;
    number: number;
    status: string;
  }>;
}

interface StructuredFailure {
  job: string;
  log: string;
  step: string;
}

export interface CILogsResult {
  conclusion: string;
  failures: StructuredFailure[];
  owner: string;
  repo: string;
  runId: number;
  workflowName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function githubApiFetch(
  path: string,
  token: string,
  accept?: string
): Promise<{ data: unknown; status: number }> {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Prometheus-MCP-Gateway/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { status: response.status, data };
}

function requireToken(
  credentials?: Record<string, string>
): MCPToolResult | string {
  const token = credentials?.github_token;
  if (!token) {
    return {
      success: false,
      error: "GitHub token required. Provide credentials.github_token.",
    };
  }
  return token;
}

/**
 * Fetch the jobs for a workflow run, then download the logs for any
 * failed jobs and extract the relevant failure messages.
 */
async function fetchCILogs(
  owner: string,
  repo: string,
  runId: number,
  token: string
): Promise<CILogsResult> {
  // Get the workflow run metadata
  const runRes = await githubApiFetch(
    `/repos/${owner}/${repo}/actions/runs/${runId}`,
    token
  );
  if (runRes.status !== 200) {
    throw new Error(
      `Failed to fetch workflow run: ${runRes.status} ${JSON.stringify(runRes.data)}`
    );
  }

  const run = runRes.data as {
    conclusion: string;
    name: string;
  };

  // Get jobs for the run
  const jobsRes = await githubApiFetch(
    `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
    token
  );
  if (jobsRes.status !== 200) {
    throw new Error(
      `Failed to fetch workflow jobs: ${jobsRes.status} ${JSON.stringify(jobsRes.data)}`
    );
  }

  const jobs = (jobsRes.data as { jobs: WorkflowRunJob[] }).jobs;
  const failedJobs = jobs.filter((j) => j.conclusion === "failure");

  // Fetch logs for each failed job
  const failures: StructuredFailure[] = [];
  for (const job of failedJobs) {
    const failedSteps = job.steps.filter((s) => s.conclusion === "failure");

    for (const step of failedSteps) {
      // Download the full log for the run (GitHub only provides run-level logs)
      try {
        const logRes = await githubApiFetch(
          `/repos/${owner}/${repo}/actions/runs/${runId}/logs`,
          token,
          "application/vnd.github+json"
        );

        const logText =
          typeof logRes.data === "string"
            ? logRes.data
            : JSON.stringify(logRes.data);

        // Extract relevant failure section (last 200 lines or error section)
        const lines = logText.split("\n");
        const errorLines = lines.filter(
          (l: string) => ERROR_LINE_RE.test(l) && !PASSING_LINE_RE.test(l)
        );

        const relevantLog =
          errorLines.length > 0
            ? errorLines.slice(0, 100).join("\n")
            : lines.slice(-200).join("\n");

        failures.push({
          job: job.name,
          step: step.name,
          log: relevantLog.slice(0, 10_000),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { job: job.name, step: step.name, error: msg },
          "Failed to fetch logs for failed step"
        );
        failures.push({
          job: job.name,
          step: step.name,
          log: `(Log fetch failed: ${msg})`,
        });
      }
    }
  }

  return {
    owner,
    repo,
    runId,
    workflowName: run.name,
    conclusion: run.conclusion,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Register MCP tool
// ---------------------------------------------------------------------------

export function registerGitHubCILogsAdapter(registry: ToolRegistry): void {
  registry.register(
    {
      name: "github_get_ci_logs",
      adapter: "github",
      category: "ci",
      description:
        "Fetch CI/CD workflow run logs from GitHub Actions and extract failure messages",
      inputSchema: {
        type: "object",
        properties: {
          owner: {
            type: "string",
            description: "Repository owner (user or org)",
          },
          repo: { type: "string", description: "Repository name" },
          runId: {
            type: "number",
            description: "GitHub Actions workflow run ID",
          },
        },
        required: ["owner", "repo", "runId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, runId } = input as {
        owner: string;
        repo: string;
        runId: number;
      };

      try {
        const result = await fetchCILogs(owner, repo, runId, tokenOrErr);
        logger.info(
          {
            owner,
            repo,
            runId,
            failureCount: result.failures.length,
          },
          "CI logs fetched"
        );

        return { success: true, data: result };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ owner, repo, runId, error: msg }, "CI log fetch failed");
        return { success: false, error: msg };
      }
    }
  );
}
