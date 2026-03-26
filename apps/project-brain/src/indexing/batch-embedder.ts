/**
 * Batch Embedding Pipeline.
 *
 * Collects code chunks and batches them into groups of 50 for efficient
 * embedding generation. Supports both local (Ollama) and cloud
 * (OpenAI, Voyage) embedding providers. Tracks model version for
 * staleness detection.
 */

import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:batch-embedder");

/** Number of chunks to collect before sending a batch request. */
const DEFAULT_BATCH_SIZE = 50;

/** Supported embedding providers. */
export type EmbeddingProvider = "openai" | "voyage" | "ollama";

/**
 * Configuration for the batch embedder.
 */
export interface BatchEmbedderConfig {
  /** API key for cloud providers */
  apiKey?: string;
  /** Base URL for the embedding API */
  baseUrl?: string;
  /** Number of chunks per batch (default: 50) */
  batchSize?: number;
  /** Embedding model name */
  model: string;
  /** Embedding provider */
  provider: EmbeddingProvider;
}

/**
 * A code chunk to be embedded.
 */
export interface EmbeddingChunk {
  /** Chunk index within the file */
  chunkIndex: number;
  /** The text content to embed */
  content: string;
  /** File path */
  filePath: string;
}

/**
 * Result of embedding a single chunk.
 */
export interface EmbeddingResult {
  /** Chunk index */
  chunkIndex: number;
  /** The generated embedding vector */
  embedding: number[];
  /** File path */
  filePath: string;
  /** Model that generated this embedding */
  modelVersion: string;
}

/** Default provider URLs. */
const PROVIDER_URLS: Record<EmbeddingProvider, string> = {
  openai: "https://api.openai.com/v1",
  voyage: "https://api.voyageai.com/v1",
  ollama: "http://localhost:11434",
};

/**
 * Batched embedding pipeline that collects chunks and sends them
 * in efficient batches to the configured embedding provider.
 *
 * @example
 * ```ts
 * const embedder = new BatchEmbedder({
 *   provider: "openai",
 *   model: "text-embedding-3-small",
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 *
 * const results = await embedder.embed(chunks);
 * await embedder.flush(); // Process any remaining chunks
 * ```
 */
export class BatchEmbedder {
  private readonly config: Required<
    Pick<BatchEmbedderConfig, "model" | "provider" | "batchSize">
  > &
    BatchEmbedderConfig;
  private readonly buffer: EmbeddingChunk[] = [];
  private readonly baseUrl: string;

  constructor(config: BatchEmbedderConfig) {
    this.config = {
      ...config,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
    };
    this.baseUrl =
      config.baseUrl ?? PROVIDER_URLS[config.provider] ?? PROVIDER_URLS.openai;
  }

  /**
   * Embed a batch of chunks.
   *
   * Chunks are collected into an internal buffer. When the buffer
   * reaches the batch size, a batch request is sent. Remaining chunks
   * can be processed with `flush()`.
   *
   * @param chunks - Code chunks to embed
   * @returns Embedding results for processed chunks
   */
  async embed(chunks: EmbeddingChunk[]): Promise<EmbeddingResult[]> {
    this.buffer.push(...chunks);

    const results: EmbeddingResult[] = [];

    // Process full batches
    while (this.buffer.length >= this.config.batchSize) {
      const batch = this.buffer.splice(0, this.config.batchSize);
      const batchResults = await this.processBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Flush any remaining chunks in the buffer.
   *
   * Call this after all chunks have been added to ensure the final
   * partial batch is processed.
   *
   * @returns Embedding results for remaining chunks
   */
  async flush(): Promise<EmbeddingResult[]> {
    if (this.buffer.length === 0) {
      return [];
    }

    const batch = this.buffer.splice(0, this.buffer.length);
    const results = await this.processBatch(batch);
    return results;
  }

  /**
   * Get the current buffer size (pending chunks).
   */
  get pendingCount(): number {
    return this.buffer.length;
  }

  /**
   * Get the model version string for staleness detection.
   */
  get modelVersion(): string {
    return `${this.config.provider}:${this.config.model}`;
  }

  /**
   * Process a single batch of chunks by calling the embedding API.
   */
  private async processBatch(
    batch: EmbeddingChunk[]
  ): Promise<EmbeddingResult[]> {
    const start = performance.now();
    const texts = batch.map((chunk) => chunk.content);

    try {
      const embeddings = await this.callEmbeddingApi(texts);
      const elapsed = Math.round(performance.now() - start);

      logger.debug(
        {
          provider: this.config.provider,
          model: this.config.model,
          batchSize: batch.length,
          durationMs: elapsed,
        },
        `Embedding batch of ${batch.length} chunks in ${elapsed}ms`
      );

      return batch.map((chunk, index) => ({
        filePath: chunk.filePath,
        chunkIndex: chunk.chunkIndex,
        embedding: embeddings[index] ?? [],
        modelVersion: this.modelVersion,
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          provider: this.config.provider,
          model: this.config.model,
          batchSize: batch.length,
          error: msg,
        },
        "Embedding batch failed"
      );

      // Return empty embeddings on failure
      return batch.map((chunk) => ({
        filePath: chunk.filePath,
        chunkIndex: chunk.chunkIndex,
        embedding: [],
        modelVersion: this.modelVersion,
      }));
    }
  }

  /**
   * Call the embedding API based on the configured provider.
   */
  private async callEmbeddingApi(texts: string[]): Promise<number[][]> {
    switch (this.config.provider) {
      case "openai":
      case "voyage": {
        const result = await this.callOpenAICompatibleApi(texts);
        return result;
      }
      case "ollama": {
        const result = await this.callOllamaApi(texts);
        return result;
      }
      default:
        throw new Error(`Unknown embedding provider: ${this.config.provider}`);
    }
  }

  /**
   * Call OpenAI-compatible embedding API (works for OpenAI and Voyage).
   */
  private async callOpenAICompatibleApi(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.apiKey
          ? { Authorization: `Bearer ${this.config.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Embedding API returned ${response.status}: ${body.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }

  /**
   * Call Ollama embedding API.
   */
  private async callOllamaApi(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    // Ollama processes one at a time
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt: text,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Ollama embedding failed (${response.status}): ${body.slice(0, 200)}`
        );
      }

      const data = (await response.json()) as { embedding: number[] };
      results.push(data.embedding);
    }

    return results;
  }
}
