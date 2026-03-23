import { createLogger } from "@prometheus/logger";
import type { DeploymentConfig, DeploymentResult } from "./index";

const logger = createLogger("netlify-provider");

/**
 * Deploy a project to Netlify via their REST API.
 * Requires NETLIFY_TOKEN environment variable.
 */
export async function deployToNetlify(
  config: DeploymentConfig
): Promise<DeploymentResult> {
  const token = process.env.NETLIFY_TOKEN;
  if (!token) {
    return {
      success: false,
      errorMessage:
        "NETLIFY_TOKEN environment variable is not set. Configure it to enable Netlify deployments.",
    };
  }

  try {
    logger.info(
      { projectId: config.projectId, branch: config.branch },
      "Starting Netlify deployment"
    );

    // Step 1: Create a new site (or use existing)
    const siteName = `prometheus-preview-${config.projectId.slice(0, 8)}-${Date.now()}`;

    const createRes = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: siteName,
        ...(config.repoUrl
          ? {
              repo: {
                provider: "github",
                repo_url: config.repoUrl,
                branch: config.branch ?? "main",
              },
            }
          : {}),
      }),
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      logger.error(
        { status: createRes.status, errorText },
        "Netlify site creation failed"
      );
      return {
        success: false,
        errorMessage: `Netlify API error (${createRes.status}): ${errorText}`,
      };
    }

    const site = (await createRes.json()) as {
      id: string;
      url: string;
      ssl_url: string;
      admin_url: string;
      deploy_id: string;
    };

    logger.info({ siteId: site.id, url: site.ssl_url }, "Netlify site created");

    return {
      success: true,
      url: site.ssl_url || site.url,
      providerDeploymentId: site.id,
      buildLogs: site.admin_url,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Netlify deployment failed");
    return {
      success: false,
      errorMessage: `Netlify deployment failed: ${message}`,
    };
  }
}
