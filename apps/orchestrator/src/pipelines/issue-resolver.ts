import { createLogger } from "@prometheus/logger";
import {
  GitHubClient,
  modelRouterClient,
  projectBrainClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:issue-resolver");

const JSON_ARRAY_REGEX = /\[[\s\S]*\]/;
const GITHUB_REPO_REGEX = /github\.com\/([^/]+)\/([^/]+)/;
const GITHUB_ISSUE_REGEX = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/;

export interface SyncedIssueInput {
  body: string | null;
  externalId: string;
  externalUrl: string | null;
  projectId: string;
  provider: string;
  title: string | null;
}

export interface ResolveResult {
  branch: string | null;
  error: string | null;
  prNumber: number | null;
  prUrl: string | null;
  status: "success" | "partial" | "failed";
}

interface ProjectBrainContext {
  files: Array<{ content: string; path: string }>;
  summary: string | null;
}

interface PlanStep {
  action: string;
  description: string;
  filePath: string;
}

/**
 * IssueResolver handles the full pipeline from a synced external issue
 * to a pull request with the fix. It:
 * 1. Parses the issue to extract requirements
 * 2. Queries project-brain for relevant context
 * 3. Creates a plan of changes
 * 4. Delegates execution to the agent loop via sandbox
 * 5. Runs tests and creates a PR if they pass
 * 6. Posts progress comments on the issue
 */
export class IssueResolver {
  private readonly github: GitHubClient;

  constructor(githubToken?: string) {
    this.github = new GitHubClient(githubToken);
  }

  async resolve(issue: SyncedIssueInput): Promise<ResolveResult> {
    const logCtx = {
      externalId: issue.externalId,
      projectId: issue.projectId,
      provider: issue.provider,
    };

    logger.info(logCtx, "Starting issue resolution pipeline");

    try {
      // Step 1: Parse issue to extract requirements
      const requirements = await this.parseRequirements(issue);
      logger.info(
        { ...logCtx, requirements: requirements.slice(0, 200) },
        "Requirements extracted"
      );

      await this.postProgressComment(
        issue,
        "Analyzing issue and gathering context..."
      );

      // Step 2: Query project-brain for relevant files and context
      const context = await this.queryProjectBrain(
        issue.projectId,
        requirements
      );
      logger.info(
        { ...logCtx, fileCount: context.files.length },
        "Project context loaded"
      );

      // Step 3: Create a plan
      const plan = await this.createPlan(requirements, context);
      logger.info({ ...logCtx, stepCount: plan.length }, "Plan created");

      await this.postProgressComment(
        issue,
        `Plan created with ${plan.length} step(s):\n${plan.map((s, i) => `${i + 1}. ${s.description}`).join("\n")}`
      );

      // Step 4: Execute changes (delegate to agent loop in production)
      // The actual execution is handled by the agent loop. This pipeline
      // prepares the context and plan, then the task queue worker picks
      // it up and runs the agent loop with sandbox execution.
      const executionResult = await this.executeChanges(issue, plan, context);

      if (!executionResult.success) {
        await this.postProgressComment(
          issue,
          `Failed to apply changes: ${executionResult.error ?? "Unknown error"}\n\nThe agent attempted to resolve this issue but encountered difficulties. A human review may be needed.`
        );

        return {
          status: "failed",
          branch: null,
          prNumber: null,
          prUrl: null,
          error: executionResult.error ?? "Execution failed",
        };
      }

      // Step 5: Run tests
      const testsPass = await this.runTests(issue.projectId);
      if (!testsPass) {
        await this.postProgressComment(
          issue,
          "Changes applied but tests failed. The branch has been pushed for manual review."
        );

        return {
          status: "partial",
          branch: executionResult.branch,
          prNumber: null,
          prUrl: null,
          error: "Tests failed after applying changes",
        };
      }

      // Step 6: Create PR
      const prResult = await this.createPullRequest(
        issue,
        executionResult.branch ?? `prometheus/issue-${issue.externalId}`,
        requirements,
        plan
      );

      await this.postProgressComment(
        issue,
        `Pull request created: ${prResult.prUrl ?? "N/A"}\n\nThe agent has resolved this issue and submitted a PR for review.`
      );

      logger.info(
        { ...logCtx, prUrl: prResult.prUrl },
        "Issue resolution complete"
      );

      return {
        status: "success",
        branch: executionResult.branch,
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        error: null,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { ...logCtx, error: msg },
        "Issue resolution pipeline failed"
      );

      await this.postProgressComment(
        issue,
        `The Prometheus agent attempted to resolve this issue but encountered an error:\n\n\`\`\`\n${msg}\n\`\`\`\n\nA human review may be needed.`
      );

      return {
        status: "failed",
        branch: null,
        prNumber: null,
        prUrl: null,
        error: msg,
      };
    }
  }

  /**
   * Parse the issue title and body to extract actionable requirements
   * using the LLM via model router.
   */
  private async parseRequirements(issue: SyncedIssueInput): Promise<string> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Analyze this issue and extract clear, actionable requirements for a developer to implement:

Title: ${issue.title ?? "Untitled"}
Body: ${issue.body ?? "No description"}

Output a structured list of:
1. What needs to change
2. Expected behavior
3. Files likely involved (if mentioned)
4. Acceptance criteria`,
          },
        ],
        options: { maxTokens: 1024, temperature: 0.2 },
      });

      return (
        response.data.choices[0]?.message.content ??
        `Fix: ${issue.title ?? issue.externalId}`
      );
    } catch (error) {
      logger.warn({ error }, "Failed to parse requirements via LLM");
      return `Fix: ${issue.title ?? issue.externalId}\n\n${issue.body ?? ""}`;
    }
  }

  /**
   * Query the project-brain service for relevant files and context.
   */
  private async queryProjectBrain(
    projectId: string,
    requirements: string
  ): Promise<ProjectBrainContext> {
    const defaultContext: ProjectBrainContext = { files: [], summary: null };

    try {
      const response = await projectBrainClient.post<ProjectBrainContext>(
        `/api/projects/${projectId}/search`,
        { query: requirements, maxFiles: 20 }
      );
      return response.data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Project Brain query failed");
      return defaultContext;
    }
  }

  /**
   * Create a plan of file changes using the LLM.
   */
  private async createPlan(
    requirements: string,
    context: ProjectBrainContext
  ): Promise<PlanStep[]> {
    try {
      const filesContext = context.files
        .slice(0, 10)
        .map((f) => `### ${f.path}\n${f.content.slice(0, 500)}`)
        .join("\n\n");

      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Create a detailed implementation plan for the following requirements.

Requirements:
${requirements}

Relevant files:
${filesContext}

Output a JSON array of steps, each with:
- "filePath": the file to modify or create
- "action": "modify" | "create" | "delete"
- "description": what to change

Output ONLY the JSON array, no other text.`,
          },
        ],
        options: { maxTokens: 2048, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "[]";
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(JSON_ARRAY_REGEX);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as PlanStep[];
      }
      return [];
    } catch (error) {
      logger.warn({ error }, "Plan creation failed");
      return [];
    }
  }

  /**
   * Execute changes in sandbox. In production, this delegates to the
   * agent loop. Here we prepare the execution context.
   */
  private executeChanges(
    issue: SyncedIssueInput,
    _plan: PlanStep[],
    _context: ProjectBrainContext
  ): Promise<{
    branch: string | null;
    error: string | null;
    success: boolean;
  }> {
    // The actual execution is handled by the agent task queue.
    // The task was already queued in the assignToAgent mutation.
    // This method is called when running the pipeline synchronously
    // (e.g., from a webhook trigger).
    const branch = `prometheus/issue-${issue.externalId}`;

    logger.info(
      { branch, projectId: issue.projectId },
      "Execution delegated to agent loop"
    );

    return Promise.resolve({ success: true, branch, error: null });
  }

  /**
   * Run tests for the project in the sandbox.
   */
  private runTests(_projectId: string): Promise<boolean> {
    // TODO: Connect to sandbox-manager to run tests
    // For now, assume tests pass
    logger.info("Test execution placeholder — assuming pass");
    return Promise.resolve(true);
  }

  /**
   * Create a pull request on the provider.
   */
  private async createPullRequest(
    issue: SyncedIssueInput,
    branch: string,
    requirements: string,
    plan: PlanStep[]
  ): Promise<{ prNumber: number | null; prUrl: string | null }> {
    if (issue.provider !== "github") {
      logger.info(
        { provider: issue.provider },
        "PR creation not yet supported for this provider"
      );
      return { prNumber: null, prUrl: null };
    }

    // Parse owner/repo from external URL
    const repoMatch = issue.externalUrl?.match(GITHUB_REPO_REGEX);
    if (!repoMatch) {
      logger.warn("Could not parse repo from issue URL");
      return { prNumber: null, prUrl: null };
    }

    const [, owner, repo] = repoMatch;

    const planSummary = plan
      .map((s) => `- ${s.action} \`${s.filePath}\`: ${s.description}`)
      .join("\n");

    try {
      const result = await this.github.createPR({
        owner: owner ?? "",
        repo: repo ?? "",
        title: `[Prometheus] Fix: ${issue.title ?? issue.externalId}`,
        body: `## Summary\nAutomated fix for issue #${issue.externalId}\n\n## Requirements\n${requirements.slice(0, 1000)}\n\n## Changes\n${planSummary}\n\n---\nGenerated by Prometheus AI`,
        head: branch,
        base: "main",
      });

      return { prNumber: result.prNumber, prUrl: result.prUrl };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "PR creation failed");
      return { prNumber: null, prUrl: null };
    }
  }

  /**
   * Post a progress comment on the external issue.
   */
  private async postProgressComment(
    issue: SyncedIssueInput,
    message: string
  ): Promise<void> {
    if (issue.provider !== "github" || !issue.externalUrl) {
      return;
    }

    const repoMatch = issue.externalUrl.match(GITHUB_ISSUE_REGEX);
    if (!repoMatch) {
      return;
    }

    const [, owner, repo, issueNumber] = repoMatch;

    try {
      // Use raw fetch for comment API since GitHubClient is PR-focused
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return;
      }

      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            body: `🤖 **Prometheus Agent**\n\n${message}`,
          }),
        }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to post progress comment");
    }
  }
}
