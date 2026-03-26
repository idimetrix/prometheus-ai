import { getInternalAuthHeaders } from "@prometheus/auth";
import { agentMemories, db, episodicMemories } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

const logger = createLogger("project-brain:episodic");

export interface EpisodicMemory {
  createdAt: Date;
  decision: string;
  eventType: string;
  id: string;
  outcome: string | null;
  projectId: string;
  reasoning: string | null;
}

export class EpisodicLayer {
  async store(
    projectId: string,
    data: {
      eventType: string;
      decision: string;
      reasoning?: string;
      outcome?: string;
    }
  ): Promise<EpisodicMemory> {
    const id = generateId("ep");

    const [inserted] = await db
      .insert(episodicMemories)
      .values({
        id,
        projectId,
        eventType: data.eventType,
        decision: data.decision,
        reasoning: data.reasoning ?? null,
        outcome: data.outcome ?? null,
      })
      .returning();

    logger.debug(
      { projectId, eventType: data.eventType, id },
      "Episodic memory stored"
    );

    const record = inserted as NonNullable<typeof inserted>;
    return {
      id: record.id,
      projectId: record.projectId,
      eventType: record.eventType,
      decision: record.decision,
      reasoning: record.reasoning,
      outcome: record.outcome,
      createdAt: record.createdAt,
    };
  }

  /**
   * Recall episodic memories related to a query.
   * Phase 8.2: Uses embedding-based vector similarity when available,
   * falls back to ILIKE text search otherwise.
   */
  async recall(
    projectId: string,
    query: string,
    limit = 5
  ): Promise<EpisodicMemory[]> {
    // Try embedding-based recall first via agent_memories (episodic type with embeddings)
    try {
      const embeddingResults = await this.recallViaEmbeddings(
        projectId,
        query,
        limit
      );
      if (embeddingResults.length > 0) {
        return embeddingResults;
      }
    } catch {
      // Embedding service unavailable, fall through to text search
    }

    // Fallback: ILIKE text search
    const results = await db
      .select()
      .from(episodicMemories)
      .where(
        and(
          eq(episodicMemories.projectId, projectId),
          or(
            ilike(episodicMemories.decision, `%${query}%`),
            ilike(episodicMemories.reasoning, `%${query}%`)
          )
        )
      )
      .orderBy(desc(episodicMemories.createdAt))
      .limit(limit);

    return results.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      eventType: r.eventType,
      decision: r.decision,
      reasoning: r.reasoning,
      outcome: r.outcome,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Embedding-based episodic recall using vector similarity
   * against agent_memories with memoryType='episodic'.
   */
  private async recallViaEmbeddings(
    projectId: string,
    query: string,
    limit: number
  ): Promise<EpisodicMemory[]> {
    // Generate query embedding via Ollama
    const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const model = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";

    const embResponse = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({ model, prompt: query }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!embResponse.ok) {
      throw new Error("Embedding generation failed");
    }

    const embData = (await embResponse.json()) as { embedding: number[] };
    if (!embData.embedding?.length) {
      throw new Error("Empty embedding");
    }

    const embeddingStr = `[${embData.embedding.join(",")}]`;

    // Vector similarity search on agent_memories (episodic type)
    const results = await db
      .select({
        id: agentMemories.id,
        content: agentMemories.content,
        projectId: agentMemories.projectId,
        createdAt: agentMemories.createdAt,
        similarity: sql<number>`1 - (${agentMemories.embedding} <=> ${embeddingStr}::vector)`,
      })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "episodic")
        )
      )
      .orderBy(sql`${agentMemories.embedding} <=> ${embeddingStr}::vector`)
      .limit(limit);

    return results.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      eventType: "recall",
      decision: r.content,
      reasoning: null,
      outcome: null,
      createdAt: r.createdAt,
    }));
  }

  async getRecent(projectId: string, limit = 10): Promise<EpisodicMemory[]> {
    const results = await db
      .select()
      .from(episodicMemories)
      .where(eq(episodicMemories.projectId, projectId))
      .orderBy(desc(episodicMemories.createdAt))
      .limit(limit);

    return results.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      eventType: r.eventType,
      decision: r.decision,
      reasoning: r.reasoning,
      outcome: r.outcome,
      createdAt: r.createdAt,
    }));
  }
}
