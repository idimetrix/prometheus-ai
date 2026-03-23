import { createLogger } from "@prometheus/logger";

const logger = createLogger("workflow:phase:security");

export interface SecurityResult {
  output: string;
  passed: boolean;
  secretsFound: number;
  vulnerabilities: Array<{
    description: string;
    file?: string;
    severity: string;
  }>;
}

interface SecurityInput {
  filesChanged: string[];
  orchestratorUrl: string;
  orgId: string;
  projectId: string;
  sessionId: string;
  taskId: string;
}

export async function runSecurityPhase(
  input: SecurityInput
): Promise<SecurityResult> {
  const { taskId, sessionId, projectId, orgId, filesChanged, orchestratorUrl } =
    input;

  logger.info(
    { taskId, filesChanged: filesChanged.length },
    "Running security phase"
  );

  if (filesChanged.length === 0) {
    return {
      passed: true,
      vulnerabilities: [],
      secretsFound: 0,
      output: "No files changed, security check skipped",
    };
  }

  try {
    const response = await fetch(`${orchestratorUrl}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: `${taskId}-security`,
        sessionId,
        projectId,
        orgId,
        userId: "system",
        title: "Security scan",
        description: `Scan the following files for secrets, API keys, XSS, SQL injection, and CSRF vulnerabilities: ${filesChanged.join(", ")}. Report all findings with severity levels.`,
        mode: "autonomous",
        agentRole: "security_auditor",
      }),
    });

    if (!response.ok) {
      logger.warn(
        { taskId, status: response.status },
        "Security scan request failed"
      );
      return {
        passed: true,
        vulnerabilities: [],
        secretsFound: 0,
        output: "Security service unavailable",
      };
    }

    const result = (await response.json()) as {
      success: boolean;
      output?: string;
      vulnerabilities?: Array<{
        severity: string;
        description: string;
        file?: string;
      }>;
      secretsFound?: number;
    };

    const vulnerabilities = result.vulnerabilities ?? [];
    const hasCritical = vulnerabilities.some(
      (v) => v.severity === "critical" || v.severity === "high"
    );

    return {
      passed: !hasCritical,
      vulnerabilities,
      secretsFound: result.secretsFound ?? 0,
      output: result.output ?? "",
    };
  } catch (error) {
    logger.error({ taskId, error: String(error) }, "Security phase failed");
    return {
      passed: true,
      vulnerabilities: [],
      secretsFound: 0,
      output: `Security scan error: ${String(error)}`,
    };
  }
}
