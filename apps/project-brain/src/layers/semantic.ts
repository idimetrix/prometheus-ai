import crypto from "node:crypto";
import { codeEmbeddings, db, fileIndexes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, ilike, sql } from "drizzle-orm";
import { chunkBySemantic } from "../indexing/semantic-chunker";

const logger = createLogger("project-brain:semantic");

export interface SearchResult {
  chunkIndex: number;
  content: string;
  filePath: string;
  score: number;
}

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

/** Whether the embedding service has been verified as available */
let _embeddingServiceVerified = false;

/**
 * Verify that the embedding service is available via model-router.
 * The model-router handles fallback (Voyage Code 3 → Ollama nomic-embed-text).
 * Should be called at startup. Logs a warning if unavailable but does not throw,
 * allowing the service to start in degraded mode.
 */
export async function verifyEmbeddingService(): Promise<boolean> {
  try {
    const response = await fetch(`${MODEL_ROUTER_URL}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "health check" }),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        embedding: number[];
        dimensions: number;
        model: string;
      };
      if (data.embedding?.length > 0) {
        _embeddingServiceVerified = true;
        logger.info(
          { model: data.model, dimensions: data.dimensions },
          "Embedding service verified via model-router"
        );
        return true;
      }
    }

    logger.warn(
      { status: response.status },
      "Embedding service returned unexpected response — semantic search will be unavailable"
    );
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { error: msg, url: MODEL_ROUTER_URL },
      "Embedding service unavailable via model-router — semantic search will be degraded"
    );
    return false;
  }
}

/**
 * Generate an embedding vector for the given text using model-router's
 * routeEmbedding() endpoint. Supports automatic fallback chain:
 * Voyage Code 3 → Ollama nomic-embed-text.
 *
 * Throws an error if all embedding providers are unavailable — callers
 * must handle this gracefully.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const MAX_RETRIES = 2;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${MODEL_ROUTER_URL}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text }),
        signal: AbortSignal.timeout(30_000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          embedding: number[];
          model: string;
          dimensions: number;
        };
        if (data.embedding?.length > 0) {
          _embeddingServiceVerified = true;
          return data.embedding;
        }
        lastError = "Model-router returned empty embedding vector";
      } else {
        lastError = `Model-router returned HTTP ${response.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    // Exponential backoff before retry
    if (attempt < MAX_RETRIES) {
      const delayMs = 1000 * 2 ** attempt;
      logger.debug(
        { attempt: attempt + 1, delayMs },
        "Retrying embedding generation via model-router"
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  _embeddingServiceVerified = false;
  throw new Error(
    `Embedding generation failed after ${MAX_RETRIES + 1} attempts: ${lastError}. ` +
      `Ensure model-router is running at ${MODEL_ROUTER_URL} with embedding providers configured.`
  );
}

export class SemanticLayer {
  async indexFile(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const chunks = this.chunkContent(content, filePath);
    const fileHash = crypto.createHash("sha256").update(content).digest("hex");

    // Check if already indexed with same hash
    const existing = await db
      .select()
      .from(fileIndexes)
      .where(
        and(
          eq(fileIndexes.projectId, projectId),
          eq(fileIndexes.filePath, filePath)
        )
      )
      .limit(1);

    if (existing.length > 0 && existing[0]?.fileHash === fileHash) {
      logger.debug({ projectId, filePath }, "File unchanged, skipping index");
      return;
    }

    // Remove old embeddings for this file
    await db
      .delete(codeEmbeddings)
      .where(
        and(
          eq(codeEmbeddings.projectId, projectId),
          eq(codeEmbeddings.filePath, filePath)
        )
      );

    // Insert new chunks with embeddings
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] as string;
      let embedding: number[];
      try {
        embedding = await generateEmbedding(chunk);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { projectId, filePath, chunkIndex: i, error: msg },
          "Failed to generate embedding — skipping chunk. Fix embedding service to enable semantic search."
        );
        continue;
      }

      await db.insert(codeEmbeddings).values({
        id: generateId("emb"),
        projectId,
        filePath,
        chunkIndex: i,
        content: chunk,
        embedding,
        updatedAt: new Date(),
      });
    }

    // Upsert file_indexes record
    if (existing.length > 0) {
      await db
        .update(fileIndexes)
        .set({
          fileHash,
          language: this.detectLanguage(filePath),
          loc: content.split("\n").length,
          lastIndexed: new Date(),
        })
        .where(eq(fileIndexes.id, (existing[0] as (typeof existing)[0]).id));
    } else {
      await db.insert(fileIndexes).values({
        id: generateId("fidx"),
        projectId,
        filePath,
        fileHash,
        language: this.detectLanguage(filePath),
        loc: content.split("\n").length,
        lastIndexed: new Date(),
      });
    }

    logger.info({ projectId, filePath, chunks: chunks.length }, "File indexed");
  }

  async search(
    projectId: string,
    query: string,
    limit = 10
  ): Promise<SearchResult[]> {
    // Try pgvector cosine similarity search first
    const queryEmbedding = await generateEmbedding(query);

    try {
      const vectorResults = await db
        .select({
          filePath: codeEmbeddings.filePath,
          content: codeEmbeddings.content,
          chunkIndex: codeEmbeddings.chunkIndex,
          distance: sql<number>`1 - (${codeEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
        })
        .from(codeEmbeddings)
        .where(eq(codeEmbeddings.projectId, projectId))
        .orderBy(
          sql`${codeEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`
        )
        .limit(limit);

      if (vectorResults.length > 0) {
        return vectorResults.map((r) => ({
          filePath: r.filePath,
          content: r.content,
          score: Math.max(0, Math.min(1, r.distance)),
          chunkIndex: r.chunkIndex,
        }));
      }
    } catch (err) {
      logger.warn({ err }, "Vector search failed, falling back to text search");
    }

    // Fallback: ILIKE text search
    const textResults = await db
      .select({
        filePath: codeEmbeddings.filePath,
        content: codeEmbeddings.content,
        chunkIndex: codeEmbeddings.chunkIndex,
      })
      .from(codeEmbeddings)
      .where(
        and(
          eq(codeEmbeddings.projectId, projectId),
          ilike(codeEmbeddings.content, `%${query}%`)
        )
      )
      .limit(limit);

    return textResults.map((r, idx) => ({
      filePath: r.filePath,
      content: r.content,
      score: 1 - idx * 0.05, // Decreasing score by position
      chunkIndex: r.chunkIndex,
    }));
  }

  async getRelatedFiles(
    projectId: string,
    filePath: string,
    limit = 10
  ): Promise<SearchResult[]> {
    // Get the chunks for this file, use average embedding to find similar files
    const fileChunks = await db
      .select()
      .from(codeEmbeddings)
      .where(
        and(
          eq(codeEmbeddings.projectId, projectId),
          eq(codeEmbeddings.filePath, filePath)
        )
      );

    if (fileChunks.length === 0) {
      return [];
    }

    // Use the first chunk's content as a representative query
    const representativeContent = fileChunks[0]?.content ?? "";
    const embedding = await generateEmbedding(representativeContent);

    try {
      const results = await db
        .select({
          filePath: codeEmbeddings.filePath,
          content: codeEmbeddings.content,
          chunkIndex: codeEmbeddings.chunkIndex,
          distance: sql<number>`1 - (${codeEmbeddings.embedding} <=> ${JSON.stringify(embedding)}::vector)`,
        })
        .from(codeEmbeddings)
        .where(
          and(
            eq(codeEmbeddings.projectId, projectId),
            sql`${codeEmbeddings.filePath} != ${filePath}`
          )
        )
        .orderBy(
          sql`${codeEmbeddings.embedding} <=> ${JSON.stringify(embedding)}::vector`
        )
        .limit(limit);

      // De-duplicate by filePath, keeping highest score
      const seen = new Map<string, SearchResult>();
      for (const r of results) {
        const score = Math.max(0, Math.min(1, r.distance));
        const existing = seen.get(r.filePath);
        if (!existing || existing.score < score) {
          seen.set(r.filePath, {
            filePath: r.filePath,
            content: r.content,
            score,
            chunkIndex: r.chunkIndex,
          });
        }
      }
      return Array.from(seen.values());
    } catch {
      return [];
    }
  }

  async getFileContent(
    projectId: string,
    filePath: string
  ): Promise<SearchResult[]> {
    const chunks = await db
      .select()
      .from(codeEmbeddings)
      .where(
        and(
          eq(codeEmbeddings.projectId, projectId),
          eq(codeEmbeddings.filePath, filePath)
        )
      )
      .orderBy(codeEmbeddings.chunkIndex);

    return chunks.map((c) => ({
      filePath: c.filePath,
      content: c.content,
      score: 1,
      chunkIndex: c.chunkIndex,
    }));
  }

  async removeFile(projectId: string, filePath: string): Promise<void> {
    await db
      .delete(codeEmbeddings)
      .where(
        and(
          eq(codeEmbeddings.projectId, projectId),
          eq(codeEmbeddings.filePath, filePath)
        )
      );

    await db
      .delete(fileIndexes)
      .where(
        and(
          eq(fileIndexes.projectId, projectId),
          eq(fileIndexes.filePath, filePath)
        )
      );

    logger.info({ projectId, filePath }, "File removed from index");
  }

  /**
   * Chunk file content using the semantic chunker (SymbolTable-based for
   * TS/JS/Python/Go/Rust/Java) with fallback to line-based chunking.
   * Returns plain string chunks for embedding, with symbol metadata available
   * via chunkContentStructured().
   */
  chunkContent(content: string, filePath: string): string[] {
    const structured = chunkBySemantic(filePath, content);
    // Prepend import context to each chunk for embedding quality
    return structured.map((chunk) => {
      if (chunk.importContext) {
        return `${chunk.importContext}\n\n${chunk.content}`;
      }
      return chunk.content;
    });
  }

  /**
   * Chunk with full structured metadata (symbol type, name, line numbers).
   * Used by the indexing pipeline for storing rich metadata in code_embeddings.
   */
  chunkContentStructured(content: string, filePath: string) {
    return chunkBySemantic(filePath, content);
  }

  /** Get count of indexed files for a project (for progress tracking) */
  async getIndexedFileCount(projectId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(fileIndexes)
      .where(eq(fileIndexes.projectId, projectId));
    return result[0]?.count ?? 0;
  }

  detectLanguage(filePath: string): string | null {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      go: "go",
      rs: "rust",
      rb: "ruby",
      java: "java",
      c: "c",
      cpp: "cpp",
      h: "c",
      md: "markdown",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      toml: "toml",
      sql: "sql",
      css: "css",
      html: "html",
      graphql: "graphql",
      gql: "graphql",
      prisma: "prisma",
      proto: "protobuf",
      sh: "shell",
      bash: "shell",
      dockerfile: "dockerfile",
    };
    return ext ? (langMap[ext] ?? null) : null;
  }
}
