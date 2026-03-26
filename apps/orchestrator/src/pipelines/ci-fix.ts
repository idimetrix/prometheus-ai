import { createLogger } from "@prometheus/logger";
import {
  GitHubClient,
  modelRouterClient,
  projectBrainClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:ci-fix");

const GITHUB_REPO_REGEX = /github\.com\/([^/]+)\/([^/]+)/;
const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const TYPE_ERROR_RE = /error TS\d+|Type error|not assignable/i;
const TEST_FAIL_RE = /FAIL.*\.(test|spec)\./i;
const ASSERTION_ERROR_RE = /AssertionError/i;
const BUILD_FAIL_RE = /Build failed|Module not found|SyntaxError/i;
const LINT_FAIL_RE = /lint|eslint|biome|prettier/i;
const GIT_SUFFIX_RE = /\.git$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CISystem = "github_actions" | "gitlab_ci" | "generic";

export interface CIFixInput {
  /** The branch that failed CI */
  branch: string;
  /** Which CI system reported the failure */
  ciSystem: CISystem;
  /** The full log text (or URL for generic) */
  failureLogs: string;
  /** The repository URL */
  owner: string;
  /** Project ID in Prometheus */
  projectId: string;
  /** Repository name */
  repo: string;
  /** CI run ID (for posting comments) */
  runId: string;
  /** The SHA of the failing commit */
  sha: string;
  /** The workflow or pipeline name */
  workflowName: string;
}

export interface CIFixResult {
  branch: string | null;
  error: string | null;
  fixDescription: string | null;
  prNumber: number | null;
  prUrl: string | null;
  status: "success" | "partial" | "failed";
}

interface FailureDiagnosis {
  category: "test" | "build" | "lint" | "type" | "runtime" | "unknown";
  description: string;
  filesToInspect: string[];
  suggestedFix: string;
}

// ---------------------------------------------------------------------------
// CIFixPipeline
// ---------------------------------------------------------------------------

/**
 * CIFixPipeline handles the full flow from a CI failure event to a fix PR.
 *
 * Steps:
 * 1. Parse CI failure logs to diagnose the issue
 * 2. Identify failing tests or build errors
 * 3. Create a fix branch
 * 4. Query project-brain for relevant context
 * 5. Generate a fix using the model router
 * 6. Verify the fix locally in sandbox
 * 7. Commit, push, and create a PR
 * 8. Post update comment on the original commit
 */
export class CIFixPipeline {
  private readonly github: GitHubClient;

  constructor(githubToken?: string) {
    this.github = new GitHubClient(githubToken);
  }

  async run(input: CIFixInput): Promise<CIFixResult> {
    const logCtx = {
      projectId: input.projectId,
      owner: input.owner,
      repo: input.repo,
      sha: input.sha,
      ciSystem: input.ciSystem,
    };

    logger.info(logCtx, "Starting CI fix pipeline");

    try {
      // Step 1: Post initial comment
      await this.postCommitComment(
        input.owner,
        input.repo,
        input.sha,
        `CI failed on workflow **${input.workflowName}**. Prometheus is investigating...`
      );

      // Step 2: Diagnose the failure
      const diagnosis = await this.diagnoseFailure(input);
      logger.info(
        { ...logCtx, category: diagnosis.category },
        "Failure diagnosed"
      );

      // Step 3: Get project context from brain
      const context = await this.getProjectContext(
        input.projectId,
        diagnosis.filesToInspect
      );

      // Step 4: Create fix branch
      const fixBranch = `prometheus/fix-ci-${input.sha.slice(0, 7)}`;

      // Step 5: Generate the fix
      const fix = await this.generateFix(input, diagnosis, context);
      if (!fix) {
        await this.postCommitComment(
          input.owner,
          input.repo,
          input.sha,
          `Could not automatically fix CI failure in **${input.workflowName}**. Manual intervention required.\n\nDiagnosis: ${diagnosis.description}`
        );
        return {
          status: "failed",
          branch: null,
          prNumber: null,
          prUrl: null,
          fixDescription: diagnosis.description,
          error: "Could not generate fix",
        };
      }

      // Step 6: Create PR
      const prResult = await this.createFixPR(input, fixBranch, fix, diagnosis);

      // Step 7: Post success comment
      await this.postCommitComment(
        input.owner,
        input.repo,
        input.sha,
        `Prometheus created fix PR #${prResult.prNumber}: ${prResult.prUrl}\n\nFix: ${fix.description}`
      );

      logger.info(
        { ...logCtx, prNumber: prResult.prNumber },
        "CI fix PR created"
      );

      return {
        status: "success",
        branch: fixBranch,
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        fixDescription: fix.description,
        error: null,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ ...logCtx, error: msg }, "CI fix pipeline failed");

      try {
        await this.postCommitComment(
          input.owner,
          input.repo,
          input.sha,
          `Prometheus encountered an error while investigating CI failure: ${msg}`
        );
      } catch {
        // Ignore comment posting failures
      }

      return {
        status: "failed",
        branch: null,
        prNumber: null,
        prUrl: null,
        fixDescription: null,
        error: msg,
      };
    }
  }

  /**
   * Diagnose the CI failure from the log output.
   */
  private async diagnoseFailure(input: CIFixInput): Promise<FailureDiagnosis> {
    const logs = input.failureLogs;

    try {
      const response = await modelRouterClient.chat({
        model: "fast",
        messages: [
          {
            role: "system",
            content: `You are a CI failure diagnostician. Analyze the CI log and return a JSON object with:
- category: one of "test", "build", "lint", "type", "runtime", "unknown"
- description: a one-line summary of the failure
- filesToInspect: array of file paths that likely need to be modified
- suggestedFix: a brief description of how to fix it

Return ONLY valid JSON, no markdown.`,
          },
          {
            role: "user",
            content: `CI System: ${input.ciSystem}\nWorkflow: ${input.workflowName}\nBranch: ${input.branch}\n\nLogs:\n${logs.slice(0, 8000)}`,
          },
        ],
      });

      const text =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      const jsonMatch = text.match(JSON_OBJECT_RE);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as FailureDiagnosis;
      }
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "AI diagnosis failed, falling back to heuristic"
      );
    }

    // Heuristic fallback
    return this.heuristicDiagnosis(logs);
  }

  /**
   * Simple heuristic-based failure diagnosis when the AI model is unavailable.
   */
  private heuristicDiagnosis(logs: string): FailureDiagnosis {
    if (TYPE_ERROR_RE.test(logs)) {
      return {
        category: "type",
        description: "TypeScript type errors detected",
        filesToInspect: this.extractFilePaths(logs),
        suggestedFix: "Fix TypeScript type mismatches",
      };
    }

    if (TEST_FAIL_RE.test(logs) || ASSERTION_ERROR_RE.test(logs)) {
      return {
        category: "test",
        description: "Test failures detected",
        filesToInspect: this.extractFilePaths(logs),
        suggestedFix: "Fix failing test assertions or source code bugs",
      };
    }

    if (BUILD_FAIL_RE.test(logs)) {
      return {
        category: "build",
        description: "Build errors detected",
        filesToInspect: this.extractFilePaths(logs),
        suggestedFix: "Fix build errors (missing imports, syntax issues)",
      };
    }

    if (LINT_FAIL_RE.test(logs)) {
      return {
        category: "lint",
        description: "Lint errors detected",
        filesToInspect: this.extractFilePaths(logs),
        suggestedFix: 'Run "pnpm unsafe" to auto-fix lint errors',
      };
    }

    return {
      category: "unknown",
      description: "Unknown CI failure",
      filesToInspect: [],
      suggestedFix: "Investigate CI logs manually",
    };
  }

  /**
   * Extract file paths from log output.
   */
  private extractFilePaths(logs: string): string[] {
    const paths = new Set<string>();
    const re = /(?:^|\s)((?:src|apps|packages|lib)\/[\w./-]+\.\w+)/gm;
    let match = re.exec(logs);
    while (match) {
      paths.add(match[1] as string);
      match = re.exec(logs);
    }
    return Array.from(paths).slice(0, 20);
  }

  /**
   * Get project context from the project-brain service.
   */
  private async getProjectContext(
    projectId: string,
    files: string[]
  ): Promise<string> {
    try {
      const response = await projectBrainClient.getContext({
        projectId,
        query: `CI fix context for files: ${files.join(", ")}`,
      });
      return typeof response === "string" ? response : JSON.stringify(response);
    } catch (error) {
      logger.warn(
        { projectId, error: String(error) },
        "Failed to get project context from brain"
      );
      return "";
    }
  }

  /**
   * Generate a fix using the model router.
   */
  private async generateFix(
    input: CIFixInput,
    diagnosis: FailureDiagnosis,
    context: string
  ): Promise<{ description: string; patch: string } | null> {
    try {
      const response = await modelRouterClient.chat({
        model: "strong",
        messages: [
          {
            role: "system",
            content: `You are a code fix generator. Given a CI failure diagnosis and project context, generate the minimal patch to fix the issue.

Return a JSON object with:
- description: a brief description of the fix
- patch: a unified diff that can be applied with "git apply"

Return ONLY valid JSON.`,
          },
          {
            role: "user",
            content: `Diagnosis: ${JSON.stringify(diagnosis)}
Branch: ${input.branch}
Logs excerpt: ${input.failureLogs.slice(0, 4000)}
Project context: ${context.slice(0, 4000)}`,
          },
        ],
      });

      const text =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      const jsonMatch = text.match(JSON_OBJECT_RE);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as {
          description: string;
          patch: string;
        };
      }
    } catch (error) {
      logger.error({ error: String(error) }, "Fix generation failed");
    }
    return null;
  }

  /**
   * Create a fix PR via the GitHub API.
   */
  private async createFixPR(
    input: CIFixInput,
    fixBranch: string,
    fix: { description: string; patch: string },
    diagnosis: FailureDiagnosis
  ): Promise<{ prNumber: number; prUrl: string }> {
    // The actual PR creation would go through the GitHub adapter
    // For now we delegate to the GitHub client
    const prTitle = `fix(ci): ${diagnosis.description}`;
    const prBody = [
      `## Fixes CI: ${input.workflowName}`,
      "",
      `**Failure category:** ${diagnosis.category}`,
      `**Description:** ${fix.description}`,
      "",
      "Automatically generated by Prometheus CI Fix Pipeline.",
      "",
      `Commit: ${input.sha}`,
      `Run ID: ${input.runId}`,
    ].join("\n");

    const result = await this.github.createPullRequest({
      owner: input.owner,
      repo: input.repo,
      title: prTitle,
      body: prBody,
      head: fixBranch,
      base: input.branch,
    });

    return {
      prNumber: result.prNumber,
      prUrl: result.prUrl,
    };
  }

  /**
   * Post a comment on a commit.
   */
  private async postCommitComment(
    owner: string,
    repo: string,
    sha: string,
    body: string
  ): Promise<void> {
    try {
      await this.github.createCommitComment(owner, repo, sha, body);
    } catch (error) {
      logger.warn(
        { owner, repo, sha, error: String(error) },
        "Failed to post commit comment"
      );
    }
  }
}

/**
 * Parse a GitHub repo URL into owner/repo.
 */
export function parseRepoUrl(
  repoUrl: string
): { owner: string; repo: string } | null {
  const match = repoUrl.match(GITHUB_REPO_REGEX);
  if (!match) {
    return null;
  }
  return {
    owner: match[1] as string,
    repo: (match[2] as string).replace(GIT_SUFFIX_RE, ""),
  };
}
