import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:agent-bus");

/** TTL for session message lists in seconds (1 hour) */
const SESSION_TTL_SECONDS = 3600;

export interface AgentMessage {
  content: string;
  fromRole: string;
  id: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  toRole: string | "all";
  type: "info" | "request" | "response" | "conflict" | "complete";
}

interface RedisClient {
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  publish(channel: string, message: string): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
}

function sessionKey(sessionId: string, agentRole: string): string {
  return `agent-bus:${sessionId}:${agentRole}`;
}

function broadcastChannel(sessionId: string): string {
  return `agent-bus:broadcast:${sessionId}`;
}

function directChannel(sessionId: string, agentRole: string): string {
  return `agent-bus:direct:${sessionId}:${agentRole}`;
}

/**
 * Inter-agent communication bus.
 *
 * Uses Redis pub/sub for real-time messaging between agents, with Redis lists
 * for message persistence. Falls back to in-memory storage when Redis is
 * unavailable.
 */
export class AgentBus {
  private redis: RedisClient | null = null;
  private readonly fallbackStore = new Map<string, AgentMessage[]>();
  private readonly redisUrl: string | undefined;

  constructor(redisUrl?: string) {
    this.redisUrl = redisUrl ?? process.env.REDIS_URL;
    this.initRedis();
  }

  private initRedis(): void {
    if (!this.redisUrl) {
      logger.info("No Redis URL provided, using in-memory message store");
      return;
    }

    // Lazy-load Redis to avoid hard dependency
    import("@prometheus/queue")
      .then((mod) => {
        this.redis = mod.redis as unknown as RedisClient;
        logger.info("Agent bus connected to Redis");
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { error: msg },
          "Failed to connect to Redis, using in-memory fallback"
        );
      });
  }

  private serializeMessage(message: AgentMessage): string {
    return JSON.stringify({
      ...message,
      timestamp: message.timestamp.toISOString(),
    });
  }

  private deserializeMessage(raw: string): AgentMessage {
    const parsed = JSON.parse(raw) as AgentMessage & { timestamp: string };
    return {
      ...parsed,
      timestamp: new Date(parsed.timestamp),
    };
  }

  /**
   * Send a message from one agent to another.
   */
  async send(
    from: string,
    to: string,
    message: Omit<AgentMessage, "fromRole" | "id" | "timestamp" | "toRole">
  ): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      id: generateId("msg"),
      fromRole: from,
      toRole: to,
      timestamp: new Date(),
    };

    const serialized = this.serializeMessage(fullMessage);

    if (this.redis) {
      try {
        // Extract sessionId from metadata or use a default
        const sessionId = String(fullMessage.metadata?.sessionId ?? "default");
        const key = sessionKey(sessionId, to);

        await this.redis.rpush(key, serialized);
        await this.redis.expire(key, SESSION_TTL_SECONDS);
        await this.redis.publish(directChannel(sessionId, to), serialized);

        logger.debug(
          { from, to, type: message.type },
          "Message sent via Redis"
        );
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ error: msg }, "Redis send failed, using fallback");
      }
    }

    // Fallback: in-memory store
    const key = `${to}:default`;
    const existing = this.fallbackStore.get(key) ?? [];
    existing.push(fullMessage);
    this.fallbackStore.set(key, existing);

    logger.debug({ from, to, type: message.type }, "Message sent via fallback");
  }

  /**
   * Broadcast a message to all agents in a session.
   */
  async broadcast(
    from: string,
    message: Omit<AgentMessage, "fromRole" | "id" | "timestamp" | "toRole">
  ): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      id: generateId("msg"),
      fromRole: from,
      toRole: "all",
      timestamp: new Date(),
    };

    const serialized = this.serializeMessage(fullMessage);
    const sessionId = String(fullMessage.metadata?.sessionId ?? "default");

    if (this.redis) {
      try {
        const key = sessionKey(sessionId, "all");
        await this.redis.rpush(key, serialized);
        await this.redis.expire(key, SESSION_TTL_SECONDS);
        await this.redis.publish(broadcastChannel(sessionId), serialized);

        logger.debug({ from, type: message.type }, "Broadcast sent via Redis");
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ error: msg }, "Redis broadcast failed, using fallback");
      }
    }

    // Fallback: store under "all" key
    const key = `all:${sessionId}`;
    const existing = this.fallbackStore.get(key) ?? [];
    existing.push(fullMessage);
    this.fallbackStore.set(key, existing);

    logger.debug({ from, type: message.type }, "Broadcast sent via fallback");
  }

  /**
   * Get all messages for an agent in a session.
   * Returns both direct messages and broadcasts.
   */
  async getMessages(
    agentRole: string,
    sessionId: string
  ): Promise<AgentMessage[]> {
    if (this.redis) {
      try {
        const directKey = sessionKey(sessionId, agentRole);
        const broadcastKey = sessionKey(sessionId, "all");

        const [directMessages, broadcastMessages] = await Promise.all([
          this.redis.lrange(directKey, 0, -1),
          this.redis.lrange(broadcastKey, 0, -1),
        ]);

        const all = [
          ...directMessages.map((m) => this.deserializeMessage(m)),
          ...broadcastMessages.map((m) => this.deserializeMessage(m)),
        ];

        // Sort by timestamp
        all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        return all;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ error: msg }, "Redis getMessages failed, using fallback");
      }
    }

    // Fallback
    const directMessages =
      this.fallbackStore.get(`${agentRole}:${sessionId}`) ?? [];
    const broadcastMessages = this.fallbackStore.get(`all:${sessionId}`) ?? [];

    const all = [...directMessages, ...broadcastMessages];
    all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return all;
  }

  /**
   * Clear all messages for a session.
   */
  async clearSession(sessionId: string): Promise<void> {
    if (this.redis) {
      try {
        const pattern = `agent-bus:${sessionId}:*`;
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          for (const key of keys) {
            await this.redis.del(key);
          }
        }
        logger.debug({ sessionId }, "Session cleared in Redis");
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { error: msg },
          "Redis clearSession failed, using fallback"
        );
      }
    }

    // Fallback: remove all keys matching the session
    for (const key of this.fallbackStore.keys()) {
      if (key.endsWith(`:${sessionId}`)) {
        this.fallbackStore.delete(key);
      }
    }

    logger.debug({ sessionId }, "Session cleared in fallback store");
  }
}

/** Singleton agent bus instance */
export const agentBus = new AgentBus();
