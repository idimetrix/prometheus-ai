import { createLogger } from "@prometheus/logger";
import type { IndexProjectData } from "@prometheus/queue";
import { EventPublisher } from "@prometheus/queue";

const logger = createLogger("queue-worker:index-project");
const publisher = new EventPublisher();

const BRAIN_URL = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

export async function processIndexProject(
  data: IndexProjectData,
  onProgress?: (progress: Record<string, unknown>) => void
): Promise<{ indexed: number; skipped: number; errors: number }> {
  const { projectId, orgId, filePaths, fullReindex, triggeredBy } = data;
  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  logger.info(
    { projectId, fullReindex, triggeredBy, fileCount: filePaths.length },
    "Starting project indexing"
  );

  if (fullReindex) {
    // Full directory reindex
    try {
      const response = await fetch(`${BRAIN_URL}/index/directory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, dirPath: filePaths[0] ?? "." }),
        signal: AbortSignal.timeout(600_000), // 10 min timeout for full reindex
      });

      if (response.ok) {
        const result = (await response.json()) as {
          indexed: number;
          skipped: number;
          errors: number;
        };
        indexed = result.indexed;
        skipped = result.skipped;
        errors = result.errors;
      } else {
        logger.error(
          { projectId, status: response.status },
          "Full reindex failed"
        );
        errors = filePaths.length;
      }
    } catch (err) {
      logger.error({ projectId, err }, "Full reindex request failed");
      errors = filePaths.length;
    }
  } else {
    // Incremental indexing of specific files
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i] as string;

      try {
        const response = await fetch(`${BRAIN_URL}/index/file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, filePath }),
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          const result = (await response.json()) as {
            success: boolean;
            indexed: boolean;
          };
          if (result.indexed) {
            indexed++;
          } else {
            skipped++;
          }
        } else {
          errors++;
        }
      } catch (err) {
        logger.warn({ projectId, filePath, err }, "Failed to index file");
        errors++;
      }

      // Report progress
      if (onProgress && (i % 5 === 0 || i === filePaths.length - 1)) {
        onProgress({
          projectId,
          total: filePaths.length,
          processed: i + 1,
          indexed,
          skipped,
          errors,
          percent: Math.round(((i + 1) / filePaths.length) * 100),
        });
      }
    }
  }

  // Publish indexing progress to Redis for real-time UI updates
  try {
    await publisher.publishFleetEvent(orgId, {
      type: "indexing_complete",
      data: { projectId, indexed, skipped, errors, triggeredBy },
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Non-critical
  }

  logger.info(
    { projectId, indexed, skipped, errors },
    "Project indexing complete"
  );
  return { indexed, skipped, errors };
}
