import { createLogger } from "@prometheus/logger";
import { deployToDocker } from "./docker-provider";
import { deployToNetlify } from "./netlify-provider";
import { deployToVercel } from "./vercel-provider";

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

export interface DeploymentProvider {
  deploy(config: DeploymentConfig): Promise<DeploymentResult>;
  teardown(providerDeploymentId: string): Promise<{ success: boolean }>;
}

// ─── Provider Factory ──────────────────────────────────────────────────────

const providers: Record<string, DeploymentProvider> = {
  vercel: { deploy: deployToVercel, teardown: teardownVercel },
  netlify: { deploy: deployToNetlify, teardown: teardownNetlify },
  docker: { deploy: deployToDocker, teardown: teardownDocker },
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

// ─── Teardown Stubs ────────────────────────────────────────────────────────

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
      `https://api.netlify.com/api/v1/deploys/${providerDeploymentId}`,
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
