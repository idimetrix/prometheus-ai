import { createLogger } from "@prometheus/logger";
import { HttpClient } from "./http-client";

const logger = createLogger("utils:github-client");

const GITHUB_API_URL = "https://api.github.com";
const ERROR_LINE_RE = /error|fail|assert|exception|panic/i;
const PASSING_LINE_RE = /\d+ passing/i;

interface CreatePRParams {
  base: string;
  body: string;
  head: string;
  owner: string;
  repo: string;
  title: string;
}

interface PRResponse {
  html_url: string;
  number: number;
}

/**
 * Thin GitHub REST API wrapper for PR operations.
 */
export class GitHubClient {
  private readonly client: HttpClient;

  constructor(token?: string) {
    const ghToken = token ?? process.env.GITHUB_TOKEN;
    this.client = new HttpClient({
      baseUrl: GITHUB_API_URL,
      timeout: 15_000,
      maxRetries: 2,
      retryBaseDelay: 1000,
      defaultHeaders: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
      },
    });
  }

  async createPR(
    params: CreatePRParams
  ): Promise<{ prNumber: number; prUrl: string }> {
    const response = await this.client.post<PRResponse>(
      `/repos/${params.owner}/${params.repo}/pulls`,
      {
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
      }
    );

    logger.info(
      { prNumber: response.data.number, prUrl: response.data.html_url },
      "PR created"
    );

    return {
      prNumber: response.data.number,
      prUrl: response.data.html_url,
    };
  }

  async addReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<void> {
    await this.client.post(
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      { reviewers }
    );
  }

  async getCheckStatus(
    owner: string,
    repo: string,
    ref: string
  ): Promise<{ state: string; total: number; passed: number }> {
    const response = await this.client.get<{
      state: string;
      statuses: Array<{ state: string }>;
    }>(`/repos/${owner}/${repo}/commits/${ref}/status`);

    const statuses = response.data.statuses;
    return {
      state: response.data.state,
      total: statuses.length,
      passed: statuses.filter((s) => s.state === "success").length,
    };
  }

  /**
   * Create a pull request (alias matching the interface expected by ci-fix pipeline).
   */
  createPullRequest(params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<{ prNumber: number; prUrl: string }> {
    return this.createPR(params);
  }

  /**
   * Post a comment on a specific commit.
   */
  async createCommitComment(
    owner: string,
    repo: string,
    sha: string,
    body: string
  ): Promise<void> {
    await this.client.post(`/repos/${owner}/${repo}/commits/${sha}/comments`, {
      body,
    });
  }

  /**
   * Fetch workflow run logs from GitHub Actions.
   *
   * Returns the jobs and their failed steps with extracted log text.
   * The GitHub API returns a redirect to a zip archive for full logs,
   * so we fetch structured job data and extract failure information.
   */
  async getWorkflowLogs(
    owner: string,
    repo: string,
    runId: number
  ): Promise<{
    conclusion: string;
    failures: Array<{ job: string; step: string; log: string }>;
    runId: number;
    workflowName: string;
  }> {
    // Get the workflow run metadata
    const runResponse = await this.client.get<{
      conclusion: string;
      name: string;
    }>(`/repos/${owner}/${repo}/actions/runs/${runId}`);

    // Get jobs for the run
    const jobsResponse = await this.client.get<{
      jobs: Array<{
        conclusion: string | null;
        name: string;
        status: string;
        steps: Array<{
          conclusion: string | null;
          name: string;
          number: number;
          status: string;
        }>;
      }>;
    }>(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`);

    const failedJobs = jobsResponse.data.jobs.filter(
      (j) => j.conclusion === "failure"
    );

    const failures: Array<{ job: string; step: string; log: string }> = [];

    for (const job of failedJobs) {
      const failedSteps = job.steps.filter((s) => s.conclusion === "failure");

      for (const step of failedSteps) {
        // Download logs for this specific job
        try {
          const logResponse = await this.client.get<string>(
            `/repos/${owner}/${repo}/actions/jobs/${step.number}/logs`
          );

          const logText =
            typeof logResponse.data === "string"
              ? logResponse.data
              : JSON.stringify(logResponse.data);

          // Extract relevant failure lines
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
      runId,
      workflowName: runResponse.data.name,
      conclusion: runResponse.data.conclusion,
      failures,
    };
  }
}
