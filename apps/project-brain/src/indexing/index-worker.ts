/**
 * BullMQ consumer for the indexing queue.
 * Processes IndexProjectData jobs by invoking the FileIndexer
 * to index changed files for a project.
 */
import { createLogger } from "@prometheus/logger";
import type { IndexProjectData } from "@prometheus/queue";
import { createRedisConnection } from "@prometheus/queue";
import { Worker } from "bullmq";
import { KnowledgeGraphLayer } from "../layers/knowledge-graph";
import { SemanticLayer } from "../layers/semantic";
import { FileIndexer } from "./file-indexer";

const logger = createLogger("project-brain:index-worker");

let worker: Worker<IndexProjectData> | null = null;

export function startIndexWorker(): Worker<IndexProjectData> {
  const semantic = new SemanticLayer();
  const knowledgeGraph = new KnowledgeGraphLayer();
  const fileIndexer = new FileIndexer(semantic, knowledgeGraph);

  worker = new Worker<IndexProjectData>(
    "index-project",
    async (job) => {
      const { projectId, filePaths, fullReindex, triggeredBy } = job.data;

      logger.info(
        {
          jobId: job.id,
          projectId,
          fileCount: filePaths.length,
          fullReindex,
          triggeredBy,
        },
        "Processing index-project job"
      );

      if (fullReindex) {
        // Full reindex: read files and pass to the indexer
        const fs = await import("node:fs/promises");
        const files: Array<{
          path: string;
          content: string;
          hash: string;
        }> = [];

        for (const filePath of filePaths) {
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const crypto = await import("node:crypto");
            const hash = crypto
              .createHash("sha256")
              .update(content)
              .digest("hex");
            files.push({ path: filePath, content, hash });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(
              { projectId, filePath, error: msg },
              "Failed to read file for full reindex"
            );
          }
        }

        await fileIndexer.fullReindex(projectId, files);
      } else {
        // Incremental index: read changed files and index them
        const fs = await import("node:fs/promises");
        const crypto = await import("node:crypto");

        for (const filePath of filePaths) {
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const hash = crypto
              .createHash("sha256")
              .update(content)
              .digest("hex");
            await fileIndexer.indexChanges(projectId, [
              { path: filePath, content, hash, action: "modified" },
            ]);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(
              { projectId, filePath, error: msg },
              "Failed to index file"
            );
          }
        }
      }

      const progress = Math.round(
        ((job.attemptsMade + 1) / (job.opts.attempts ?? 1)) * 100
      );
      await job.updateProgress(progress);

      logger.info(
        { jobId: job.id, projectId, fileCount: filePaths.length },
        "Index-project job completed"
      );
    },
    {
      connection: createRedisConnection(),
      concurrency: Number(process.env.INDEXING_CONCURRENCY ?? 1),
    }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Index worker job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, error: error.message },
      "Index worker job failed"
    );
  });

  worker.on("error", (error) => {
    logger.error({ error: error.message }, "Index worker error");
  });

  logger.info("Index worker started");
  return worker;
}
