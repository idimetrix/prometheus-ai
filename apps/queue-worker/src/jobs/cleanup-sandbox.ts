import { createLogger } from "@prometheus/logger";
import type { CleanupSandboxData } from "@prometheus/queue";
import { EventPublisher } from "@prometheus/queue";

const logger = createLogger("queue-worker:cleanup-sandbox");
const publisher = new EventPublisher();

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

export async function processCleanupSandbox(
  data: CleanupSandboxData
): Promise<{ cleaned: boolean; artifactsPreserved: boolean }> {
  const {
    sandboxId,
    sessionId,
    projectId: _projectId,
    orgId: _orgId,
    reason,
    preserveArtifacts,
  } = data;

  logger.info(
    { sandboxId, sessionId, reason, preserveArtifacts },
    "Cleaning up sandbox"
  );

  try {
    // Call sandbox manager to destroy the container
    const response = await fetch(
      `${SANDBOX_MANAGER_URL}/sandbox/${sandboxId}/cleanup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          preserveArtifacts,
        }),
        signal: AbortSignal.timeout(60_000),
      }
    );

    if (response.ok) {
      const result = (await response.json()) as {
        cleaned: boolean;
        artifactsPreserved: boolean;
      };

      // Publish cleanup completion event
      await publisher.publishSessionEvent(sessionId, {
        type: "task_status",
        data: {
          sandboxId,
          status: "sandbox_cleaned",
          reason,
          artifactsPreserved: result.artifactsPreserved,
        },
        timestamp: new Date().toISOString(),
      });

      logger.info({ sandboxId, reason }, "Sandbox cleaned up successfully");
      return result;
    }

    // If sandbox manager is unavailable, log and continue
    // The container will eventually be cleaned up by TTL/garbage collection
    logger.warn(
      { sandboxId, status: response.status },
      "Sandbox manager returned non-OK, will retry or expire"
    );
    return { cleaned: false, artifactsPreserved: false };
  } catch (err) {
    logger.warn(
      { sandboxId, err },
      "Sandbox cleanup request failed, container may need manual cleanup"
    );

    // For timeout/manual reasons, this is expected if sandbox already gone
    if (reason === "timeout" || reason === "completed") {
      return { cleaned: true, artifactsPreserved: false };
    }

    throw err; // Retry for unexpected failures
  }
}
