/**
 * BullMQ consumer for the embeddings queue.
 * Processes GenerateEmbeddingsData jobs by batching chunks,
 * generating embeddings via EmbeddingService, and storing
 * results in the code_embeddings table.
 */
import { codeEmbeddings, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import type { GenerateEmbeddingsData } from "@prometheus/queue";
import { createRedisConnection } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { EmbeddingService } from "../embeddings/embedding-service";

const logger = createLogger("project-brain:embedding-worker");

const BATCH_SIZE = 32;

let worker: Worker<GenerateEmbeddingsData> | null = null;

export function startEmbeddingWorker(): Worker<GenerateEmbeddingsData> {
  const embeddingService = new EmbeddingService();

  worker = new Worker<GenerateEmbeddingsData>(
    "generate-embeddings",
    async (job) => {
      const { projectId, filePath, chunks } = job.data;

      logger.info(
        {
          jobId: job.id,
          projectId,
          filePath,
          chunkCount: chunks.length,
        },
        "Processing generate-embeddings job"
      );

      // Process chunks in batches of 32
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const texts = batch.map((chunk) => chunk.content);

        const results = await embeddingService.embedBatch(texts);

        // Store each embedding result in code_embeddings
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const result = results[j];

          if (!(chunk && result)) {
            continue;
          }

          // Upsert: delete existing embedding for this file+chunk, then insert
          await db
            .delete(codeEmbeddings)
            .where(
              and(
                eq(codeEmbeddings.projectId, projectId),
                eq(codeEmbeddings.filePath, filePath),
                eq(codeEmbeddings.chunkIndex, chunk.chunkIndex)
              )
            );

          await db.insert(codeEmbeddings).values({
            id: generateId(),
            projectId,
            filePath,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            embedding: result.embedding768,
            embedding256: result.embedding256,
            updatedAt: new Date(),
          });
        }

        // Update progress
        const processed = Math.min(i + BATCH_SIZE, chunks.length);
        const progress = Math.round((processed / chunks.length) * 100);
        await job.updateProgress(progress);

        logger.debug(
          {
            jobId: job.id,
            projectId,
            filePath,
            batchStart: i,
            batchEnd: processed,
            progress,
          },
          "Embedding batch processed"
        );
      }

      logger.info(
        {
          jobId: job.id,
          projectId,
          filePath,
          chunkCount: chunks.length,
        },
        "Generate-embeddings job completed"
      );
    },
    {
      connection: createRedisConnection(),
      concurrency: Number(process.env.EMBEDDINGS_CONCURRENCY ?? 2),
    }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Embedding worker job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, error: error.message },
      "Embedding worker job failed"
    );
  });

  worker.on("error", (error) => {
    logger.error({ error: error.message }, "Embedding worker error");
  });

  logger.info("Embedding worker started");
  return worker;
}
