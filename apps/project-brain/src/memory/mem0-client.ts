import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:mem0-client");

const MEM0_URL = process.env.MEM0_URL ?? "http://localhost:8080";
const REQUEST_TIMEOUT_MS = 10_000;

export interface Mem0Memory {
  createdAt: string;
  id: string;
  memory: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

interface Mem0AddResponse {
  id: string;
}

interface Mem0SearchResponse {
  results: Mem0Memory[];
}

interface Mem0ListResponse {
  results: Mem0Memory[];
}

/**
 * HTTP client for the Mem0 memory API (self-hosted or cloud).
 * Provides CRUD operations for long-term user/project memories.
 */
export class Mem0Client {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? MEM0_URL;
  }

  /**
   * Add a new memory entry for a user.
   */
  async addMemory(
    text: string,
    userId: string,
    metadata?: Record<string, unknown>
  ): Promise<{ id: string }> {
    const body = {
      messages: [{ role: "user", content: text }],
      user_id: userId,
      metadata: metadata ?? {},
    };

    const response = await this.request<Mem0AddResponse>("/v1/memories/", {
      method: "POST",
      body,
    });

    logger.debug({ userId, memoryId: response.id }, "Memory added to Mem0");
    return { id: response.id };
  }

  /**
   * Search memories by semantic similarity to a query.
   */
  async searchMemories(
    query: string,
    userId: string,
    limit = 10
  ): Promise<Mem0Memory[]> {
    const body = {
      query,
      user_id: userId,
      limit,
    };

    const response = await this.request<Mem0SearchResponse>(
      "/v1/memories/search/",
      {
        method: "POST",
        body,
      }
    );

    logger.debug(
      { userId, query, resultCount: response.results.length },
      "Mem0 search completed"
    );
    return response.results;
  }

  /**
   * Get all memories for a user.
   */
  async getMemories(userId: string): Promise<Mem0Memory[]> {
    const response = await this.request<Mem0ListResponse>(
      `/v1/memories/?user_id=${encodeURIComponent(userId)}`,
      { method: "GET" }
    );

    return response.results;
  }

  /**
   * Delete a specific memory by ID.
   */
  async deleteMemory(memoryId: string): Promise<void> {
    await this.request<unknown>(
      `/v1/memories/${encodeURIComponent(memoryId)}/`,
      {
        method: "DELETE",
      }
    );

    logger.debug({ memoryId }, "Memory deleted from Mem0");
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST" | "DELETE";
      body?: Record<string, unknown>;
    }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const apiKey = process.env.MEM0_API_KEY;
    if (apiKey) {
      headers.Authorization = `Token ${apiKey}`;
    }

    const fetchOptions: RequestInit = {
      method: options.method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      const error = new Error(
        `Mem0 API error (${response.status}): ${errorText}`
      );
      logger.error({ url, status: response.status, errorText }, error.message);
      throw error;
    }

    if (options.method === "DELETE") {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
