import { createLogger } from "@prometheus/logger";
import type { DeploymentConfig, DeploymentResult } from "./index";

const logger = createLogger("vercel-provider");

/**
 * Deploy a project to Vercel via their REST API.
 * Requires VERCEL_TOKEN environment variable.
 */
export async function deployToVercel(
  config: DeploymentConfig
): Promise<DeploymentResult> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return {
      success: false,
      errorMessage:
        "VERCEL_TOKEN environment variable is not set. Configure it to enable Vercel deployments.",
    };
  }

  const teamId = process.env.VERCEL_TEAM_ID;

  try {
    logger.info(
      { projectId: config.projectId, branch: config.branch },
      "Starting Vercel deployment"
    );

    const body: Record<string, unknown> = {
      name: `prometheus-preview-${config.projectId.slice(0, 8)}`,
      target: "preview",
      ...(config.repoUrl
        ? {
            gitSource: {
              type: "github",
              repoUrl: config.repoUrl,
              ref: config.branch ?? "main",
            },
          }
        : {}),
      ...(config.envVars
        ? {
            env: Object.entries(config.envVars).map(([key, value]) => ({
              key,
              value,
              target: ["preview"],
            })),
          }
        : {}),
    };

    const url = teamId
      ? `https://api.vercel.com/v13/deployments?teamId=${teamId}`
      : "https://api.vercel.com/v13/deployments";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      logger.error(
        { status: res.status, errorText },
        "Vercel deployment API call failed"
      );
      return {
        success: false,
        errorMessage: `Vercel API error (${res.status}): ${errorText}`,
      };
    }

    const data = (await res.json()) as {
      id: string;
      url: string;
      readyState: string;
    };

    logger.info(
      { deploymentId: data.id, url: data.url },
      "Vercel deployment created"
    );

    return {
      success: true,
      url: `https://${data.url}`,
      providerDeploymentId: data.id,
      buildLogs: `https://vercel.com/deployments/${data.id}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Vercel deployment failed");
    return {
      success: false,
      errorMessage: `Vercel deployment failed: ${message}`,
    };
  }
}
