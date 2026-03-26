import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import type { GenerateEmbeddingsData } from "@prometheus/queue";

const logger = createLogger("queue-worker:generate-embeddings");

const BRAIN_URL = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

export async function processGenerateEmbeddings(
  data: GenerateEmbeddingsData
): Promise<{ processed: number; errors: number }> {
  const { projectId, filePath, chunks, model } = data;
  let processed = 0;
  let errors = 0;

  logger.info(
    { projectId, filePath, chunkCount: chunks.length, model },
    "Generating embeddings"
  );

  // Reconstruct content from chunks and send to project-brain for indexing
  // The project-brain semantic layer handles embedding generation internally
  const fullContent = chunks
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((c) => c.content)
    .join("\n\n");

  try {
    const response = await fetch(`${BRAIN_URL}/index/file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({
        projectId,
        filePath,
        content: fullContent,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (response.ok) {
      processed = chunks.length;
    } else {
      logger.error(
        { projectId, filePath, status: response.status },
        "Embedding generation failed"
      );
      errors = chunks.length;
    }
  } catch (err) {
    logger.error(
      { projectId, filePath, err },
      "Embedding generation request failed"
    );
    errors = chunks.length;
  }

  logger.info(
    { projectId, filePath, processed, errors },
    "Embedding generation complete"
  );
  return { processed, errors };
}
