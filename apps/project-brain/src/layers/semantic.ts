import crypto from "node:crypto";
import { codeEmbeddings, db, fileIndexes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, ilike, sql } from "drizzle-orm";

const logger = createLogger("project-brain:semantic");

const MAX_CHUNK_CHARS = 2000; // ~500 tokens
const CHUNK_OVERLAP_CHARS = 200; // ~50 tokens overlap between chunks

const TOP_LEVEL_DECL_RE =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+/;
const DOUBLE_NEWLINE_RE = /\n\n+/;

export interface SearchResult {
  chunkIndex: number;
  content: string;
  filePath: string;
  score: number;
}

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
const EMBEDDING_DIMENSIONS = 768;

/**
 * Generate an embedding vector for the given text.
 * Tries Ollama nomic-embed-text first, falls back to deterministic hash.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    });

    if (response.ok) {
      const data = (await response.json()) as { embedding: number[] };
      if (data.embedding?.length > 0) {
        return data.embedding;
      }
    }
  } catch {
    // Ollama not available, fall back to hash embedding
  }

  return hashEmbedding(text);
}

/** Deterministic fallback embedding using SHA-256 hashing */
function hashEmbedding(
  text: string,
  dimensions: number = EMBEDDING_DIMENSIONS
): number[] {
  const embedding: number[] = new Array(dimensions);
  let seed = text;
  let offset = 0;
  while (offset < dimensions) {
    const hash = crypto.createHash("sha256").update(seed).digest();
    for (let i = 0; i < hash.length && offset < dimensions; i += 4) {
      const val = hash.readInt32BE(i) / 2_147_483_647;
      embedding[offset] = val;
      offset++;
    }
    seed = hash.toString("hex");
  }
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      embedding[i] = (embedding[i] as number) / norm;
    }
  }
  return embedding;
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
      const embedding = await generateEmbedding(chunk);

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

  chunkContent(content: string, filePath: string): string[] {
    const ext = filePath.split(".").pop() ?? "";
    const isCode = [
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "go",
      "rs",
      "rb",
      "java",
      "c",
      "cpp",
      "h",
    ].includes(ext);

    if (isCode) {
      return this.chunkByDeclarations(content);
    }
    return this.chunkByParagraph(content);
  }

  /**
   * Split code by top-level declarations (functions, classes, exports).
   * Each chunk is at most MAX_CHUNK_CHARS characters.
   */
  private chunkByDeclarations(content: string): string[] {
    const lines = content.split("\n");
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let braceDepth = 0;
    let inTopLevelDecl = false;

    for (const line of lines) {
      const trimmed = line.trimStart();

      // Check if this line starts a new top-level declaration at depth 0
      if (
        braceDepth === 0 &&
        TOP_LEVEL_DECL_RE.test(trimmed) &&
        currentChunk.length > 0
      ) {
        // Flush current chunk if it has substance
        const chunkText = currentChunk.join("\n").trim();
        if (chunkText.length > 0) {
          chunks.push(...this.splitLargeChunk(chunkText));
        }
        currentChunk = [];
        inTopLevelDecl = true;
      }

      currentChunk.push(line);

      // Track brace depth
      for (const ch of line) {
        if (ch === "{") {
          braceDepth++;
        }
        if (ch === "}") {
          braceDepth = Math.max(0, braceDepth - 1);
        }
      }

      // If we were in a top-level declaration and braces are balanced, consider the chunk complete
      if (inTopLevelDecl && braceDepth === 0 && currentChunk.length > 2) {
        const chunkText = currentChunk.join("\n").trim();
        if (chunkText.length > 0) {
          chunks.push(...this.splitLargeChunk(chunkText));
        }
        currentChunk = [];
        inTopLevelDecl = false;
      }
    }

    // Flush remaining
    if (currentChunk.length > 0) {
      const chunkText = currentChunk.join("\n").trim();
      if (chunkText.length > 0) {
        chunks.push(...this.splitLargeChunk(chunkText));
      }
    }

    return chunks.length > 0 ? chunks : [content];
  }

  /** Split a chunk that exceeds MAX_CHUNK_CHARS into smaller pieces by line boundaries with overlap */
  private splitLargeChunk(text: string): string[] {
    if (text.length <= MAX_CHUNK_CHARS) {
      return [text];
    }

    const lines = text.split("\n");
    const results: string[] = [];
    let current: string[] = [];
    let currentLen = 0;

    for (const line of lines) {
      if (
        currentLen + line.length + 1 > MAX_CHUNK_CHARS &&
        current.length > 0
      ) {
        results.push(current.join("\n"));
        // Keep trailing lines as overlap for the next chunk
        const overlapLines: string[] = [];
        let overlapLen = 0;
        for (let i = current.length - 1; i >= 0; i--) {
          overlapLen += (current[i]?.length ?? 0) + 1;
          if (overlapLen > CHUNK_OVERLAP_CHARS) {
            break;
          }
          overlapLines.unshift(current[i] as string);
        }
        current = overlapLines;
        currentLen = overlapLines.reduce((sum, l) => sum + l.length + 1, 0);
      }
      current.push(line);
      currentLen += line.length + 1;
    }

    if (current.length > 0) {
      results.push(current.join("\n"));
    }

    return results;
  }

  private chunkByParagraph(content: string): string[] {
    const paragraphs = content.split(DOUBLE_NEWLINE_RE);
    const chunks: string[] = [];
    let current = "";

    for (const para of paragraphs) {
      if (
        current.length + para.length > MAX_CHUNK_CHARS &&
        current.length > 0
      ) {
        chunks.push(current.trim());
        current = "";
      }
      current += `${para}\n\n`;
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [content];
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
