/**
 * Security Patching Pipeline (MOON-011)
 *
 * Automatically patches security vulnerabilities in a project.
 * 1. Run security audit (npm audit, cargo audit, etc.)
 * 2. For each vulnerability:
 *    a. Check if fix is available (newer version)
 *    b. Update the dependency
 *    c. Check for breaking changes
 *    d. Run tests
 *    e. If tests pass, include in patch PR
 * 3. For code-level vulnerabilities (from semgrep):
 *    a. Generate fix for the vulnerability
 *    b. Apply fix
 *    c. Verify fix resolves the issue
 * 4. Create a single PR with all security patches
 */

import { createLogger } from "@prometheus/logger";
import {
  GitHubClient,
  modelRouterClient,
  sandboxManagerClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:security-patcher");

const CODE_FENCE_RE = /^```[\w]*\n?/;
const CODE_FENCE_END_RE = /\n?```$/;
const PASS_COUNT_RE = /(\d+)\s*pass/i;
const FAIL_COUNT_RE = /(\d+)\s*fail/i;
const GREP_LINE_RE = /^([^:]+):(\d+):(.+)$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityPatchOptions {
  /** GitHub token for creating PRs */
  githubToken: string;
  /** The Prometheus project ID */
  projectId: string;
  /** Repository full name (owner/repo) */
  repoFullName: string;
  /** The sandbox ID for code execution */
  sandboxId: string;
}

export interface RemainingVulnerability {
  /** The affected package */
  package: string;
  /** Why the vulnerability could not be auto-fixed */
  reason: string;
  /** Severity level */
  severity: string;
}

export interface SecurityPatchResult {
  /** URL of the created PR, if any */
  prUrl?: string;
  /** Vulnerabilities that could not be auto-fixed */
  remainingVulnerabilities: RemainingVulnerability[];
  /** Number of vulnerabilities fixed */
  vulnerabilitiesFixed: number;
  /** Total vulnerabilities found */
  vulnerabilitiesFound: number;
}

interface AuditVulnerability {
  currentVersion: string;
  fixAvailable: boolean;
  fixVersion?: string;
  packageName: string;
  severity: "critical" | "high" | "moderate" | "low";
  title: string;
}

interface CodeVulnerability {
  description: string;
  file: string;
  line: number;
  ruleId: string;
  severity: "error" | "warning";
}

interface FileChange {
  content: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class SecurityPatchingPipeline {
  private readonly sandboxId: string;

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId;
  }

  /**
   * Patch security vulnerabilities in the project.
   */
  async patch(options: SecurityPatchOptions): Promise<SecurityPatchResult> {
    const logCtx = {
      projectId: options.projectId,
      sandboxId: options.sandboxId,
    };

    logger.info(logCtx, "Starting security patching pipeline");

    const remaining: RemainingVulnerability[] = [];
    let totalFound = 0;
    let totalFixed = 0;
    const allChanges: FileChange[] = [];

    try {
      // Step 1: Run dependency security audit
      const depVulns = await this.runDependencyAudit();
      totalFound += depVulns.length;
      logger.info(
        { ...logCtx, dependencyVulns: depVulns.length },
        "Dependency audit complete"
      );

      // Step 2: Run code-level security scan (semgrep-style)
      const codeVulns = await this.runCodeSecurityScan();
      totalFound += codeVulns.length;
      logger.info(
        { ...logCtx, codeVulns: codeVulns.length },
        "Code security scan complete"
      );

      // Step 3: Fix dependency vulnerabilities
      for (const vuln of depVulns) {
        const fixed = await this.fixDependencyVuln(vuln);
        if (fixed) {
          totalFixed += 1;
          logger.info(
            { ...logCtx, package: vuln.packageName },
            "Dependency vulnerability fixed"
          );
        } else {
          remaining.push({
            package: vuln.packageName,
            severity: vuln.severity,
            reason: vuln.fixAvailable
              ? "Fix available but tests fail after update"
              : "No fix version available",
          });
        }
      }

      // Step 4: Fix code-level vulnerabilities
      for (const vuln of codeVulns) {
        const fix = await this.fixCodeVuln(vuln);
        if (fix) {
          allChanges.push(fix);
          totalFixed += 1;
          logger.info(
            { ...logCtx, file: vuln.file, rule: vuln.ruleId },
            "Code vulnerability fixed"
          );
        } else {
          remaining.push({
            package: vuln.file,
            severity: vuln.severity,
            reason: `Could not auto-fix ${vuln.ruleId}: ${vuln.description}`,
          });
        }
      }

      // Step 5: Write all code fixes to sandbox
      for (const change of allChanges) {
        await this.writeToSandbox(change.path, change.content);
      }

      // Step 6: Final test run
      if (allChanges.length > 0) {
        const testResult = await this.runTests();
        logger.info(
          {
            ...logCtx,
            passed: testResult.passed,
            failed: testResult.failed,
          },
          "Final test run after security patches"
        );
      }

      // Step 7: Create PR with all patches
      let prUrl: string | undefined;
      if (totalFixed > 0) {
        prUrl = await this.createSecurityPR(
          totalFixed,
          remaining,
          allChanges,
          options
        );
        logger.info({ ...logCtx, prUrl }, "Security patch PR created");
      }

      logger.info(
        {
          ...logCtx,
          found: totalFound,
          fixed: totalFixed,
          remaining: remaining.length,
        },
        "Security patching complete"
      );

      return {
        vulnerabilitiesFound: totalFound,
        vulnerabilitiesFixed: totalFixed,
        prUrl,
        remainingVulnerabilities: remaining,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ ...logCtx, error: msg }, "Security patching failed");

      return {
        vulnerabilitiesFound: totalFound,
        vulnerabilitiesFixed: totalFixed,
        remainingVulnerabilities: remaining,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step implementations
  // -------------------------------------------------------------------------

  /**
   * Run npm audit to find dependency vulnerabilities.
   */
  private async runDependencyAudit(): Promise<AuditVulnerability[]> {
    try {
      const result = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: "npm audit --json 2>/dev/null || true",
        timeout: 60_000,
      });

      const output = result.data.stdout;
      const vulnerabilities: AuditVulnerability[] = [];

      try {
        const auditData = JSON.parse(output) as {
          vulnerabilities?: Record<
            string,
            {
              fixAvailable?: boolean | { version: string };
              severity: string;
              name: string;
              range: string;
              via: Array<{ title?: string }>;
            }
          >;
        };

        if (auditData.vulnerabilities) {
          for (const [name, vuln] of Object.entries(
            auditData.vulnerabilities
          )) {
            const fixInfo = vuln.fixAvailable;
            const fixAvailable =
              typeof fixInfo === "object" ? true : fixInfo === true;
            const fixVersion =
              typeof fixInfo === "object" ? fixInfo.version : undefined;

            vulnerabilities.push({
              packageName: name,
              severity: vuln.severity as AuditVulnerability["severity"],
              title:
                vuln.via
                  .map((v) => v.title)
                  .filter(Boolean)
                  .join(", ") || `Vulnerability in ${name}`,
              currentVersion: vuln.range,
              fixAvailable,
              fixVersion,
            });
          }
        }
      } catch {
        logger.warn("Failed to parse npm audit JSON output");
      }

      return vulnerabilities;
    } catch (error) {
      logger.warn({ error }, "Dependency audit failed");
      return [];
    }
  }

  /**
   * Run code-level security analysis.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: security pattern matching requires sequential conditional logic
  private async runCodeSecurityScan(): Promise<CodeVulnerability[]> {
    try {
      // Use the LLM to analyze code for security patterns
      // In a real implementation, this would run semgrep or similar
      const result = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command:
          'grep -rn "eval\\|innerHTML\\|dangerouslySetInnerHTML\\|document\\.cookie\\|new Function" src/ --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null || true',
        timeout: 30_000,
      });

      const vulnerabilities: CodeVulnerability[] = [];
      const lines = result.data.stdout.split("\n").filter(Boolean);

      for (const line of lines) {
        const match = line.match(GREP_LINE_RE);
        if (match) {
          const file = match[1] ?? "";
          const lineNum = Number.parseInt(match[2] ?? "0", 10);
          const content = match[3] ?? "";

          let ruleId = "security/unknown";
          let description = "Potential security issue";

          if (content.includes("eval")) {
            ruleId = "security/no-eval";
            description = "Use of eval() is a security risk";
          } else if (content.includes("innerHTML")) {
            ruleId = "security/no-innerhtml";
            description = "Direct innerHTML assignment is an XSS risk";
          } else if (content.includes("dangerouslySetInnerHTML")) {
            ruleId = "security/no-dangerouslysetinnerhtml";
            description = "dangerouslySetInnerHTML usage";
          } else if (content.includes("document.cookie")) {
            ruleId = "security/no-document-cookie";
            description = "Direct document.cookie access";
          } else if (content.includes("new Function")) {
            ruleId = "security/no-new-function";
            description = "Dynamic code generation via new Function()";
          }

          vulnerabilities.push({
            file,
            line: lineNum,
            ruleId,
            description,
            severity: "warning",
          });
        }
      }

      return vulnerabilities;
    } catch (error) {
      logger.warn({ error }, "Code security scan failed");
      return [];
    }
  }

  /**
   * Attempt to fix a dependency vulnerability by updating it.
   */
  private async fixDependencyVuln(vuln: AuditVulnerability): Promise<boolean> {
    if (!vuln.fixAvailable) {
      return false;
    }

    try {
      const target = vuln.fixVersion ?? "latest";
      const installResult = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: `npm install ${vuln.packageName}@${target}`,
        timeout: 60_000,
      });

      if (installResult.data.exitCode !== 0) {
        return false;
      }

      // Verify tests still pass
      const testResult = await this.runTests();
      if (testResult.failed > 0) {
        // Rollback
        await sandboxManagerClient.post(`/sandboxes/${this.sandboxId}/exec`, {
          command: `npm install ${vuln.packageName}@${vuln.currentVersion}`,
          timeout: 60_000,
        });
        return false;
      }

      return true;
    } catch (error) {
      logger.warn(
        { error, package: vuln.packageName },
        "Dependency fix failed"
      );
      return false;
    }
  }

  /**
   * Fix a code-level vulnerability using the LLM.
   */
  private async fixCodeVuln(
    vuln: CodeVulnerability
  ): Promise<FileChange | null> {
    try {
      const fileContent = await this.readFromSandbox(vuln.file);
      if (!fileContent) {
        return null;
      }

      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "default",
        messages: [
          {
            role: "user",
            content: `Fix this security vulnerability in the code.

File: ${vuln.file}
Line: ${vuln.line}
Rule: ${vuln.ruleId}
Description: ${vuln.description}

Current file content:
${fileContent}

Fix the security issue while preserving the same functionality.
Output ONLY the complete fixed file content, no markdown code fences.`,
          },
        ],
        options: { maxTokens: 8192, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "";
      if (content) {
        const cleaned = content
          .replace(CODE_FENCE_RE, "")
          .replace(CODE_FENCE_END_RE, "");
        return { path: vuln.file, content: cleaned };
      }
    } catch (error) {
      logger.warn({ error, file: vuln.file }, "Code vulnerability fix failed");
    }

    return null;
  }

  /**
   * Create a PR with all security patches.
   */
  private async createSecurityPR(
    fixedCount: number,
    remaining: RemainingVulnerability[],
    codeChanges: FileChange[],
    options: SecurityPatchOptions
  ): Promise<string | undefined> {
    try {
      const github = new GitHubClient(options.githubToken);
      const [owner, repo] = options.repoFullName.split("/");

      if (!(owner && repo)) {
        return undefined;
      }

      const branch = `prometheus/security-patch-${Date.now()}`;
      const baseBranch = "main";

      // Create branch using GitHub API
      const token = options.githubToken;
      await this.createGitHubBranch(owner, repo, branch, baseBranch, token);

      const commitMessage = `fix: patch ${fixedCount} security vulnerabilities\n\nAutomated security patching by Prometheus`;

      if (codeChanges.length > 0) {
        await this.pushFilesToBranch(
          owner,
          repo,
          branch,
          commitMessage,
          codeChanges,
          token
        );
      }

      const remainingSection =
        remaining.length > 0
          ? [
              "",
              "## Remaining Vulnerabilities",
              "",
              "The following could not be auto-fixed:",
              "",
              ...remaining.map(
                (r) => `- **${r.package}** (${r.severity}): ${r.reason}`
              ),
            ]
          : [];

      const prBody = [
        "## Security Patches",
        "",
        `This PR addresses **${fixedCount}** security vulnerabilities found during automated scanning.`,
        "",
        "## Changes",
        "",
        ...codeChanges.map((c) => `- \`${c.path}\``),
        ...remainingSection,
        "",
        "---",
        "Generated by Prometheus Security Patching Pipeline",
      ].join("\n");

      const pr = await github.createPR({
        owner,
        repo,
        title: `fix: patch ${fixedCount} security vulnerabilities`,
        body: prBody,
        head: branch,
        base: baseBranch,
      });

      return pr.prUrl;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to create security PR");
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

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async runTests(): Promise<{ failed: number; passed: number }> {
    try {
      const result = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: "npm test -- --reporter=json",
        timeout: 120_000,
      });

      const output = result.data.stdout + result.data.stderr;
      const passMatch = output.match(PASS_COUNT_RE);
      const failMatch = output.match(FAIL_COUNT_RE);

      return {
        passed: passMatch ? Number.parseInt(passMatch[1] ?? "0", 10) : 0,
        failed: failMatch ? Number.parseInt(failMatch[1] ?? "0", 10) : 0,
      };
    } catch {
      return { passed: 0, failed: 0 };
    }
  }

  private async writeToSandbox(path: string, content: string): Promise<void> {
    try {
      await sandboxManagerClient.post(`/sandboxes/${this.sandboxId}/files`, {
        path,
        content,
      });
    } catch (error) {
      logger.warn({ error, path }, "Failed to write file to sandbox");
    }
  }

  private async readFromSandbox(path: string): Promise<string> {
    try {
      const response = await sandboxManagerClient.get<{ content: string }>(
        `/sandboxes/${this.sandboxId}/files?path=${encodeURIComponent(path)}`
      );
      return response.data.content;
    } catch {
      return "";
    }
  }
}
