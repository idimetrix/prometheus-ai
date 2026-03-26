import { createLogger } from "@prometheus/logger";
import type { DeploymentConfig, DeploymentResult } from "./index";

const logger = createLogger("netlify-provider");

const NETLIFY_API = "https://api.netlify.com/api/v1";

/** Maximum number of poll iterations before giving up. */
const MAX_POLL_ITERATIONS = 60;
/** Delay between poll requests in milliseconds. */
const POLL_INTERVAL_MS = 5000;

function getNetlifyHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Find an existing Netlify site for the project, or return null.
 */
async function findExistingSite(
  projectId: string,
  token: string
): Promise<{
  id: string;
  url: string;
  ssl_url: string;
  admin_url: string;
} | null> {
  const siteName = `prometheus-preview-${projectId.slice(0, 8)}`;

  const res = await fetch(`${NETLIFY_API}/sites?name=${siteName}&per_page=1`, {
    headers: getNetlifyHeaders(token),
  });

  if (!res.ok) {
    return null;
  }

  const sites = (await res.json()) as Array<{
    id: string;
    name: string;
    url: string;
    ssl_url: string;
    admin_url: string;
  }>;

  const match = sites.find((s) => s.name === siteName);
  return match ?? null;
}

/**
 * Create a new Netlify site for the given project.
 */
async function createSite(
  projectId: string,
  config: DeploymentConfig,
  token: string
): Promise<{
  id: string;
  url: string;
  ssl_url: string;
  admin_url: string;
  deploy_id?: string;
}> {
  const siteName = `prometheus-preview-${projectId.slice(0, 8)}`;

  const body: Record<string, unknown> = {
    name: siteName,
    ...(config.repoUrl
      ? {
          repo: {
            provider: "github",
            repo_url: config.repoUrl,
            branch: config.branch ?? "main",
            cmd: "npm run build",
            dir: "dist",
          },
        }
      : {}),
  };

  const res = await fetch(`${NETLIFY_API}/sites`, {
    method: "POST",
    headers: getNetlifyHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Netlify site creation failed (${res.status}): ${errorText}`
    );
  }

  return (await res.json()) as {
    id: string;
    url: string;
    ssl_url: string;
    admin_url: string;
    deploy_id?: string;
  };
}

/**
 * Trigger a new deploy on an existing Netlify site.
 */
async function triggerDeploy(
  siteId: string,
  config: DeploymentConfig,
  token: string
): Promise<{
  id: string;
  state: string;
  ssl_url?: string;
  admin_url?: string;
}> {
  const body: Record<string, unknown> = {
    clear_cache: false,
    ...(config.branch ? { branch: config.branch } : {}),
  };

  const res = await fetch(`${NETLIFY_API}/sites/${siteId}/builds`, {
    method: "POST",
    headers: getNetlifyHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Netlify deploy trigger failed (${res.status}): ${errorText}`
    );
  }

  return (await res.json()) as {
    id: string;
    state: string;
    ssl_url?: string;
    admin_url?: string;
  };
}

/**
 * Poll a Netlify deploy until it reaches a terminal state.
 */
async function pollNetlifyDeploy(
  deployId: string,
  token: string
): Promise<{
  ready: boolean;
  state: string;
  url?: string;
  errorMessage?: string;
}> {
  for (let i = 0; i < MAX_POLL_ITERATIONS; i++) {
    const res = await fetch(`${NETLIFY_API}/deploys/${deployId}`, {
      headers: getNetlifyHeaders(token),
    });

    if (!res.ok) {
      return {
        ready: false,
        state: "error",
        errorMessage: `Failed to fetch deploy status (${res.status})`,
      };
    }

    const data = (await res.json()) as {
      id: string;
      state: string;
      ssl_url?: string;
      url?: string;
      error_message?: string;
    };

    if (data.state === "ready") {
      return {
        ready: true,
        state: data.state,
        url: data.ssl_url ?? data.url,
      };
    }

    if (data.state === "error") {
      return {
        ready: false,
        state: data.state,
        errorMessage: data.error_message ?? "Deployment failed",
      };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return {
    ready: false,
    state: "timeout",
    errorMessage: `Deploy did not complete within ${(MAX_POLL_ITERATIONS * POLL_INTERVAL_MS) / 1000}s`,
  };
}

/**
 * Deploy a project to Netlify via their REST API.
 * Creates a site if one does not exist, triggers a build, and polls for completion.
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

    // Step 1: Find or create a Netlify site
    const site = await findExistingSite(config.projectId, token);

    if (site) {
      logger.info(
        { siteId: site.id, projectId: config.projectId },
        "Found existing Netlify site, triggering new deploy"
      );

      // Trigger a new build on the existing site
      const build = await triggerDeploy(site.id, config, token);

      // Poll the deploy
      const pollResult = await pollNetlifyDeploy(build.id, token);

      if (pollResult.ready) {
        logger.info(
          { siteId: site.id, url: pollResult.url },
          "Netlify deployment is live"
        );
        return {
          success: true,
          url: pollResult.url ?? site.ssl_url ?? site.url,
          providerDeploymentId: site.id,
          buildLogs: site.admin_url,
        };
      }

      return {
        success: false,
        providerDeploymentId: site.id,
        errorMessage: pollResult.errorMessage ?? "Deployment failed",
        buildLogs: site.admin_url,
      };
    }

    // No existing site -- create a new one
    const newSite = await createSite(config.projectId, config, token);

    logger.info(
      { siteId: newSite.id, url: newSite.ssl_url },
      "Created new Netlify site"
    );

    // If a deploy was automatically created with the site (repo-linked), poll it
    if (newSite.deploy_id) {
      const pollResult = await pollNetlifyDeploy(newSite.deploy_id, token);

      if (pollResult.ready) {
        return {
          success: true,
          url: pollResult.url ?? newSite.ssl_url ?? newSite.url,
          providerDeploymentId: newSite.id,
          buildLogs: newSite.admin_url,
        };
      }

      return {
        success: false,
        providerDeploymentId: newSite.id,
        errorMessage: pollResult.errorMessage ?? "Initial deploy failed",
        buildLogs: newSite.admin_url,
      };
    }

    // Site created without a linked repo -- return success immediately
    return {
      success: true,
      url: newSite.ssl_url || newSite.url,
      providerDeploymentId: newSite.id,
      buildLogs: newSite.admin_url,
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

/**
 * Fetch the current status of a Netlify site/deploy.
 */
export async function getNetlifyDeploymentStatus(siteId: string): Promise<{
  state: string;
  url?: string;
  ready: boolean;
  errorMessage?: string;
}> {
  const token = process.env.NETLIFY_TOKEN;
  if (!token) {
    return {
      state: "unknown",
      ready: false,
      errorMessage: "NETLIFY_TOKEN not set",
    };
  }

  const res = await fetch(`${NETLIFY_API}/sites/${siteId}`, {
    headers: getNetlifyHeaders(token),
  });

  if (!res.ok) {
    return {
      state: "unknown",
      ready: false,
      errorMessage: `Netlify API error (${res.status})`,
    };
  }

  const data = (await res.json()) as {
    published_deploy?: {
      state: string;
      ssl_url?: string;
      error_message?: string;
    };
    ssl_url?: string;
  };

  const deploy = data.published_deploy;
  if (!deploy) {
    return { state: "pending", ready: false, url: data.ssl_url };
  }

  return {
    state: deploy.state,
    url: deploy.ssl_url ?? data.ssl_url,
    ready: deploy.state === "ready",
    errorMessage: deploy.state === "error" ? deploy.error_message : undefined,
  };
}
