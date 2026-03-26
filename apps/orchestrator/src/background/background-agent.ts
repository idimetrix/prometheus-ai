import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:background");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

export type BackgroundTaskType =
  | "full-index"
  | "security-sweep"
  | "convention-extract"
  | "test-coverage"
  | "dependency-audit";

export interface BackgroundTaskConfig {
  orgId: string;
  params?: Record<string, unknown>;
  projectId: string;
  sessionId: string;
  taskType: BackgroundTaskType;
  userId: string;
}

export interface BackgroundTaskResult {
  completedAt: Date;
  output: string;
  startedAt: Date;
  success: boolean;
  taskType: BackgroundTaskType;
}

/**
 * BackgroundAgent runs long-running, non-interactive tasks that improve
 * project quality without blocking user sessions. These use the
 * "background" model slot (free local models) to minimize cost.
 */
export class BackgroundAgent {
  /**
   * Execute a background task.
   */
  async execute(
    agentLoop: AgentLoop,
    config: BackgroundTaskConfig
  ): Promise<BackgroundTaskResult> {
    const startedAt = new Date();

    logger.info(
      { taskType: config.taskType, projectId: config.projectId },
      "Starting background task"
    );

    try {
      let output: string;

      switch (config.taskType) {
        case "full-index":
          output = await this.runFullIndex(config.projectId);
          break;
        case "security-sweep":
          output = await this.runSecuritySweep(agentLoop);
          break;
        case "convention-extract":
          output = await this.runConventionExtract(config.projectId);
          break;
        case "test-coverage":
          output = await this.runTestCoverage(agentLoop);
          break;
        case "dependency-audit":
          output = await this.runDependencyAudit(agentLoop);
          break;
        default:
          output = `Unknown background task type: ${config.taskType}`;
      }

      logger.info(
        {
          taskType: config.taskType,
          durationMs: Date.now() - startedAt.getTime(),
        },
        "Background task completed"
      );

      return {
        taskType: config.taskType,
        success: true,
        output,
        startedAt,
        completedAt: new Date(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { taskType: config.taskType, error: msg },
        "Background task failed"
      );

      return {
        taskType: config.taskType,
        success: false,
        output: `Error: ${msg}`,
        startedAt,
        completedAt: new Date(),
      };
    }
  }

  private async runFullIndex(projectId: string): Promise<string> {
    const response = await fetch(`${PROJECT_BRAIN_URL}/index/directory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({ projectId, dirPath: `/workspace/${projectId}` }),
      signal: AbortSignal.timeout(300_000), // 5 min timeout
    });

    if (response.ok) {
      const data = (await response.json()) as {
        filesIndexed?: number;
        chunksCreated?: number;
      };
      return `Indexed ${data.filesIndexed ?? 0} files, created ${data.chunksCreated ?? 0} chunks`;
    }

    throw new Error(`Indexing failed: ${response.status}`);
  }

  private async runSecuritySweep(agentLoop: AgentLoop): Promise<string> {
    const result = await agentLoop.executeTask(
      `Perform a comprehensive security audit of the entire codebase:
1. Check for OWASP Top 10 vulnerabilities
2. Scan for hardcoded secrets or credentials
3. Check dependency versions for known CVEs
4. Review authentication and authorization patterns
5. Check for SQL injection, XSS, CSRF vulnerabilities
6. Review file upload handling
7. Check error handling for information leakage

Report findings with severity (CRITICAL/HIGH/MEDIUM/LOW) and file locations.`,
      "security_auditor"
    );
    return result.output;
  }

  private async runConventionExtract(projectId: string): Promise<string> {
    const response = await fetch(`${PROJECT_BRAIN_URL}/conventions/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({
        projectId,
        files: [], // Empty means analyze all indexed files
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (response.ok) {
      const data = (await response.json()) as { conventions?: unknown[] };
      return `Extracted ${(data.conventions ?? []).length} conventions`;
    }

    throw new Error(`Convention extraction failed: ${response.status}`);
  }

  private async runTestCoverage(agentLoop: AgentLoop): Promise<string> {
    const result = await agentLoop.executeTask(
      `Run the full test suite with coverage reporting:
1. Execute: pnpm test -- --coverage
2. Parse the coverage output
3. Identify files with <80% coverage
4. List the top 10 least-covered critical files
5. Suggest specific test cases that would improve coverage

Focus on critical paths: authentication, billing, data access, API endpoints.`,
      "test_engineer"
    );
    return result.output;
  }

  private async runDependencyAudit(agentLoop: AgentLoop): Promise<string> {
    const result = await agentLoop.executeTask(
      `Audit all project dependencies:
1. Run: pnpm audit
2. Check for outdated packages: pnpm outdated
3. Identify unused dependencies
4. Check for license compatibility issues
5. Report any critical or high severity vulnerabilities

Prioritize findings by severity and provide remediation steps.`,
      "security_auditor"
    );
    return result.output;
  }
}
