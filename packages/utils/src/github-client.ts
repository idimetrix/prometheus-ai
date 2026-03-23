import { createLogger } from "@prometheus/logger";
import { HttpClient } from "./http-client";

const logger = createLogger("utils:github-client");

const GITHUB_API_URL = "https://api.github.com";

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
}
