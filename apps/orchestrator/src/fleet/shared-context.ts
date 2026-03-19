import { createLogger } from "@prometheus/logger";
import type { AgentBus, AgentBusMessage } from "./agent-bus";

const logger = createLogger("orchestrator:shared-context");

export interface SharedContextEntry {
  agentId: string;
  agentRole: string;
  data: unknown;
  key: string;
  timestamp: number;
}

/**
 * SharedContext provides Redis-backed shared memory for fleet agents,
 * now enhanced with AgentBus integration for real-time broadcasts
 * of state changes (file claims, decisions, completions).
 */
export class SharedContext {
  private readonly sessionId: string;
  private readonly prefix: string;
  private bus: AgentBus | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.prefix = `fleet:ctx:${sessionId}`;
  }

  /**
   * Attach an AgentBus instance so context mutations are broadcast
   * to all agents in the fleet via pub/sub.
   */
  attachBus(bus: AgentBus): void {
    this.bus = bus;
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

    // Broadcast context update to all agents via bus
    if (this.bus) {
      await this.bus
        .publish("discovery", { contextKey: key, data, agentId, agentRole })
        .catch(() => {
          /* best-effort broadcast */
        });
    }
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

  /**
   * Claim a file for exclusive editing by an agent.
   * Uses the AgentBus if attached, otherwise falls back to Redis HSETNX.
   */
  async claimFile(filePath: string, agentId: string): Promise<boolean> {
    if (this.bus) {
      return this.bus.claimFile(filePath);
    }
    const { redis } = await import("@prometheus/queue");
    const claimKey = `${this.prefix}:file_claims`;
    const result = await redis.hsetnx(claimKey, filePath, agentId);
    if (result === 1) {
      await redis.expire(claimKey, 3600);
      return true;
    }
    return false;
  }

  /**
   * Get all file claims for the session.
   */
  async getFileClaims(): Promise<Record<string, string>> {
    if (this.bus) {
      return this.bus.getFileClaims();
    }
    const { redis } = await import("@prometheus/queue");
    const claimKey = `${this.prefix}:file_claims`;
    return (await redis.hgetall(claimKey)) ?? {};
  }

  /**
   * Drain pending bus messages for an agent to process before
   * each LLM call (bus-backed shared state).
   */
  drainBusMessages(): Promise<AgentBusMessage[]> {
    if (!this.bus) {
      return Promise.resolve([]);
    }
    return this.bus.drainMessages();
  }
}
