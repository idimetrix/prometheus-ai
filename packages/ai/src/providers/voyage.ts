import { PROVIDER_ENV_KEYS } from "../models";

const VOYAGE_API_BASE = "https://api.voyageai.com/v1";

function getVoyageKey(apiKey?: string): string {
  if (apiKey) {
    return apiKey;
  }
  const key = process.env[PROVIDER_ENV_KEYS.voyage];
  if (!key) {
    throw new Error("Missing VOYAGE_API_KEY environment variable");
  }
  return key;
}

export interface VoyageEmbeddingResult {
  embeddings: number[][];
  model: string;
  usage: { totalTokens: number };
}

export interface VoyageRerankResult {
  model: string;
  results: Array<{ index: number; relevanceScore: number }>;
  usage: { totalTokens: number };
}

export class VoyageClient {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = getVoyageKey(apiKey);
  }

  async embed(
    texts: string[],
    model = "voyage-code-3",
    inputType: "document" | "query" = "document"
  ): Promise<VoyageEmbeddingResult> {
    const response = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
        input_type: inputType,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage embedding failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      model: string;
      usage: { total_tokens: number };
    };

    return {
      embeddings: data.data.map((d) => d.embedding),
      model: data.model,
      usage: { totalTokens: data.usage.total_tokens },
    };
  }

  async rerank(
    query: string,
    documents: string[],
    model = "rerank-2.5",
    topK?: number
  ): Promise<VoyageRerankResult> {
    const response = await fetch(`${VOYAGE_API_BASE}/rerank`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        query,
        documents,
        top_k: topK ?? documents.length,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage rerank failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      data: Array<{ index: number; relevance_score: number }>;
      model: string;
      usage: { total_tokens: number };
    };

    return {
      results: data.data.map((d) => ({
        index: d.index,
        relevanceScore: d.relevance_score,
      })),
      model: data.model,
      usage: { totalTokens: data.usage.total_tokens },
    };
  }
}

export function createVoyageClient(apiKey?: string): VoyageClient {
  return new VoyageClient(apiKey);
}
