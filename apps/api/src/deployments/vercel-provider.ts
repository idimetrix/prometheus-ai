import { createLogger } from "@prometheus/logger";
import type { DeploymentConfig, DeploymentResult } from "./index";

const logger = createLogger("vercel-provider");

const VERCEL_API = "https://api.vercel.com";

/** Maximum number of poll iterations before giving up. */
const MAX_POLL_ITERATIONS = 60;
/** Delay between poll requests in milliseconds. */
const POLL_INTERVAL_MS = 5000;

function getVercelHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function buildUrl(path: string, teamId?: string): string {
  const base = `${VERCEL_API}${path}`;
  if (!teamId) {
    return base;
  }
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}teamId=${teamId}`;
}

/**
 * Poll Vercel deployment status until it reaches a terminal state.
 * Returns the final readyState.
 */
export async function pollVercelDeployment(
  deploymentId: string,
  token: string,
  teamId?: string
): Promise<{
  ready: boolean;
  state: string;
  url?: string;
  errorMessage?: string;
  buildLogs?: string;
}> {
  for (let i = 0; i < MAX_POLL_ITERATIONS; i++) {
    const res = await fetch(
      buildUrl(`/v13/deployments/${deploymentId}`, teamId),
      { headers: getVercelHeaders(token) }
    );

    if (!res.ok) {
      return {
        ready: false,
        state: "ERROR",
        errorMessage: `Failed to fetch deployment status (${res.status})`,
      };
    }

    const data = (await res.json()) as {
      id: string;
      url?: string;
      readyState: string;
      errorMessage?: string;
    };

    const state = data.readyState;

    if (state === "READY") {
      return {
        ready: true,
        state,
        url: data.url ? `https://${data.url}` : undefined,
      };
    }

    if (state === "ERROR" || state === "CANCELED") {
      return {
        ready: false,
        state,
        errorMessage:
          data.errorMessage ?? `Deployment ended with state: ${state}`,
      };
    }

    // Still building / queued -- wait and retry
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return {
    ready: false,
    state: "TIMEOUT",
    errorMessage: `Deployment did not reach READY state within ${(MAX_POLL_ITERATIONS * POLL_INTERVAL_MS) / 1000}s`,
  };
}

/**
 * Deploy a project to Vercel via their REST API.
 * Creates the deployment, then polls until a terminal state is reached.
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

    const url = buildUrl("/v13/deployments", teamId);

    const res = await fetch(url, {
      method: "POST",
      headers: getVercelHeaders(token),
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
      { deploymentId: data.id, url: data.url, readyState: data.readyState },
      "Vercel deployment created, polling for completion"
    );

    // If the deployment is already ready (e.g. instant deploys), return immediately
    if (data.readyState === "READY") {
      return {
        success: true,
        url: `https://${data.url}`,
        providerDeploymentId: data.id,
        buildLogs: `Deployment completed instantly. View at https://vercel.com/deployments/${data.id}`,
      };
    }

    // Poll until terminal state
    const pollResult = await pollVercelDeployment(data.id, token, teamId);

    if (pollResult.ready) {
      logger.info(
        { deploymentId: data.id, url: pollResult.url },
        "Vercel deployment is live"
      );
      return {
        success: true,
        url: pollResult.url ?? `https://${data.url}`,
        providerDeploymentId: data.id,
        buildLogs: `Deployment completed. View at https://vercel.com/deployments/${data.id}`,
      };
    }

    logger.error(
      { deploymentId: data.id, state: pollResult.state },
      "Vercel deployment failed after polling"
    );
    return {
      success: false,
      providerDeploymentId: data.id,
      errorMessage: pollResult.errorMessage ?? "Deployment failed",
      buildLogs: `Deployment ended with state ${pollResult.state}. View at https://vercel.com/deployments/${data.id}`,
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

/**
 * Fetch the current status of a Vercel deployment.
 */
export async function getVercelDeploymentStatus(
  providerDeploymentId: string
): Promise<{
  state: string;
  url?: string;
  ready: boolean;
  errorMessage?: string;
}> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return {
      state: "unknown",
      ready: false,
      errorMessage: "VERCEL_TOKEN not set",
    };
  }

  const teamId = process.env.VERCEL_TEAM_ID;

  const res = await fetch(
    buildUrl(`/v13/deployments/${providerDeploymentId}`, teamId),
    { headers: getVercelHeaders(token) }
  );

  if (!res.ok) {
    return {
      state: "unknown",
      ready: false,
      errorMessage: `Vercel API error (${res.status})`,
    };
  }

  const data = (await res.json()) as {
    readyState: string;
    url?: string;
    errorMessage?: string;
  };

  return {
    state: data.readyState,
    url: data.url ? `https://${data.url}` : undefined,
    ready: data.readyState === "READY",
    errorMessage: data.readyState === "ERROR" ? data.errorMessage : undefined,
  };
}
