/**
 * Phase 5.5: Centralized Embedding Service.
 * Primary: Nomic Embed v2 via Ollama (local, free)
 * Fallback: Voyage 3.5 API with circuit breaker (3 failures → 60s switchover)
 * Matryoshka truncation: 768-dim → 256-dim with L2 re-normalization
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:embedding-service");

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? "";
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
const BATCH_SIZE = 32;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 60_000;

export interface EmbeddingResult {
  embedding256: number[];
  embedding768: number[];
}

export class EmbeddingService {
  private primaryFailures = 0;
  private circuitOpenUntil = 0;

  /**
   * Generate embeddings for a batch of texts.
   * Returns both 768-dim and 256-dim (Matryoshka) embeddings.
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchResults = await this.embedBatchInternal(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    if (results.length === 0) {
      throw new Error("Embedding generation returned no results");
    }
    return results[0] as EmbeddingResult;
  }

  private async embedBatchInternal(
    texts: string[]
  ): Promise<EmbeddingResult[]> {
    // Check circuit breaker
    const usePrimary = !this.isCircuitOpen();

    if (usePrimary) {
      try {
        const embeddings = await this.embedViaOllama(texts);
        this.primaryFailures = 0;
        return embeddings.map((e) => this.withMatryoshka(e));
      } catch (err) {
        this.primaryFailures++;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          {
            failures: this.primaryFailures,
            error: msg,
          },
          "Primary embedding failed"
        );

        if (this.primaryFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
          logger.warn(
            { resetAt: new Date(this.circuitOpenUntil).toISOString() },
            "Circuit breaker opened, switching to fallback"
          );
        }
      }
    }

    // Fallback to Voyage
    if (VOYAGE_API_KEY) {
      try {
        const embeddings = await this.embedViaVoyage(texts);
        return embeddings.map((e) => this.withMatryoshka(e));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, "Fallback embedding also failed");
        throw new Error(`All embedding providers failed: ${msg}`);
      }
    }

    throw new Error(
      "Primary embedding failed and no fallback configured (set VOYAGE_API_KEY)"
    );
  }

  private async embedViaOllama(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = (await response.json()) as { embedding: number[] };
      if (!data.embedding || data.embedding.length === 0) {
        throw new Error("Empty embedding returned");
      }
      results.push(data.embedding);
    }

    return results;
  }

  private async embedViaVoyage(texts: string[]): Promise<number[][]> {
    const response = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "voyage-3-lite",
        input: texts,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Voyage API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((d) => d.embedding);
  }

  /**
   * Matryoshka truncation: 768-dim → 256-dim with L2 re-normalization.
   */
  private withMatryoshka(embedding768: number[]): EmbeddingResult {
    // Truncate to first 256 dimensions
    const truncated = embedding768.slice(0, 256);

    // L2 normalize
    const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
    const embedding256 = norm > 0 ? truncated.map((v) => v / norm) : truncated;

    return { embedding768, embedding256 };
  }

  private isCircuitOpen(): boolean {
    if (this.circuitOpenUntil === 0) {
      return false;
    }
    if (Date.now() > this.circuitOpenUntil) {
      // Reset circuit breaker
      this.circuitOpenUntil = 0;
      this.primaryFailures = 0;
      logger.info("Circuit breaker reset, trying primary again");
      return false;
    }
    return true;
  }
}
