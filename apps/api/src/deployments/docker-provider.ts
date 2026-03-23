import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { DeploymentConfig, DeploymentResult } from "./index";

const logger = createLogger("docker-provider");

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

/**
 * Deploy a project as a Docker container via the sandbox-manager service.
 * Uses the existing sandbox infrastructure for local preview deployments.
 */
export async function deployToDocker(
  config: DeploymentConfig
): Promise<DeploymentResult> {
  try {
    logger.info(
      { projectId: config.projectId },
      "Starting Docker preview deployment"
    );

    const containerId = generateId("deploy");

    const res = await fetch(`${SANDBOX_MANAGER_URL}/containers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: containerId,
        projectId: config.projectId,
        orgId: config.orgId,
        type: "preview",
        env: config.envVars ?? {},
        ...(config.repoUrl ? { repoUrl: config.repoUrl } : {}),
        ...(config.branch ? { branch: config.branch } : {}),
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      logger.error(
        { status: res.status, errorText },
        "Sandbox manager container creation failed"
      );
      return {
        success: false,
        errorMessage: `Docker deployment failed (${res.status}): ${errorText}`,
      };
    }

    const data = (await res.json()) as {
      id: string;
      port: number;
      status: string;
    };

    const previewUrl = `http://localhost:${data.port}`;

    logger.info(
      { containerId: data.id, port: data.port },
      "Docker preview container created"
    );

    return {
      success: true,
      url: previewUrl,
      providerDeploymentId: data.id,
      buildLogs: `Container ${data.id} running on port ${data.port}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Docker deployment failed");
    return {
      success: false,
      errorMessage: `Docker deployment failed: ${message}`,
    };
  }
}
