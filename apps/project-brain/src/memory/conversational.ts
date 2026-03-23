import crypto from "node:crypto";
import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, desc, eq, sql } from "drizzle-orm";

const logger = createLogger("project-brain:conversational-memory");

// ─── Top-level regex constants for pattern detection ─────────────────────
const PREFERENCE_PATTERNS: RegExp[] = [
  /(?:i (?:prefer|like|want|always use|always prefer|love))\s+(.{10,100})/gi,
  /(?:please (?:always|use|prefer))\s+(.{10,100})/gi,
  /(?:my preference is)\s+(.{10,100})/gi,
  /(?:don't|never|avoid)\s+(?:use|do|add)\s+(.{10,80})/gi,
];

const DECISION_PATTERNS: RegExp[] = [
  /(?:we (?:decided|chose|agreed|went with|will use|should use))\s+(.{10,150})/gi,
  /(?:the (?:decision|plan|approach) is)\s+(.{10,150})/gi,
  /(?:let's go with|let's use|we'll use)\s+(.{10,100})/gi,
];

const CONVENTION_PATTERNS: RegExp[] = [
  /(?:convention|standard|rule|guideline):\s*(.{10,150})/gi,
  /(?:always (?:name|prefix|suffix|format|structure))\s+(.{10,100})/gi,
  /(?:files? (?:should|must) be)\s+(.{10,100})/gi,
];

const TRAILING_PUNCTUATION_RE = /[.!?]+$/;

/**
 * A single conversational memory entry (Mem0-style).
 *
 * Stores user preferences, project decisions, conventions,
 * and any other cross-session knowledge extracted from conversations.
 */
export interface ConversationalMemory {
  /** How many times this memory has been retrieved (boosts importance). */
  accessCount: number;
  category: MemoryCategory;
  content: string;
  createdAt: Date;
  id: string;
  /** Normalized importance score (0-1). Decays over time. */
  importance: number;
  lastAccessedAt: Date;
  projectId: string;
  /** Tags for faster filtering. */
  tags: string[];
}

export type MemoryCategory =
  | "user_preference"
  | "project_decision"
  | "convention"
  | "architecture"
  | "debugging_insight"
  | "workflow"
  | "general";

interface StoredMemoryPayload {
  accessCount: number;
  category: MemoryCategory;
  importance: number;
  lastAccessedAt: string;
  originalContent: string;
  tags: string[];
}

const MEMORY_PREFIX = "conv:";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBEDDING_DIMENSIONS = 768;

/** Half-life for memory decay in days. */
const DECAY_HALF_LIFE_DAYS = 30;

/**
 * Conversational Memory Layer (Mem0-style).
 *
 * Provides:
 * - Store user preferences, project decisions, conventions
 * - Similarity-based retrieval using vector embeddings
 * - Memory decay (older memories weighted less unless frequently accessed)
 * - Cross-session persistence via agent_memories table
 * - Automatic deduplication and consolidation
 */
export class ConversationalMemoryLayer {
  // ─── Store ───────────────────────────────────────────────────────

  /**
   * Store a new conversational memory. Automatically deduplicates
   * against existing memories with similar content.
   */
  async store(
    projectId: string,
    data: {
      content: string;
      category: MemoryCategory;
      importance?: number;
      tags?: string[];
    }
  ): Promise<ConversationalMemory> {
    const { content, category, importance = 0.5, tags = [] } = data;

    // Check for duplicates using similarity
    const similar = await this.findSimilar(projectId, content, 1, 0.9);
    if (similar.length > 0) {
      // Update existing memory instead of creating a duplicate
      const existing = similar[0] as (typeof similar)[0];
      const updated = await this.boostMemory(projectId, existing.id);
      if (updated) {
        logger.debug(
          { projectId, id: existing.id },
          "Boosted existing similar memory instead of duplicating"
        );
        return updated;
      }
    }

    const id = generateId("cmem");
    const now = new Date();

    const payload: StoredMemoryPayload = {
      category,
      importance,
      accessCount: 0,
      tags,
      lastAccessedAt: now.toISOString(),
      originalContent: content,
    };

    const storedContent = `${MEMORY_PREFIX}${JSON.stringify(payload)}`;

    // Generate embedding for similarity search
    const embedding = await this.generateEmbedding(content);

    await db.insert(agentMemories).values({
      id,
      projectId,
      memoryType: "convention", // Reuse existing enum value for conversational memories
      content: storedContent,
      embedding,
      createdAt: now,
    });

    logger.debug({ projectId, id, category }, "Conversational memory stored");

    return {
      id,
      projectId,
      category,
      content,
      importance,
      accessCount: 0,
      tags,
      createdAt: now,
      lastAccessedAt: now,
    };
  }

  // ─── Retrieve ────────────────────────────────────────────────────

  /**
   * Retrieve memories most relevant to a query, ranked by
   * similarity * decayed importance.
   */
  async retrieve(
    projectId: string,
    query: string,
    limit = 10,
    categories?: MemoryCategory[]
  ): Promise<ConversationalMemory[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    const now = new Date();

    try {
      // Vector similarity search using pgvector
      const results = await db
        .select({
          id: agentMemories.id,
          projectId: agentMemories.projectId,
          content: agentMemories.content,
          createdAt: agentMemories.createdAt,
          similarity: sql<number>`1 - (${agentMemories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
        })
        .from(agentMemories)
        .where(
          and(
            eq(agentMemories.projectId, projectId),
            eq(agentMemories.memoryType, "convention"),
            sql`${agentMemories.content} LIKE ${`${MEMORY_PREFIX}%`}`
          )
        )
        .orderBy(
          sql`${agentMemories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`
        )
        .limit(limit * 3); // Fetch extra for post-filtering

      const memories: Array<ConversationalMemory & { score: number }> = [];

      for (const row of results) {
        const parsed = this.parseStoredContent(row.content);
        if (!parsed) {
          continue;
        }

        // Filter by category if specified
        if (categories && !categories.includes(parsed.category)) {
          continue;
        }

        // Apply memory decay
        const ageMs = now.getTime() - row.createdAt.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const decayFactor = 0.5 ** (ageDays / DECAY_HALF_LIFE_DAYS);

        // Access frequency boost: each access adds a small boost
        const accessBoost = Math.min(parsed.accessCount * 0.02, 0.3);

        // Final score: similarity * (decayed importance + access boost)
        const effectiveImportance =
          parsed.importance * decayFactor + accessBoost;
        const finalScore =
          (row.similarity ?? 0) * (0.5 + 0.5 * effectiveImportance);

        memories.push({
          id: row.id,
          projectId: row.projectId,
          category: parsed.category,
          content: parsed.originalContent,
          importance: effectiveImportance,
          accessCount: parsed.accessCount,
          tags: parsed.tags,
          createdAt: row.createdAt,
          lastAccessedAt: new Date(parsed.lastAccessedAt),
          score: finalScore,
        });
      }

      // Sort by final score and take top N
      memories.sort((a, b) => b.score - a.score);
      const topMemories = memories.slice(0, limit);

      // Record access for retrieved memories (async, don't block)
      this.recordAccess(topMemories.map((m) => m.id)).catch((err) => {
        logger.warn({ err }, "Failed to record memory access");
      });

      return topMemories;
    } catch (err) {
      logger.warn(
        { err },
        "Vector search failed for conversational memory, falling back to text search"
      );
      return this.textSearch(projectId, query, limit, categories);
    }
  }

  /**
   * Find similar memories by content (for deduplication).
   */
  async findSimilar(
    projectId: string,
    content: string,
    limit = 5,
    minSimilarity = 0.7
  ): Promise<ConversationalMemory[]> {
    const embedding = await this.generateEmbedding(content);

    try {
      const results = await db
        .select({
          id: agentMemories.id,
          projectId: agentMemories.projectId,
          content: agentMemories.content,
          createdAt: agentMemories.createdAt,
          similarity: sql<number>`1 - (${agentMemories.embedding} <=> ${JSON.stringify(embedding)}::vector)`,
        })
        .from(agentMemories)
        .where(
          and(
            eq(agentMemories.projectId, projectId),
            eq(agentMemories.memoryType, "convention"),
            sql`${agentMemories.content} LIKE ${`${MEMORY_PREFIX}%`}`
          )
        )
        .orderBy(
          sql`${agentMemories.embedding} <=> ${JSON.stringify(embedding)}::vector`
        )
        .limit(limit);

      return results
        .filter((r) => (r.similarity ?? 0) >= minSimilarity)
        .map((r) => {
          const parsed = this.parseStoredContent(r.content);
          if (!parsed) {
            return null;
          }
          return {
            id: r.id,
            projectId: r.projectId,
            category: parsed.category,
            content: parsed.originalContent,
            importance: parsed.importance,
            accessCount: parsed.accessCount,
            tags: parsed.tags,
            createdAt: r.createdAt,
            lastAccessedAt: new Date(parsed.lastAccessedAt),
          };
        })
        .filter((m): m is ConversationalMemory => m !== null);
    } catch {
      return [];
    }
  }

  // ─── Memory Management ──────────────────────────────────────────

  /**
   * Boost a memory's importance and access count (used when retrieved or confirmed).
   */
  async boostMemory(
    projectId: string,
    memoryId: string
  ): Promise<ConversationalMemory | null> {
    const rows = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.id, memoryId),
          eq(agentMemories.projectId, projectId)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as (typeof rows)[0];
    const parsed = this.parseStoredContent(row.content);
    if (!parsed) {
      return null;
    }

    // Boost importance (cap at 1.0) and increment access count
    parsed.importance = Math.min(parsed.importance + 0.05, 1.0);
    parsed.accessCount += 1;
    parsed.lastAccessedAt = new Date().toISOString();

    const updatedContent = `${MEMORY_PREFIX}${JSON.stringify(parsed)}`;
    await db
      .update(agentMemories)
      .set({ content: updatedContent })
      .where(eq(agentMemories.id, memoryId));

    return {
      id: memoryId,
      projectId,
      category: parsed.category,
      content: parsed.originalContent,
      importance: parsed.importance,
      accessCount: parsed.accessCount,
      tags: parsed.tags,
      createdAt: row.createdAt,
      lastAccessedAt: new Date(parsed.lastAccessedAt),
    };
  }

  /**
   * Get all memories for a project, optionally filtered by category.
   */
  async getAll(
    projectId: string,
    category?: MemoryCategory,
    limit = 100
  ): Promise<ConversationalMemory[]> {
    const rows = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "convention"),
          sql`${agentMemories.content} LIKE ${`${MEMORY_PREFIX}%`}`
        )
      )
      .orderBy(desc(agentMemories.createdAt))
      .limit(limit);

    const memories: ConversationalMemory[] = [];
    for (const row of rows) {
      const parsed = this.parseStoredContent(row.content);
      if (!parsed) {
        continue;
      }
      if (category && parsed.category !== category) {
        continue;
      }

      memories.push({
        id: row.id,
        projectId: row.projectId,
        category: parsed.category,
        content: parsed.originalContent,
        importance: parsed.importance,
        accessCount: parsed.accessCount,
        tags: parsed.tags,
        createdAt: row.createdAt,
        lastAccessedAt: new Date(parsed.lastAccessedAt),
      });
    }

    return memories;
  }

  /**
   * Delete a specific memory.
   */
  async delete(projectId: string, memoryId: string): Promise<void> {
    await db
      .delete(agentMemories)
      .where(
        and(
          eq(agentMemories.id, memoryId),
          eq(agentMemories.projectId, projectId)
        )
      );
    logger.debug({ projectId, memoryId }, "Conversational memory deleted");
  }

  /**
   * Prune low-importance memories that have decayed below threshold.
   * Call periodically to keep memory store manageable.
   */
  async prune(
    projectId: string,
    minEffectiveImportance = 0.05
  ): Promise<number> {
    const allMemories = await this.getAll(projectId);
    const now = new Date();
    let pruned = 0;

    for (const mem of allMemories) {
      const ageDays =
        (now.getTime() - mem.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = 0.5 ** (ageDays / DECAY_HALF_LIFE_DAYS);
      const accessBoost = Math.min(mem.accessCount * 0.02, 0.3);
      const effectiveImportance = mem.importance * decayFactor + accessBoost;

      if (effectiveImportance < minEffectiveImportance) {
        await this.delete(projectId, mem.id);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.info(
        { projectId, pruned },
        "Pruned low-importance conversational memories"
      );
    }
    return pruned;
  }

  /**
   * Extract memories from a conversation transcript.
   * Identifies preferences, decisions, and conventions mentioned.
   */
  async extractFromConversation(
    projectId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<ConversationalMemory[]> {
    const stored: ConversationalMemory[] = [];

    for (const msg of messages) {
      if (msg.role !== "user" && msg.role !== "assistant") {
        continue;
      }

      // Extract user preferences
      const preferences = this.detectPreferences(msg.content);
      for (const pref of preferences) {
        const mem = await this.store(projectId, {
          content: pref,
          category: "user_preference",
          importance: 0.7,
          tags: ["auto-extracted"],
        });
        stored.push(mem);
      }

      // Extract project decisions
      const decisions = this.detectDecisions(msg.content);
      for (const decision of decisions) {
        const mem = await this.store(projectId, {
          content: decision,
          category: "project_decision",
          importance: 0.8,
          tags: ["auto-extracted"],
        });
        stored.push(mem);
      }

      // Extract conventions
      const conventions = this.detectConventions(msg.content);
      for (const conv of conventions) {
        const mem = await this.store(projectId, {
          content: conv,
          category: "convention",
          importance: 0.6,
          tags: ["auto-extracted"],
        });
        stored.push(mem);
      }
    }

    if (stored.length > 0) {
      logger.info(
        { projectId, extracted: stored.length },
        "Extracted conversational memories from transcript"
      );
    }

    return stored;
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private parseStoredContent(content: string): StoredMemoryPayload | null {
    if (!content.startsWith(MEMORY_PREFIX)) {
      return null;
    }
    try {
      return JSON.parse(
        content.slice(MEMORY_PREFIX.length)
      ) as StoredMemoryPayload;
    } catch {
      return null;
    }
  }

  private async recordAccess(memoryIds: string[]): Promise<void> {
    for (const id of memoryIds) {
      const rows = await db
        .select()
        .from(agentMemories)
        .where(eq(agentMemories.id, id))
        .limit(1);

      if (rows.length === 0) {
        continue;
      }
      const parsed = this.parseStoredContent(rows[0]?.content ?? "");
      if (!parsed) {
        continue;
      }

      parsed.accessCount += 1;
      parsed.lastAccessedAt = new Date().toISOString();
      const updatedContent = `${MEMORY_PREFIX}${JSON.stringify(parsed)}`;

      await db
        .update(agentMemories)
        .set({ content: updatedContent })
        .where(eq(agentMemories.id, id));
    }
  }

  private async textSearch(
    projectId: string,
    query: string,
    limit: number,
    categories?: MemoryCategory[]
  ): Promise<ConversationalMemory[]> {
    const rows = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "convention"),
          sql`${agentMemories.content} LIKE ${`${MEMORY_PREFIX}%`}`,
          sql`${agentMemories.content} ILIKE ${`%${query}%`}`
        )
      )
      .orderBy(desc(agentMemories.createdAt))
      .limit(limit);

    return rows
      .map((row) => {
        const parsed = this.parseStoredContent(row.content);
        if (!parsed) {
          return null;
        }
        if (categories && !categories.includes(parsed.category)) {
          return null;
        }
        return {
          id: row.id,
          projectId: row.projectId,
          category: parsed.category,
          content: parsed.originalContent,
          importance: parsed.importance,
          accessCount: parsed.accessCount,
          tags: parsed.tags,
          createdAt: row.createdAt,
          lastAccessedAt: new Date(parsed.lastAccessedAt),
        };
      })
      .filter((m): m is ConversationalMemory => m !== null);
  }

  /**
   * Detect user preference patterns in text.
   */
  private detectPreferences(text: string): string[] {
    const prefs: string[] = [];

    for (const pattern of PREFERENCE_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match !== null) {
        if (match[1]) {
          prefs.push(match[1].trim().replace(TRAILING_PUNCTUATION_RE, ""));
        }
        match = pattern.exec(text);
      }
    }

    return prefs;
  }

  /**
   * Detect project decision patterns in text.
   */
  private detectDecisions(text: string): string[] {
    const decisions: string[] = [];

    for (const pattern of DECISION_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match !== null) {
        if (match[1]) {
          decisions.push(match[1].trim().replace(TRAILING_PUNCTUATION_RE, ""));
        }
        match = pattern.exec(text);
      }
    }

    return decisions;
  }

  /**
   * Detect convention patterns in text.
   */
  private detectConventions(text: string): string[] {
    const conventions: string[] = [];

    for (const pattern of CONVENTION_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match !== null) {
        if (match[1]) {
          conventions.push(
            match[1].trim().replace(TRAILING_PUNCTUATION_RE, "")
          );
        }
        match = pattern.exec(text);
      }
    }

    return conventions;
  }

  // ─── Embedding Generation ────────────────────────────────────────

  private async generateEmbedding(text: string): Promise<number[]> {
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

    return this.hashEmbedding(text);
  }

  /** Deterministic fallback embedding using SHA-256 hashing. */
  private hashEmbedding(
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
}
