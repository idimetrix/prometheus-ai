/**
 * Phase 3.3: Cross-project Pattern Library.
 *
 * Stores and retrieves reusable code patterns at the org level.
 * Uses an in-memory store backed by Redis for persistence, designed
 * to be migrated to a dedicated DB table (`pattern_library`) later.
 *
 * Patterns are indexed by org, type, tags, and a simple text-search
 * scoring mechanism for semantic-like retrieval without embeddings.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import Redis from "ioredis";

const logger = createLogger("project-brain:pattern-library");

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// ─── Public Interfaces ──────────────────────────────────────────────────

export interface CodePattern {
  code: string;
  createdAt: string;
  description: string;
  id: string;
  language: string;
  name: string;
  orgId: string;
  patternType:
    | "api_route"
    | "db_schema"
    | "component"
    | "test"
    | "middleware"
    | "hook"
    | "utility";
  qualityScore: number;
  sourceProjectId: string;
  tags: string[];
  updatedAt: string;
  usageCount: number;
}

type PatternInput = Omit<CodePattern, "id" | "createdAt" | "updatedAt">;

// ─── Redis Key Helpers ──────────────────────────────────────────────────

function patternKey(orgId: string, patternId: string): string {
  return `patterns:${orgId}:${patternId}`;
}

function orgIndexKey(orgId: string): string {
  return `patterns:${orgId}:index`;
}

function typeIndexKey(orgId: string, patternType: string): string {
  return `patterns:${orgId}:type:${patternType}`;
}

// ─── Text Search Scoring ────────────────────────────────────────────────

const WHITESPACE_RE = /\s+/;

function scorePatternMatch(pattern: CodePattern, query: string): number {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower
    .split(WHITESPACE_RE)
    .filter((t) => t.length > 1);

  if (queryTerms.length === 0) {
    return 0;
  }

  let score = 0;

  // Name match (highest weight)
  const nameLower = pattern.name.toLowerCase();
  if (nameLower === queryLower) {
    score += 1.0;
  } else if (nameLower.includes(queryLower)) {
    score += 0.7;
  } else {
    for (const term of queryTerms) {
      if (nameLower.includes(term)) {
        score += 0.3 / queryTerms.length;
      }
    }
  }

  // Description match
  const descLower = pattern.description.toLowerCase();
  for (const term of queryTerms) {
    if (descLower.includes(term)) {
      score += 0.2 / queryTerms.length;
    }
  }

  // Tag match
  const tagsLower = pattern.tags.map((t) => t.toLowerCase());
  for (const term of queryTerms) {
    if (tagsLower.some((tag) => tag.includes(term))) {
      score += 0.25 / queryTerms.length;
    }
  }

  // Code content match (lower weight, larger corpus)
  const codeLower = pattern.code.toLowerCase();
  for (const term of queryTerms) {
    if (codeLower.includes(term)) {
      score += 0.1 / queryTerms.length;
    }
  }

  // Quality and usage boost
  score *=
    0.7 + pattern.qualityScore * 0.2 + Math.min(pattern.usageCount / 100, 0.1);

  return score;
}

// ─── Task-type to Pattern-type Mapping ──────────────────────────────────

const TASK_TYPE_PATTERN_MAP: Record<string, string[]> = {
  "api-endpoint": ["api_route", "middleware", "utility"],
  "api-route": ["api_route", "middleware", "utility"],
  "database-migration": ["db_schema", "utility"],
  "db-schema": ["db_schema"],
  component: ["component", "hook"],
  "ui-component": ["component", "hook"],
  test: ["test"],
  "unit-test": ["test"],
  middleware: ["middleware", "utility"],
  hook: ["hook", "utility"],
  utility: ["utility"],
  refactor: ["utility", "api_route", "component"],
};

// ─── PatternLibrary ─────────────────────────────────────────────────────

export class PatternLibrary {
  private redis: Redis | null = null;
  private readonly inMemoryStore = new Map<string, CodePattern>();
  private redisAvailable = false;

  /**
   * Store a new pattern. Persists to Redis and keeps an in-memory copy.
   */
  async storePattern(input: PatternInput): Promise<CodePattern> {
    const now = new Date().toISOString();
    const pattern: CodePattern = {
      ...input,
      id: generateId("pat"),
      createdAt: now,
      updatedAt: now,
    };

    // In-memory first (always available)
    this.inMemoryStore.set(pattern.id, pattern);

    // Persist to Redis
    const redis = await this.getRedis();
    if (redis) {
      try {
        const key = patternKey(pattern.orgId, pattern.id);
        await redis.set(key, JSON.stringify(pattern));

        // Add to org index
        await redis.sadd(orgIndexKey(pattern.orgId), pattern.id);

        // Add to type index
        await redis.sadd(
          typeIndexKey(pattern.orgId, pattern.patternType),
          pattern.id
        );

        logger.debug(
          { patternId: pattern.id, orgId: pattern.orgId, name: pattern.name },
          "Pattern stored in Redis"
        );
      } catch (error) {
        logger.warn(
          {
            patternId: pattern.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to persist pattern to Redis, kept in memory"
        );
      }
    }

    logger.info(
      {
        patternId: pattern.id,
        orgId: pattern.orgId,
        name: pattern.name,
        type: pattern.patternType,
      },
      "Pattern stored"
    );

    return pattern;
  }

  /**
   * Find patterns matching a query string, optionally filtered by pattern type.
   * Returns results sorted by relevance score descending.
   */
  async findPatterns(
    orgId: string,
    query: string,
    patternType?: string
  ): Promise<CodePattern[]> {
    const patterns = await this.loadOrgPatterns(orgId);

    // Filter by type if specified
    const filtered = patternType
      ? patterns.filter((p) => p.patternType === patternType)
      : patterns;

    // Score and sort
    const scored = filtered
      .map((pattern) => ({
        pattern,
        score: scorePatternMatch(pattern, query),
      }))
      .filter((entry) => entry.score > 0.05)
      .sort((a, b) => b.score - a.score);

    return scored.map((entry) => entry.pattern);
  }

  /**
   * Get pattern context formatted as a prompt string for a given task type.
   * Returns the top matching patterns formatted for LLM consumption.
   */
  async getPatternContext(
    orgId: string,
    taskType: string,
    limit = 3
  ): Promise<string> {
    const relevantTypes = TASK_TYPE_PATTERN_MAP[taskType] ?? [];
    const allPatterns = await this.loadOrgPatterns(orgId);

    if (allPatterns.length === 0) {
      return "";
    }

    // Filter to relevant pattern types or use all if no mapping
    const candidates =
      relevantTypes.length > 0
        ? allPatterns.filter((p) => relevantTypes.includes(p.patternType))
        : allPatterns;

    if (candidates.length === 0) {
      return "";
    }

    // Sort by quality * usage to surface the best patterns
    const sorted = [...candidates].sort((a, b) => {
      const scoreA = a.qualityScore * 0.7 + Math.min(a.usageCount / 50, 0.3);
      const scoreB = b.qualityScore * 0.7 + Math.min(b.usageCount / 50, 0.3);
      return scoreB - scoreA;
    });

    const topPatterns = sorted.slice(0, limit);

    const parts: string[] = [
      "## Reusable Patterns (from org pattern library)",
      "",
    ];

    for (const pattern of topPatterns) {
      parts.push(`### ${pattern.name} (${pattern.patternType})`);
      parts.push(pattern.description);
      parts.push("");
      parts.push(`\`\`\`${pattern.language}`);
      parts.push(pattern.code);
      parts.push("```");
      if (pattern.tags.length > 0) {
        parts.push(`Tags: ${pattern.tags.join(", ")}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }

  /**
   * Increment the usage count for a pattern.
   */
  async incrementUsage(patternId: string): Promise<void> {
    // Update in memory
    const pattern = this.inMemoryStore.get(patternId);
    if (pattern) {
      pattern.usageCount++;
      pattern.updatedAt = new Date().toISOString();
    }

    // Update in Redis
    const redis = await this.getRedis();
    if (redis && pattern) {
      try {
        const key = patternKey(pattern.orgId, patternId);
        await redis.set(key, JSON.stringify(pattern));
      } catch (error) {
        logger.warn(
          {
            patternId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to update usage count in Redis"
        );
      }
    }

    // If not in memory, try to load from Redis and update
    if (!pattern) {
      await this.updatePatternInRedis(patternId, (p) => {
        p.usageCount++;
        p.updatedAt = new Date().toISOString();
        return p;
      });
    }
  }

  /**
   * Update the quality score for a pattern.
   */
  async updateQualityScore(patternId: string, score: number): Promise<void> {
    const clampedScore = Math.max(0, Math.min(1, score));

    // Update in memory
    const pattern = this.inMemoryStore.get(patternId);
    if (pattern) {
      pattern.qualityScore = clampedScore;
      pattern.updatedAt = new Date().toISOString();
    }

    // Update in Redis
    const redis = await this.getRedis();
    if (redis && pattern) {
      try {
        const key = patternKey(pattern.orgId, patternId);
        await redis.set(key, JSON.stringify(pattern));
      } catch (error) {
        logger.warn(
          {
            patternId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to update quality score in Redis"
        );
      }
    }

    // If not in memory, try to load from Redis and update
    if (!pattern) {
      await this.updatePatternInRedis(patternId, (p) => {
        p.qualityScore = clampedScore;
        p.updatedAt = new Date().toISOString();
        return p;
      });
    }
  }

  // ─── Private Methods ──────────────────────────────────────────────

  /**
   * Load all patterns for an org, merging in-memory and Redis stores.
   */
  private async loadOrgPatterns(orgId: string): Promise<CodePattern[]> {
    const patterns = new Map<string, CodePattern>();

    for (const [id, pattern] of this.inMemoryStore) {
      if (pattern.orgId === orgId) {
        patterns.set(id, pattern);
      }
    }

    await this.hydrateFromRedis(orgId, patterns);

    return Array.from(patterns.values());
  }

  private async hydrateFromRedis(
    orgId: string,
    patterns: Map<string, CodePattern>
  ): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) {
      return;
    }

    try {
      const patternIds = await redis.smembers(orgIndexKey(orgId));
      if (patternIds.length === 0) {
        return;
      }

      const keys = patternIds.map((id) => patternKey(orgId, id));
      const values = await redis.mget(...keys);

      for (const value of values) {
        this.hydratePatternFromValue(value, patterns);
      }
    } catch (error) {
      logger.warn(
        {
          orgId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to load patterns from Redis"
      );
    }
  }

  private hydratePatternFromValue(
    value: string | null,
    patterns: Map<string, CodePattern>
  ): void {
    if (!value) {
      return;
    }
    try {
      const pattern = JSON.parse(value) as CodePattern;
      if (!patterns.has(pattern.id)) {
        patterns.set(pattern.id, pattern);
        this.inMemoryStore.set(pattern.id, pattern);
      }
    } catch {
      // Skip malformed entries
    }
  }

  /**
   * Find and update a pattern directly in Redis when it's not in memory.
   */
  private async updatePatternInRedis(
    patternId: string,
    updater: (pattern: CodePattern) => CodePattern
  ): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) {
      return;
    }

    try {
      // We need to scan for the pattern since we don't know the orgId
      // This is a limitation of the Redis key structure; in practice
      // callers should have the pattern in memory already.
      const cursor = "0";
      const [, keys] = await redis.scan(
        cursor,
        "MATCH",
        `patterns:*:${patternId}`,
        "COUNT",
        100
      );

      for (const key of keys ?? []) {
        const value = await redis.get(key);
        if (value) {
          try {
            const pattern = JSON.parse(value) as CodePattern;
            const updated = updater(pattern);
            await redis.set(key, JSON.stringify(updated));
            this.inMemoryStore.set(patternId, updated);
            return;
          } catch {
            // Skip malformed entries
          }
        }
      }
    } catch (error) {
      logger.warn(
        {
          patternId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to update pattern in Redis"
      );
    }
  }

  /**
   * Get or create the Redis connection. Returns null if Redis is unavailable.
   */
  private async getRedis(): Promise<Redis | null> {
    if (this.redis) {
      return this.redisAvailable ? this.redis : null;
    }

    try {
      this.redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
      });

      await this.redis.connect();
      this.redisAvailable = true;
      logger.debug("Pattern library connected to Redis");
      return this.redis;
    } catch {
      this.redisAvailable = false;
      logger.info(
        "Redis unavailable for pattern library, using in-memory store only"
      );
      return null;
    }
  }
}
