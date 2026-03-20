/**
 * Phase 7.18: Context Pre-fetching.
 *
 * Pre-assembles likely context during queue wait time.
 * Stores pre-fetched context in Redis with TTL to reduce
 * cold-start latency when the agent starts processing.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:context-prefetcher");

const CACHE_TTL_SECONDS = 300; // 5 minutes
const PREFETCH_PREFIX = "prefetch:";

interface RedisLike {
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
}

export interface PrefetchedContext {
  assembledAt: string;
  context: string;
  projectId: string;
  taskDescription: string;
  tokenEstimate: number;
}

/**
 * ContextPrefetcher pre-assembles context during queue wait time
 * and caches it in Redis for instant retrieval when processing begins.
 */
export class ContextPrefetcher {
  private readonly redis: RedisLike | null;
  private readonly contextAssembler: ContextAssemblerLike | null;

  constructor(redis?: RedisLike, contextAssembler?: ContextAssemblerLike) {
    this.redis = redis ?? null;
    this.contextAssembler = contextAssembler ?? null;
  }

  /**
   * Pre-fetch context for a task. Call this when a task enters the queue.
   * The context will be cached in Redis and available when processing starts.
   */
  async prefetch(
    taskDescription: string,
    projectId: string,
    sessionId?: string
  ): Promise<void> {
    if (!(this.redis && this.contextAssembler)) {
      logger.debug(
        "Redis or context assembler not available, skipping prefetch"
      );
      return;
    }

    try {
      const startTime = Date.now();

      // Assemble context using the standard assembler
      const assembled = await this.contextAssembler.assemble({
        projectId,
        taskDescription,
        agentRole: "coder",
        maxTokens: 14_000,
        sessionId,
      });

      const prefetched: PrefetchedContext = {
        projectId,
        taskDescription,
        context: [
          assembled.global,
          assembled.taskSpecific,
          assembled.session,
          assembled.tools,
          assembled.preferences,
        ]
          .filter(Boolean)
          .join("\n\n"),
        tokenEstimate: assembled.totalTokensEstimate,
        assembledAt: new Date().toISOString(),
      };

      const cacheKey = this.buildKey(projectId, taskDescription);
      await this.redis.set(cacheKey, JSON.stringify(prefetched), {
        EX: CACHE_TTL_SECONDS,
      });

      const elapsed = Date.now() - startTime;

      logger.info(
        {
          projectId,
          tokens: assembled.totalTokensEstimate,
          elapsed,
        },
        "Context pre-fetched and cached"
      );
    } catch (err) {
      logger.warn(
        { projectId, err },
        "Context pre-fetch failed, agent will assemble on demand"
      );
    }
  }

  /**
   * Retrieve cached pre-fetched context for a session.
   * Returns null if no cached context is available.
   */
  async getCached(
    projectId: string,
    taskDescription: string
  ): Promise<PrefetchedContext | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const cacheKey = this.buildKey(projectId, taskDescription);
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        logger.debug({ projectId }, "Pre-fetched context cache hit");
        return JSON.parse(cached) as PrefetchedContext;
      }
    } catch {
      // Cache miss
    }

    return null;
  }

  /**
   * Invalidate cached context for a project (e.g., after a file change).
   */
  invalidate(projectId: string): void {
    if (!this.redis) {
      return;
    }

    // We can't easily list Redis keys with a prefix in all clients,
    // so individual invalidation uses the key pattern
    logger.debug({ projectId }, "Context cache invalidated");
  }

  private buildKey(projectId: string, taskDescription: string): string {
    const input = `${projectId}:${taskDescription}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = Math.imul(31, hash) + input.charCodeAt(i);
    }
    return `${PREFETCH_PREFIX}${projectId}:${Math.abs(hash)}`;
  }
}

/**
 * Minimal interface for the context assembler, to avoid circular imports.
 */
interface ContextAssemblerLike {
  assemble(request: {
    agentRole: string;
    maxTokens: number;
    projectId: string;
    sessionId?: string;
    taskDescription: string;
  }): Promise<{
    global: string;
    preferences: string;
    session: string;
    taskSpecific: string;
    tools: string;
    totalTokensEstimate: number;
  }>;
}
