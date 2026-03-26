import { createLogger } from "@prometheus/logger";
import { deployToDocker, getDockerDeploymentStatus } from "./docker-provider";
import {
  deployToNetlify,
  getNetlifyDeploymentStatus,
} from "./netlify-provider";
import { deployToVercel, getVercelDeploymentStatus } from "./vercel-provider";

const logger = createLogger("deployment-providers");

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DeploymentConfig {
  branch?: string;
  deploymentId: string;
  envVars?: Record<string, string>;
  orgId: string;
  projectId: string;
  provider: "vercel" | "netlify" | "cloudflare" | "docker";
  repoUrl?: string;
}

export interface DeploymentResult {
  buildLogs?: string;
  errorMessage?: string;
  providerDeploymentId?: string;
  success: boolean;
  url?: string;
}

export interface DeploymentStatusResult {
  errorMessage?: string;
  ready: boolean;
  state: string;
  url?: string;
}

export interface DeploymentProvider {
  deploy(config: DeploymentConfig): Promise<DeploymentResult>;
  getStatus(providerDeploymentId: string): Promise<DeploymentStatusResult>;
  teardown(providerDeploymentId: string): Promise<{ success: boolean }>;
}

// ─── Provider Factory ──────────────────────────────────────────────────────

const providers: Record<string, DeploymentProvider> = {
  vercel: {
    deploy: deployToVercel,
    getStatus: getVercelDeploymentStatus,
    teardown: teardownVercel,
  },
  netlify: {
    deploy: deployToNetlify,
    getStatus: getNetlifyDeploymentStatus,
    teardown: teardownNetlify,
  },
  docker: {
    deploy: deployToDocker,
    getStatus: getDockerDeploymentStatus,
    teardown: teardownDocker,
  },
};

export function getDeploymentProvider(
  provider: string
): DeploymentProvider | null {
  const p = providers[provider];
  if (!p) {
    logger.warn({ provider }, "Unknown deployment provider requested");
    return null;
  }
  return p;
}

// ─── Teardown Implementations ─────────────────────────────────────────────

async function teardownVercel(
  providerDeploymentId: string
): Promise<{ success: boolean }> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return { success: false };
  }

  try {
    const res = await fetch(
      `https://api.vercel.com/v13/deployments/${providerDeploymentId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return { success: res.ok };
  } catch (err) {
    logger.error(
      { err, providerDeploymentId },
      "Failed to teardown Vercel deployment"
    );
    return { success: false };
  }
}

async function teardownNetlify(
  providerDeploymentId: string
): Promise<{ success: boolean }> {
  const token = process.env.NETLIFY_TOKEN;
  if (!token) {
    return { success: false };
  }

  try {
    const res = await fetch(
      `https://api.netlify.com/api/v1/sites/${providerDeploymentId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return { success: res.ok };
  } catch (err) {
    logger.error(
      { err, providerDeploymentId },
      "Failed to teardown Netlify deployment"
    );
    return { success: false };
  }
}

async function teardownDocker(
  providerDeploymentId: string
): Promise<{ success: boolean }> {
  const sandboxManagerUrl =
    process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

  try {
    const res = await fetch(
      `${sandboxManagerUrl}/containers/${providerDeploymentId}`,
      {
        method: "DELETE",
      }
    );
    return { success: res.ok };
  } catch (err) {
    logger.error(
      { err, providerDeploymentId },
      "Failed to teardown Docker deployment"
    );
    return { success: false };
  }
}
