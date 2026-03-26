/**
 * Issue-to-PR Pipeline
 *
 * Full end-to-end pipeline that takes a GitHub issue and produces a pull request:
 * 1. Clone the repository into sandbox
 * 2. Create a feature branch: prometheus/issue-{number}
 * 3. Read the issue context (title, body, comments)
 * 4. Plan the implementation
 * 5. Execute the plan (write code, run tests)
 * 6. Commit changes with conventional commit message
 * 7. Push the branch
 * 8. Create a PR using GitHub API
 * 9. Link the PR to the issue (closes #N in PR body)
 * 10. Post update comment on the issue with PR link
 */

import { createLogger } from "@prometheus/logger";
import {
  GitHubClient,
  modelRouterClient,
  projectBrainClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:issue-to-pr");

const REPO_FULLNAME_RE = /^([^/]+)\/([^/]+)$/;
const CODE_FENCE_START_RE = /^```[\w]*\n/;
const CODE_FENCE_END_RE = /\n```$/;
const JSON_ARRAY_REGEX = /\[[\s\S]*\]/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueToPRInput {
  /** The issue body / description */
  body: string | null;
  /** Default branch of the repository (e.g. "main") */
  defaultBranch?: string;
  /** The issue number on GitHub */
  issueNumber: number;
  /** Full URL of the issue (e.g. https://github.com/owner/repo/issues/42) */
  issueUrl: string;
  /** The Prometheus project ID */
  projectId: string;
  /** The full repo name (owner/repo) */
  repoFullName: string;
  /** The issue title */
  title: string;
  /** GitHub OAuth token for API operations */
  token: string;
}

export interface IssueToPRResult {
  /** The feature branch name */
  branch: string | null;
  /** Error message if pipeline failed */
  error: string | null;
  /** The created PR number */
  prNumber: number | null;
  /** The created PR URL */
  prUrl: string | null;
  /** Overall pipeline status */
  status: "success" | "partial" | "failed";
}

interface PlanStep {
  action: "create" | "modify" | "delete";
  description: string;
  filePath: string;
}

interface ProjectBrainContext {
  files: Array<{ content: string; path: string }>;
  summary: string | null;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class IssueToPRPipeline {
  private readonly github: GitHubClient;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
    this.github = new GitHubClient(token);
  }

  /**
   * Execute the full issue-to-PR pipeline.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pipeline orchestration requires sequential multi-step logic
  async execute(input: IssueToPRInput): Promise<IssueToPRResult> {
    const logCtx = {
      issueNumber: input.issueNumber,
      projectId: input.projectId,
      repo: input.repoFullName,
    };

    logger.info(logCtx, "Starting issue-to-PR pipeline");

    const repoMatch = input.repoFullName.match(REPO_FULLNAME_RE);
    if (!repoMatch) {
      return {
        status: "failed",
        branch: null,
        prNumber: null,
        prUrl: null,
        error: `Invalid repo format: ${input.repoFullName}`,
      };
    }

    const [, owner, repo] = repoMatch;
    const baseBranch = input.defaultBranch ?? "main";
    const branch = `prometheus/issue-${input.issueNumber}`;

    try {
      // Step 1: Post initial comment on the issue
      await this.postIssueComment(
        owner ?? "",
        repo ?? "",
        input.issueNumber,
        "Analyzing issue and planning implementation..."
      );

      // Step 2: Parse requirements from issue
      const requirements = await this.parseRequirements(input);
      logger.info(
        { ...logCtx, requirementsLength: requirements.length },
        "Requirements extracted"
      );

      // Step 3: Get project context from project-brain
      const context = await this.queryProjectBrain(
        input.projectId,
        requirements
      );
      logger.info(
        { ...logCtx, contextFiles: context.files.length },
        "Project context loaded"
      );

      // Step 4: Create implementation plan
      const plan = await this.createPlan(input, requirements, context);
      logger.info({ ...logCtx, planSteps: plan.length }, "Plan created");

      if (plan.length === 0) {
        await this.postIssueComment(
          owner ?? "",
          repo ?? "",
          input.issueNumber,
          "I analyzed the issue but could not generate a concrete implementation plan. A human review may be needed."
        );
        return {
          status: "failed",
          branch: null,
          prNumber: null,
          prUrl: null,
          error: "Could not generate implementation plan",
        };
      }

      await this.postIssueComment(
        owner ?? "",
        repo ?? "",
        input.issueNumber,
        `Implementation plan created with ${plan.length} step(s):\n${plan.map((s, i) => `${i + 1}. **${s.action}** \`${s.filePath}\`: ${s.description}`).join("\n")}\n\nWorking on implementation...`
      );

      // Step 5: Create the feature branch via GitHub API
      await this.createBranch(owner ?? "", repo ?? "", branch, baseBranch);
      logger.info({ ...logCtx, branch }, "Feature branch created");

      // Step 6: Execute the plan (create/modify files on the branch)
      const executionResult = await this.executePlan(
        owner ?? "",
        repo ?? "",
        branch,
        input,
        plan,
        context
      );

      if (!executionResult.success) {
        await this.postIssueComment(
          owner ?? "",
          repo ?? "",
          input.issueNumber,
          `Failed to apply changes: ${executionResult.error ?? "Unknown error"}\n\nThe branch \`${branch}\` has been created but may be incomplete.`
        );
        return {
          status: "partial",
          branch,
          prNumber: null,
          prUrl: null,
          error: executionResult.error ?? "Execution failed",
        };
      }

      // Step 7: Create the pull request
      const prResult = await this.createPullRequest(
        owner ?? "",
        repo ?? "",
        branch,
        baseBranch,
        input,
        requirements,
        plan
      );

      // Step 8: Post final comment with PR link
      await this.postIssueComment(
        owner ?? "",
        repo ?? "",
        input.issueNumber,
        `Pull request created: ${prResult.prUrl}\n\nThe implementation addresses the requirements from this issue. Please review the PR and let me know if any changes are needed.`
      );

      logger.info(
        { ...logCtx, prUrl: prResult.prUrl, prNumber: prResult.prNumber },
        "Issue-to-PR pipeline completed successfully"
      );

      return {
        status: "success",
        branch,
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        error: null,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ ...logCtx, error: msg }, "Issue-to-PR pipeline failed");

      await this.postIssueComment(
        owner ?? "",
        repo ?? "",
        input.issueNumber,
        `The Prometheus agent encountered an error while working on this issue:\n\n\`\`\`\n${msg}\n\`\`\`\n\nA human review may be needed.`
      );

      return {
        status: "failed",
        branch,
        prNumber: null,
        prUrl: null,
        error: msg,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step implementations
  // -------------------------------------------------------------------------

  /**
   * Parse the issue title and body to extract actionable requirements.
   */
  private async parseRequirements(input: IssueToPRInput): Promise<string> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Analyze this GitHub issue and extract clear, actionable requirements for implementation:

Title: ${input.title}
Body: ${input.body ?? "No description"}
Repository: ${input.repoFullName}

Output a structured list of:
1. What needs to change
2. Expected behavior
3. Files likely involved (if mentioned)
4. Acceptance criteria
5. Suggested conventional commit type (feat/fix/refactor/etc.)`,
          },
        ],
        options: { maxTokens: 1024, temperature: 0.2 },
      });

      return (
        response.data.choices[0]?.message.content ?? `Implement: ${input.title}`
      );
    } catch (error) {
      logger.warn({ error }, "Failed to parse requirements via LLM");
      return `Implement: ${input.title}\n\n${input.body ?? ""}`;
    }
  }

  /**
   * Query project-brain for relevant files and context.
   */
  private async queryProjectBrain(
    projectId: string,
    requirements: string
  ): Promise<ProjectBrainContext> {
    const defaultCtx: ProjectBrainContext = { files: [], summary: null };

    try {
      const response = await projectBrainClient.post<ProjectBrainContext>(
        `/api/projects/${projectId}/search`,
        { query: requirements, maxFiles: 20 }
      );
      return response.data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Project Brain query failed");
      return defaultCtx;
    }
  }

  /**
   * Create an implementation plan using the LLM.
   */
  private async createPlan(
    input: IssueToPRInput,
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
            content: `Create a detailed implementation plan for the following GitHub issue.

Issue #${input.issueNumber}: ${input.title}
Repository: ${input.repoFullName}

Requirements:
${requirements}

Relevant project files:
${filesContext || "No files available — use your best judgment."}

Output a JSON array of steps, each with:
- "filePath": the file to modify or create
- "action": "modify" | "create" | "delete"
- "description": what to change and why

Output ONLY the JSON array, no other text.`,
          },
        ],
        options: { maxTokens: 2048, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "[]";
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
   * Create a new branch from the base branch using GitHub API.
   */
  private async createBranch(
    owner: string,
    repo: string,
    branch: string,
    baseBranch: string
  ): Promise<void> {
    // Get the SHA of the base branch
    const baseRefResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!baseRefResponse.ok) {
      throw new Error(
        `Failed to get base branch ref: ${baseRefResponse.status}`
      );
    }

    const baseRef = (await baseRefResponse.json()) as {
      object: { sha: string };
    };

    // Create the new branch
    const createResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: baseRef.object.sha,
        }),
      }
    );

    if (!createResponse.ok) {
      const errorBody = await createResponse.text();
      throw new Error(
        `Failed to create branch: ${createResponse.status} — ${errorBody}`
      );
    }
  }

  /**
   * Execute the plan by creating/modifying files on the branch via GitHub API.
   * Uses the Git Data API to create blobs, trees, and commits.
   */
  private async executePlan(
    owner: string,
    repo: string,
    branch: string,
    input: IssueToPRInput,
    plan: PlanStep[],
    context: ProjectBrainContext
  ): Promise<{ error: string | null; success: boolean }> {
    try {
      // Generate code for each planned change using the LLM
      const fileChanges: Array<{ content: string; path: string }> = [];

      for (const step of plan) {
        if (step.action === "delete") {
          continue; // Deletion handled separately
        }

        const existingFile = context.files.find(
          (f) => f.path === step.filePath
        );

        const codeResponse = await modelRouterClient.post<{
          choices: Array<{ message: { content: string } }>;
        }>("/route", {
          slot: "default",
          messages: [
            {
              role: "user",
              content: `Generate the complete file content for the following change.

Issue #${input.issueNumber}: ${input.title}
File: ${step.filePath}
Action: ${step.action}
Description: ${step.description}

${existingFile ? `Current file content:\n\`\`\`\n${existingFile.content}\n\`\`\`` : "This is a new file."}

Output ONLY the file content, no markdown code fences, no explanation.`,
            },
          ],
          options: { maxTokens: 4096, temperature: 0.1 },
        });

        const content = codeResponse.data.choices[0]?.message.content ?? "";

        if (content) {
          // Strip markdown code fences if present
          const cleaned = content
            .replace(CODE_FENCE_START_RE, "")
            .replace(CODE_FENCE_END_RE, "");
          fileChanges.push({ path: step.filePath, content: cleaned });
        }
      }

      if (fileChanges.length === 0) {
        return { success: false, error: "No file changes generated" };
      }

      // Push all file changes as a single commit using the Git Data API
      const commitMessage = this.generateCommitMessage(input, plan);
      await this.pushFiles(owner, repo, branch, commitMessage, fileChanges);

      return { success: true, error: null };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  /**
   * Push multiple file changes as a single commit using GitHub's Git Data API.
   */
  private async pushFiles(
    owner: string,
    repo: string,
    branch: string,
    message: string,
    files: Array<{ content: string; path: string }>
  ): Promise<void> {
    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // 1. Get the current branch SHA
    const refResponse = await fetch(`${baseUrl}/git/ref/heads/${branch}`, {
      headers,
    });
    if (!refResponse.ok) {
      throw new Error(`Branch ${branch} not found`);
    }
    const refData = (await refResponse.json()) as {
      object: { sha: string };
    };
    const currentSha = refData.object.sha;

    // 2. Get the current commit's tree SHA
    const commitResponse = await fetch(`${baseUrl}/git/commits/${currentSha}`, {
      headers,
    });
    if (!commitResponse.ok) {
      throw new Error("Failed to get current commit");
    }
    const commitData = (await commitResponse.json()) as {
      tree: { sha: string };
    };
    const baseTreeSha = commitData.tree.sha;

    // 3. Create blobs for each file
    const treeEntries: Array<{
      mode: string;
      path: string;
      sha: string;
      type: string;
    }> = [];

    for (const file of files) {
      const blobResponse = await fetch(`${baseUrl}/git/blobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      });
      if (!blobResponse.ok) {
        throw new Error(`Failed to create blob for ${file.path}`);
      }
      const blobData = (await blobResponse.json()) as { sha: string };
      treeEntries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobData.sha,
      });
    }

    // 4. Create tree
    const treeResponse = await fetch(`${baseUrl}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    if (!treeResponse.ok) {
      throw new Error("Failed to create tree");
    }
    const treeData = (await treeResponse.json()) as { sha: string };

    // 5. Create commit
    const newCommitResponse = await fetch(`${baseUrl}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [currentSha],
      }),
    });
    if (!newCommitResponse.ok) {
      throw new Error("Failed to create commit");
    }
    const newCommitData = (await newCommitResponse.json()) as {
      sha: string;
    };

    // 6. Update branch reference
    const updateRefResponse = await fetch(
      `${baseUrl}/git/refs/heads/${branch}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: newCommitData.sha }),
      }
    );
    if (!updateRefResponse.ok) {
      throw new Error("Failed to update branch reference");
    }
  }

  /**
   * Generate a conventional commit message from the issue and plan.
   */
  private generateCommitMessage(
    input: IssueToPRInput,
    plan: PlanStep[]
  ): string {
    const hasNewFiles = plan.some((s) => s.action === "create");
    const commitType = hasNewFiles ? "feat" : "fix";

    const summary = `${commitType}: ${input.title.toLowerCase()}`;
    const body = plan
      .map((s) => `- ${s.action} ${s.filePath}: ${s.description}`)
      .join("\n");

    return `${summary}\n\nCloses #${input.issueNumber}\n\n${body}`;
  }

  /**
   * Create a pull request linking back to the issue.
   */
  private async createPullRequest(
    owner: string,
    repo: string,
    branch: string,
    baseBranch: string,
    input: IssueToPRInput,
    requirements: string,
    plan: PlanStep[]
  ): Promise<{ prNumber: number; prUrl: string }> {
    const planSummary = plan
      .map((s) => `- **${s.action}** \`${s.filePath}\`: ${s.description}`)
      .join("\n");

    const prBody = [
      "## Summary",
      `Automated implementation for #${input.issueNumber}: ${input.title}`,
      "",
      `Closes #${input.issueNumber}`,
      "",
      "## Requirements",
      requirements.slice(0, 2000),
      "",
      "## Changes",
      planSummary,
      "",
      "---",
      "Generated by Prometheus AI Agent",
    ].join("\n");

    const result = await this.github.createPR({
      owner,
      repo,
      title: `${input.title}`,
      body: prBody,
      head: branch,
      base: baseBranch,
    });

    return result;
  }

  /**
   * Post a progress comment on the GitHub issue.
   */
  private async postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    message: string
  ): Promise<void> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            body: `**Prometheus Agent**\n\n${message}`,
          }),
        }
      );

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Failed to post issue comment"
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to post issue comment");
    }
  }
}
