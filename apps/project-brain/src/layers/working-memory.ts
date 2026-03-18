import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:working-memory");

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

export class WorkingMemoryLayer {
  // In-memory with TTL (TODO: use Redis for distributed working memory)
  private store = new Map<string, MemoryEntry>();

  async set(sessionId: string, key: string, value: unknown, ttlSeconds: number = 3600): Promise<void> {
    const fullKey = `${sessionId}:${key}`;
    this.store.set(fullKey, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async get(sessionId: string, key: string): Promise<unknown | null> {
    const fullKey = `${sessionId}:${key}`;
    const entry = this.store.get(fullKey);

    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(fullKey);
      return null;
    }

    return entry.value;
  }

  async getAll(sessionId: string): Promise<Record<string, unknown>> {
    const prefix = `${sessionId}:`;
    const result: Record<string, unknown> = {};
    const now = Date.now();

    for (const [key, entry] of this.store) {
      if (key.startsWith(prefix) && now <= entry.expiresAt) {
        result[key.slice(prefix.length)] = entry.value;
      }
    }

    return result;
  }

  async delete(sessionId: string, key: string): Promise<void> {
    this.store.delete(`${sessionId}:${key}`);
  }

  async clearSession(sessionId: string): Promise<void> {
    const prefix = `${sessionId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
    logger.debug({ sessionId }, "Working memory cleared");
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
