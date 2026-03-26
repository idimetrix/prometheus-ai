import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { DeploymentConfig, DeploymentResult } from "./index";

const logger = createLogger("docker-provider");

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

const DOCKER_REGISTRY = process.env.DOCKER_REGISTRY ?? "";
const DOCKER_REGISTRY_USER = process.env.DOCKER_REGISTRY_USER ?? "";
const DOCKER_REGISTRY_PASSWORD = process.env.DOCKER_REGISTRY_PASSWORD ?? "";

/**
 * Deploy a project as a Docker container via the sandbox-manager service.
 * Optionally pushes the built image to a configured registry.
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
    const imageTag = buildImageTag(config);

    // Step 1: Create the container via sandbox-manager
    const res = await fetch(`${SANDBOX_MANAGER_URL}/containers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({
        id: containerId,
        projectId: config.projectId,
        orgId: config.orgId,
        type: "preview",
        env: config.envVars ?? {},
        imageTag,
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
      { containerId: data.id, port: data.port, imageTag },
      "Docker preview container created"
    );

    // Step 2: Push to registry if configured
    const registryResult = await pushToRegistry(data.id, imageTag);
    const registryInfo = registryResult.pushed
      ? `\nImage pushed to registry: ${registryResult.imageUrl}`
      : "";

    return {
      success: true,
      url: registryResult.pushed ? registryResult.imageUrl : previewUrl,
      providerDeploymentId: data.id,
      buildLogs: `Container ${data.id} running on port ${data.port}${registryInfo}`,
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

/**
 * Build a Docker image tag based on the deployment config.
 */
function buildImageTag(config: DeploymentConfig): string {
  const project = config.projectId.slice(0, 12);
  const branch = config.branch?.replace(/[^a-zA-Z0-9._-]/g, "-") ?? "main";
  const timestamp = Date.now();

  if (DOCKER_REGISTRY) {
    return `${DOCKER_REGISTRY}/prometheus-preview-${project}:${branch}-${timestamp}`;
  }

  return `prometheus-preview-${project}:${branch}-${timestamp}`;
}

/**
 * Push a built image to the configured Docker registry.
 * Returns early without error if no registry is configured.
 */
async function pushToRegistry(
  containerId: string,
  imageTag: string
): Promise<{ pushed: boolean; imageUrl: string }> {
  if (!DOCKER_REGISTRY) {
    return { pushed: false, imageUrl: "" };
  }

  try {
    logger.info(
      { containerId, imageTag, registry: DOCKER_REGISTRY },
      "Pushing Docker image to registry"
    );

    const res = await fetch(
      `${SANDBOX_MANAGER_URL}/containers/${containerId}/push`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          imageTag,
          registry: DOCKER_REGISTRY,
          username: DOCKER_REGISTRY_USER,
          password: DOCKER_REGISTRY_PASSWORD,
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      logger.warn(
        { status: res.status, errorText },
        "Docker registry push failed, container is still running locally"
      );
      return { pushed: false, imageUrl: "" };
    }

    const data = (await res.json()) as { imageUrl?: string };
    const imageUrl = data.imageUrl ?? imageTag;

    logger.info({ imageTag, imageUrl }, "Docker image pushed to registry");
    return { pushed: true, imageUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn(
      { err: message },
      "Docker registry push failed, container is still running locally"
    );
    return { pushed: false, imageUrl: "" };
  }
}

/**
 * Fetch the status of a Docker container deployment.
 */
export async function getDockerDeploymentStatus(containerId: string): Promise<{
  state: string;
  url?: string;
  ready: boolean;
  errorMessage?: string;
}> {
  try {
    const res = await fetch(
      `${SANDBOX_MANAGER_URL}/containers/${containerId}/status`,
      {
        headers: getInternalAuthHeaders(),
      }
    );

    if (!res.ok) {
      return {
        state: "unknown",
        ready: false,
        errorMessage: `Sandbox manager error (${res.status})`,
      };
    }

    const data = (await res.json()) as {
      status: string;
      port?: number;
      error?: string;
    };

    const isRunning = data.status === "running";
    return {
      state: data.status,
      url: data.port ? `http://localhost:${data.port}` : undefined,
      ready: isRunning,
      errorMessage: data.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      state: "unknown",
      ready: false,
      errorMessage: `Failed to check container status: ${message}`,
    };
  }
}
