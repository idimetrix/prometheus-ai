/**
 * Phase 7.16: Multi-modal Memory.
 *
 * Stores screenshots/diagrams in MinIO and associates
 * them with text-based memory descriptions for retrieval.
 */
import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, ilike } from "drizzle-orm";

const logger = createLogger("project-brain:multimodal-memory");

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_BUCKET = process.env.MINIO_BUCKET ?? "prometheus-memories";
const _MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
const _MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "minioadmin";

export interface StoredImage {
  description: string;
  id: string;
  objectKey: string;
  projectId: string;
  storedAt: Date;
  url: string;
}

/**
 * MultimodalMemory stores and retrieves images (screenshots, diagrams)
 * in MinIO with associated text descriptions stored as memories.
 */
export class MultimodalMemory {
  /**
   * Store an image in MinIO and create a text-based memory entry.
   */
  async storeImage(
    projectId: string,
    image: Buffer,
    description: string,
    metadata?: { contentType?: string; filename?: string }
  ): Promise<StoredImage> {
    const id = generateId("img");
    const contentType = metadata?.contentType ?? "image/png";
    const extension = contentType.split("/").pop() ?? "png";
    const objectKey = `${projectId}/${id}.${extension}`;

    // Upload to MinIO
    try {
      await fetch(`${MINIO_ENDPOINT}/${MINIO_BUCKET}/${objectKey}`, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(image.length),
        },
        body: image,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      logger.error(
        { projectId, objectKey, err },
        "Failed to upload image to MinIO"
      );
      throw new Error("Image upload failed");
    }

    // Store text description as a memory with reference to the image
    const memoryContent = JSON.stringify({
      type: "multimodal",
      objectKey,
      description,
      contentType,
      filename: metadata?.filename,
    });

    await db.insert(agentMemories).values({
      id,
      projectId,
      memoryType: "semantic",
      content: memoryContent,
      createdAt: new Date(),
    });

    const url = `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${objectKey}`;

    logger.info({ projectId, id, objectKey }, "Multimodal memory stored");

    return {
      id,
      projectId,
      objectKey,
      url,
      description,
      storedAt: new Date(),
    };
  }

  /**
   * Retrieve images related to a query by searching text descriptions.
   */
  async retrieveImages(
    projectId: string,
    query: string,
    limit = 5
  ): Promise<StoredImage[]> {
    const rows = await db
      .select({
        id: agentMemories.id,
        content: agentMemories.content,
        projectId: agentMemories.projectId,
        createdAt: agentMemories.createdAt,
      })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "semantic"),
          ilike(agentMemories.content, "%multimodal%"),
          ilike(agentMemories.content, `%${query}%`)
        )
      )
      .limit(limit);

    const images: StoredImage[] = [];

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.content) as {
          type: string;
          objectKey: string;
          description: string;
        };

        if (parsed.type === "multimodal") {
          images.push({
            id: row.id,
            projectId: row.projectId,
            objectKey: parsed.objectKey,
            url: `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${parsed.objectKey}`,
            description: parsed.description,
            storedAt: row.createdAt,
          });
        }
      } catch {
        // Skip non-multimodal entries
      }
    }

    return images;
  }
}
