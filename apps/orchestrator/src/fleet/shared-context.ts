import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:shared-context");

export interface SharedContextEntry {
  agentId: string;
  agentRole: string;
  data: unknown;
  key: string;
  timestamp: number;
}

export class SharedContext {
  private readonly sessionId: string;
  private readonly prefix: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.prefix = `fleet:ctx:${sessionId}`;
  }

  async set(
    key: string,
    data: unknown,
    agentId: string,
    agentRole: string
  ): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    const entry: SharedContextEntry = {
      key,
      data,
      agentId,
      agentRole,
      timestamp: Date.now(),
    };
    await redis.set(`${this.prefix}:${key}`, JSON.stringify(entry), "EX", 3600);
    logger.debug({ key, agentId }, "Shared context updated");
  }

  async get(key: string): Promise<SharedContextEntry | null> {
    const { redis } = await import("@prometheus/queue");
    const raw = await redis.get(`${this.prefix}:${key}`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SharedContextEntry;
  }

  async getAll(): Promise<SharedContextEntry[]> {
    const { redis } = await import("@prometheus/queue");
    const keys = await redis.keys(`${this.prefix}:*`);
    if (keys.length === 0) {
      return [];
    }

    const values = await redis.mget(keys);
    const entries: SharedContextEntry[] = [];
    for (const val of values) {
      if (val) {
        entries.push(JSON.parse(val) as SharedContextEntry);
      }
    }
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getByAgent(agentId: string): Promise<SharedContextEntry[]> {
    const all = await this.getAll();
    return all.filter((e) => e.agentId === agentId);
  }

  async delete(key: string): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    await redis.del(`${this.prefix}:${key}`);
  }

  async clear(): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    const keys = await redis.keys(`${this.prefix}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }
    logger.info({ sessionId: this.sessionId }, "Shared context cleared");
  }
}
