import { redis } from "@prometheus/queue";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:working-memory");

const WORKING_MEMORY_PREFIX = "wm:";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

export class WorkingMemoryLayer {
  async set(
    sessionId: string,
    key: string,
    value: unknown,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const fullKey = `${WORKING_MEMORY_PREFIX}${sessionId}:${key}`;
    const serialized = JSON.stringify(value);
    await redis.set(fullKey, serialized, "EX", ttlSeconds);
    logger.debug({ sessionId, key }, "Working memory set");
  }

  async get(sessionId: string, key: string): Promise<unknown | null> {
    const fullKey = `${WORKING_MEMORY_PREFIX}${sessionId}:${key}`;
    const raw = await redis.get(fullKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async getAll(sessionId: string): Promise<Record<string, unknown>> {
    const pattern = `${WORKING_MEMORY_PREFIX}${sessionId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length === 0) return {};

    const result: Record<string, unknown> = {};
    const prefix = `${WORKING_MEMORY_PREFIX}${sessionId}:`;

    const values = await redis.mget(...keys);
    for (let i = 0; i < keys.length; i++) {
      const shortKey = keys[i]!.slice(prefix.length);
      const raw = values[i];
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
    const fullKey = `${WORKING_MEMORY_PREFIX}${sessionId}:${key}`;
    await redis.del(fullKey);
  }

  async clearSession(sessionId: string): Promise<void> {
    const pattern = `${WORKING_MEMORY_PREFIX}${sessionId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    logger.debug({ sessionId, keysCleared: keys.length }, "Working memory cleared");
  }
}
