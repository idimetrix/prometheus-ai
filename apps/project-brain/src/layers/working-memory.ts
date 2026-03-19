/**
 * Phase 8.3: Working Memory with Typed Key Namespaces.
 * Structured scratchpad with typed namespaces and selective invalidation.
 *
 * Namespaces: plan, files, decisions, errors, context
 */
import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";

const logger = createLogger("project-brain:working-memory");

const WORKING_MEMORY_PREFIX = "wm:";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

/**
 * Typed key namespaces for structured working memory.
 * Each namespace groups related keys for selective invalidation.
 */
export type WorkingMemoryNamespace =
  | "plan"
  | "files"
  | "decisions"
  | "errors"
  | "context";

const VALID_NAMESPACES = new Set<WorkingMemoryNamespace>([
  "plan",
  "files",
  "decisions",
  "errors",
  "context",
]);

function buildKey(sessionId: string, key: string): string {
  return `${WORKING_MEMORY_PREFIX}${sessionId}:${key}`;
}

function buildNamespacedKey(
  sessionId: string,
  namespace: WorkingMemoryNamespace,
  key: string
): string {
  return `${WORKING_MEMORY_PREFIX}${sessionId}:${namespace}:${key}`;
}

export class WorkingMemoryLayer {
  // ─── Basic key-value operations ─────────────────────────────────

  async set(
    sessionId: string,
    key: string,
    value: unknown,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    const fullKey = buildKey(sessionId, key);
    const serialized = JSON.stringify(value);
    await redis.set(fullKey, serialized, "EX", ttlSeconds);
    logger.debug({ sessionId, key }, "Working memory set");
  }

  async get(sessionId: string, key: string): Promise<unknown | null> {
    const fullKey = buildKey(sessionId, key);
    const raw = await redis.get(fullKey);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async getAll(sessionId: string): Promise<Record<string, unknown>> {
    const pattern = `${WORKING_MEMORY_PREFIX}${sessionId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length === 0) {
      return {};
    }

    const result: Record<string, unknown> = {};
    const prefix = `${WORKING_MEMORY_PREFIX}${sessionId}:`;

    const values = await redis.mget(...keys);
    for (let i = 0; i < keys.length; i++) {
      const shortKey = keys[i]?.slice(prefix.length) ?? "";
      const raw = values[i] ?? null;
      if (raw !== null) {
        try {
          result[shortKey] = JSON.parse(raw);
        } catch {
          result[shortKey] = raw;
        }
      }
    }

    return result;
  }

  async delete(sessionId: string, key: string): Promise<void> {
    const fullKey = buildKey(sessionId, key);
    await redis.del(fullKey);
  }

  async clearSession(sessionId: string): Promise<void> {
    const pattern = `${WORKING_MEMORY_PREFIX}${sessionId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    logger.debug(
      { sessionId, keysCleared: keys.length },
      "Working memory cleared"
    );
  }

  // ─── Namespaced operations (Phase 8.3) ──────────────────────────

  /**
   * Set a value within a typed namespace.
   */
  async setNamespaced(
    sessionId: string,
    namespace: WorkingMemoryNamespace,
    key: string,
    value: unknown,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    const fullKey = buildNamespacedKey(sessionId, namespace, key);
    const serialized = JSON.stringify(value);
    await redis.set(fullKey, serialized, "EX", ttlSeconds);
    logger.debug({ sessionId, namespace, key }, "Namespaced memory set");
  }

  /**
   * Get a value from a typed namespace.
   */
  async getNamespaced(
    sessionId: string,
    namespace: WorkingMemoryNamespace,
    key: string
  ): Promise<unknown | null> {
    const fullKey = buildNamespacedKey(sessionId, namespace, key);
    const raw = await redis.get(fullKey);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Get all keys within a namespace.
   */
  async getNamespaceAll(
    sessionId: string,
    namespace: WorkingMemoryNamespace
  ): Promise<Record<string, unknown>> {
    const pattern = `${WORKING_MEMORY_PREFIX}${sessionId}:${namespace}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length === 0) {
      return {};
    }

    const result: Record<string, unknown> = {};
    const prefix = `${WORKING_MEMORY_PREFIX}${sessionId}:${namespace}:`;

    const values = await redis.mget(...keys);
    for (let i = 0; i < keys.length; i++) {
      const shortKey = keys[i]?.slice(prefix.length) ?? "";
      const raw = values[i] ?? null;
      if (raw !== null) {
        try {
          result[shortKey] = JSON.parse(raw);
        } catch {
          result[shortKey] = raw;
        }
      }
    }

    return result;
  }

  /**
   * Selective invalidation: clear all keys within a specific namespace.
   * Other namespaces are preserved.
   */
  async invalidateNamespace(
    sessionId: string,
    namespace: WorkingMemoryNamespace
  ): Promise<number> {
    const pattern = `${WORKING_MEMORY_PREFIX}${sessionId}:${namespace}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    logger.debug(
      { sessionId, namespace, keysCleared: keys.length },
      "Namespace invalidated"
    );
    return keys.length;
  }

  /**
   * Invalidate multiple namespaces at once.
   */
  async invalidateNamespaces(
    sessionId: string,
    namespaces: WorkingMemoryNamespace[]
  ): Promise<number> {
    let total = 0;
    for (const ns of namespaces) {
      total += await this.invalidateNamespace(sessionId, ns);
    }
    return total;
  }

  /**
   * Get all valid namespaces.
   */
  getValidNamespaces(): WorkingMemoryNamespace[] {
    return Array.from(VALID_NAMESPACES);
  }
}
