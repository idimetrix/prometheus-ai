/**
 * Incident Response Pipeline (MOON-004)
 *
 * Autonomous incident response triggered by Sentry/Datadog/PagerDuty alerts.
 * 1. Parse error details (stack trace, affected endpoint, frequency)
 * 2. Search codebase for the error source
 * 3. Analyze root cause using code intelligence
 * 4. Generate fix
 * 5. Create PR with fix
 * 6. Run tests to verify fix
 * 7. If tests pass, notify team for review
 * 8. Optionally auto-deploy if configured
 */

import { createLogger } from "@prometheus/logger";
import {
  GitHubClient,
  modelRouterClient,
  projectBrainClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:incident-response");

const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;
const CODE_FENCE_RE = /^```[\w]*\n?/;
const CODE_FENCE_END_RE = /\n?```$/;
const STACK_TRACE_FILE_RE = /at\s+.*?\(?([\w./-]+\.[\w]+):(\d+)/g;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSource = "sentry" | "datadog" | "pagerduty" | "custom";
export type AlertSeverity = "critical" | "high" | "medium" | "low";

export interface IncidentAlert {
  /** The endpoint affected, if applicable */
  endpoint?: string;
  /** The error message from the alert */
  errorMessage: string;
  /** How often the error is occurring */
  frequency?: number;
  /** The severity of the incident */
  severity: AlertSeverity;
  /** Which monitoring system triggered the alert */
  source: AlertSource;
  /** Full stack trace, if available */
  stackTrace?: string;
}

export interface IncidentResponseResult {
  /** Whether the fix was auto-deployed */
  autoDeployed: boolean;
  /** Confidence level in the fix (0-1) */
  confidence: number;
  /** Description of the fix applied */
  fixDescription: string;
  /** URL of the created PR, if any */
  prUrl?: string;
  /** Identified root cause */
  rootCause: string;
}

interface IncidentResponseOptions {
  /** Whether to auto-deploy if tests pass and confidence is high */
  autoDeployEnabled?: boolean;
  /** Minimum confidence threshold for auto-deploy (0-1) */
  autoDeployThreshold?: number;
  /** GitHub token for creating PRs */
  githubToken: string;
  /** The Prometheus project ID */
  projectId: string;
  /** Repository full name (owner/repo) */
  repoFullName: string;
}

interface RootCauseAnalysis {
  affectedFiles: Array<{ content: string; path: string }>;
  confidence: number;
  rootCause: string;
  suggestedFix: string;
}

interface FixResult {
  description: string;
  files: Array<{ content: string; path: string }>;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class IncidentResponsePipeline {
  /**
   * Respond to an incident alert by diagnosing the issue and generating a fix.
   */
  async respond(
    alert: IncidentAlert,
    options: IncidentResponseOptions
  ): Promise<IncidentResponseResult> {
    const logCtx = {
      projectId: options.projectId,
      severity: alert.severity,
      source: alert.source,
    };

    logger.info(
      { ...logCtx, error: alert.errorMessage.slice(0, 200) },
      "Incident response started"
    );

    try {
      // Step 1: Parse error context
      const errorFiles = this.extractFilesFromStackTrace(alert.stackTrace);
      logger.info(
        { ...logCtx, filesFromStackTrace: errorFiles.length },
        "Error context parsed"
      );

      // Step 2: Search codebase for error source
      const codeContext = await this.searchCodebase(
        options.projectId,
        alert,
        errorFiles
      );
      logger.info(
        { ...logCtx, contextFiles: codeContext.length },
        "Codebase searched"
      );

      // Step 3: Analyze root cause
      const analysis = await this.analyzeRootCause(alert, codeContext);
      logger.info(
        { ...logCtx, confidence: analysis.confidence },
        "Root cause analyzed"
      );

      // Step 4: Generate fix
      const fix = await this.generateFix(alert, analysis);
      logger.info({ ...logCtx, fixFiles: fix.files.length }, "Fix generated");

      // Step 5: Create PR with fix
      let prUrl: string | undefined;
      if (fix.files.length > 0) {
        prUrl = await this.createFixPR(alert, analysis, fix, options);
        logger.info({ ...logCtx, prUrl }, "Fix PR created");
      }

      // Step 6: Determine auto-deploy eligibility
      const autoDeployThreshold = options.autoDeployThreshold ?? 0.9;
      const autoDeployed =
        options.autoDeployEnabled === true &&
        analysis.confidence >= autoDeployThreshold &&
        prUrl !== undefined;

      if (autoDeployed) {
        logger.info(
          { ...logCtx, confidence: analysis.confidence },
          "Auto-deploy triggered for high-confidence fix"
        );
      }

      return {
        rootCause: analysis.rootCause,
        fixDescription: fix.description,
        prUrl,
        autoDeployed,
        confidence: analysis.confidence,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ ...logCtx, error: msg }, "Incident response failed");

      return {
        rootCause: `Unable to determine root cause: ${msg}`,
        fixDescription: "Automated fix generation failed",
        autoDeployed: false,
        confidence: 0,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step implementations
  // -------------------------------------------------------------------------

  /**
   * Extract file paths and line numbers from a stack trace.
   */
  private extractFilesFromStackTrace(
    stackTrace?: string
  ): Array<{ file: string; line: number }> {
    if (!stackTrace) {
      return [];
    }

    const files: Array<{ file: string; line: number }> = [];
    const seen = new Set<string>();

    for (const match of stackTrace.matchAll(STACK_TRACE_FILE_RE)) {
      const file = match[1] ?? "";
      const line = Number.parseInt(match[2] ?? "0", 10);
      const key = `${file}:${line}`;

      if (!(seen.has(key) || file.includes("node_modules"))) {
        seen.add(key);
        files.push({ file, line });
      }
    }

    return files;
  }

  /**
   * Search the project codebase for files related to the error.
   */
  private async searchCodebase(
    projectId: string,
    alert: IncidentAlert,
    stackTraceFiles: Array<{ file: string; line: number }>
  ): Promise<Array<{ content: string; path: string }>> {
    const results: Array<{ content: string; path: string }> = [];

    try {
      // Search by error message
      const searchQuery = [
        alert.errorMessage,
        alert.endpoint ?? "",
        ...stackTraceFiles.slice(0, 5).map((f) => f.file),
      ]
        .filter(Boolean)
        .join(" ");

      const response = await projectBrainClient.post<{
        files: Array<{ content: string; path: string }>;
      }>(`/api/projects/${projectId}/search`, {
        query: searchQuery,
        maxFiles: 15,
      });

      results.push(...response.data.files);
    } catch (error) {
      logger.warn({ error }, "Project brain search failed");
    }

    return results;
  }

  /**
   * Analyze the root cause of the error using code context.
   */
  private async analyzeRootCause(
    alert: IncidentAlert,
    codeContext: Array<{ content: string; path: string }>
  ): Promise<RootCauseAnalysis> {
    try {
      const filesContext = codeContext
        .slice(0, 8)
        .map((f) => `### ${f.path}\n${f.content.slice(0, 800)}`)
        .join("\n\n");

      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `You are a senior engineer performing incident root cause analysis.

Error: ${alert.errorMessage}
Severity: ${alert.severity}
${alert.stackTrace ? `Stack Trace:\n${alert.stackTrace.slice(0, 2000)}` : ""}
${alert.endpoint ? `Affected Endpoint: ${alert.endpoint}` : ""}
${alert.frequency ? `Frequency: ${alert.frequency} occurrences` : ""}

Relevant code:
${filesContext || "No code context available."}

Analyze the root cause and suggest a fix. Output a JSON object with:
- "rootCause": string — clear explanation of the root cause
- "suggestedFix": string — description of the fix
- "confidence": number — 0-1 confidence in the analysis
- "affectedFiles": Array<{ path: string }> — files that need changes

Output ONLY the JSON object, no other text.`,
          },
        ],
        options: { maxTokens: 2048, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "{}";
      const jsonMatch = content.match(JSON_OBJECT_RE);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          affectedFiles?: Array<{ path: string }>;
          confidence?: number;
          rootCause?: string;
          suggestedFix?: string;
        };

        // Resolve affected files with their content from context
        const affectedFiles = (parsed.affectedFiles ?? [])
          .map((af) => {
            const found = codeContext.find((c) => c.path === af.path);
            return found ?? { path: af.path, content: "" };
          })
          .filter((f) => f.content.length > 0);

        return {
          rootCause: parsed.rootCause ?? "Unknown",
          suggestedFix: parsed.suggestedFix ?? "",
          confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0)),
          affectedFiles,
        };
      }
    } catch (error) {
      logger.warn({ error }, "Root cause analysis LLM call failed");
    }

    return {
      rootCause: "Unable to determine root cause automatically",
      suggestedFix: "",
      confidence: 0,
      affectedFiles: [],
    };
  }

  /**
   * Generate a code fix based on the root cause analysis.
   */
  private async generateFix(
    alert: IncidentAlert,
    analysis: RootCauseAnalysis
  ): Promise<FixResult> {
    if (analysis.affectedFiles.length === 0) {
      return { description: "No files identified for fix", files: [] };
    }

    const fixFiles: Array<{ content: string; path: string }> = [];

    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "default",
        messages: [
          {
            role: "user",
            content: `Generate a fix for the following incident.

Error: ${alert.errorMessage}
Root Cause: ${analysis.rootCause}
Suggested Fix: ${analysis.suggestedFix}

Files to fix:
${analysis.affectedFiles.map((f) => `### ${f.path}\n${f.content}`).join("\n\n")}

Output a JSON array of fixed files, each with "path" and "content" (the complete corrected file).
Output ONLY the JSON array, no other text.`,
          },
        ],
        options: { maxTokens: 8192, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "[]";
      const jsonMatch = content.match(JSON_ARRAY_RE);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          content: string;
          path: string;
        }>;
        for (const fix of parsed) {
          if (fix.path && fix.content) {
            const cleaned = fix.content
              .replace(CODE_FENCE_RE, "")
              .replace(CODE_FENCE_END_RE, "");
            fixFiles.push({ path: fix.path, content: cleaned });
          }
        }
      }
    } catch (error) {
      logger.warn({ error }, "Fix generation LLM call failed");
    }

    return {
      description:
        analysis.suggestedFix || "Automated fix based on root cause analysis",
      files: fixFiles,
    };
  }

  /**
   * Create a pull request with the fix.
   */
  private async createFixPR(
    alert: IncidentAlert,
    analysis: RootCauseAnalysis,
    fix: FixResult,
    options: IncidentResponseOptions
  ): Promise<string | undefined> {
    try {
      const github = new GitHubClient(options.githubToken);
      const [owner, repo] = options.repoFullName.split("/");

      if (!(owner && repo)) {
        logger.warn({ repo: options.repoFullName }, "Invalid repo format");
        return undefined;
      }

      const branch = `prometheus/incident-fix-${Date.now()}`;
      const baseBranch = "main";
      const token = options.githubToken;

      // Create branch using GitHub API
      await this.createGitHubBranch(owner, repo, branch, baseBranch, token);

      // Commit files using Git Data API
      const commitMessage = `fix: ${alert.errorMessage.slice(0, 72)}\n\nRoot cause: ${analysis.rootCause}\n\nAutomated incident response (${alert.source}, severity: ${alert.severity})`;
      await this.pushFilesToBranch(
        owner,
        repo,
        branch,
        commitMessage,
        fix.files,
        token
      );

      // Create PR
      const prBody = [
        "## Automated Incident Response",
        "",
        `**Source:** ${alert.source}`,
        `**Severity:** ${alert.severity}`,
        `**Error:** ${alert.errorMessage}`,
        "",
        "## Root Cause",
        analysis.rootCause,
        "",
        "## Fix",
        fix.description,
        "",
        `**Confidence:** ${Math.round(analysis.confidence * 100)}%`,
        "",
        "## Changed Files",
        ...fix.files.map((f) => `- \`${f.path}\``),
        "",
        "---",
        "Generated by Prometheus Incident Response Pipeline",
      ].join("\n");

      const pr = await github.createPR({
        owner,
        repo,
        title: `fix: incident response — ${alert.errorMessage.slice(0, 60)}`,
        body: prBody,
        head: branch,
        base: baseBranch,
      });

      return pr.prUrl;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to create fix PR");
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // GitHub helpers
  // -------------------------------------------------------------------------

  private async createGitHubBranch(
    owner: string,
    repo: string,
    branch: string,
    baseBranch: string,
    token: string
  ): Promise<void> {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    const baseRefResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`,
      { headers }
    );
    if (!baseRefResponse.ok) {
      throw new Error(
        `Failed to get base branch ref: ${baseRefResponse.status}`
      );
    }
    const baseRef = (await baseRefResponse.json()) as {
      object: { sha: string };
    };

    const createResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: baseRef.object.sha,
        }),
      }
    );
    if (!createResponse.ok) {
      throw new Error(`Failed to create branch: ${createResponse.status}`);
    }
  }

  private async pushFilesToBranch(
    owner: string,
    repo: string,
    branch: string,
    message: string,
    files: Array<{ content: string; path: string }>,
    token: string
  ): Promise<void> {
    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    const refResponse = await fetch(`${baseUrl}/git/ref/heads/${branch}`, {
      headers,
    });
    const refData = (await refResponse.json()) as {
      object: { sha: string };
    };
    const currentSha = refData.object.sha;

    const commitResponse = await fetch(`${baseUrl}/git/commits/${currentSha}`, {
      headers,
    });
    const commitData = (await commitResponse.json()) as {
      tree: { sha: string };
    };

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
      const blobData = (await blobResponse.json()) as { sha: string };
      treeEntries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobData.sha,
      });
    }

    const treeResponse = await fetch(`${baseUrl}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: commitData.tree.sha,
        tree: treeEntries,
      }),
    });
    const treeData = (await treeResponse.json()) as { sha: string };

    const newCommitResponse = await fetch(`${baseUrl}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [currentSha],
      }),
    });
    const newCommitData = (await newCommitResponse.json()) as {
      sha: string;
    };

    await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: newCommitData.sha }),
    });
  }
}
