import { createLogger } from "@prometheus/logger";
import type { createRedisConnection } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";

type RedisClient = ReturnType<typeof createRedisConnection>;

const logger = createLogger("orchestrator:agent-bus");

const MESSAGE_TTL = 3600;

export interface AgentBusMessage {
  fromAgentId: string;
  fromRole: string;
  id: string;
  payload: unknown;
  sessionId: string;
  timestamp: number;
  type:
    | "discovery"
    | "conflict"
    | "request"
    | "vote"
    | "file_claim"
    | "decision"
    | "completion";
}

export class AgentBus {
  private readonly sessionId: string;
  private readonly agentId: string;
  private readonly agentRole: string;
  private readonly channel: string;
  private readonly dedupKey: string;
  private readonly messagesKey: string;
  private readonly claimsKey: string;
  private subscriber: RedisClient | null = null;
  private handler: ((msg: AgentBusMessage) => void) | null = null;

  constructor(sessionId: string, agentId: string, agentRole: string) {
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.agentRole = agentRole;
    this.channel = `fleet:bus:${sessionId}`;
    this.dedupKey = `fleet:bus:${sessionId}:seen`;
    this.messagesKey = `fleet:bus:${sessionId}:messages`;
    this.claimsKey = `fleet:bus:${sessionId}:claims`;
  }

  async publish(
    type: AgentBusMessage["type"],
    payload: unknown
  ): Promise<void> {
    const { redis } = await import("@prometheus/queue");

    const msg: AgentBusMessage = {
      id: generateId("msg"),
      sessionId: this.sessionId,
      fromAgentId: this.agentId,
      fromRole: this.agentRole,
      type,
      payload,
      timestamp: Date.now(),
    };

    const serialized = JSON.stringify(msg);

    const pipeline = redis.pipeline();
    pipeline.sadd(this.dedupKey, msg.id);
    pipeline.expire(this.dedupKey, MESSAGE_TTL);
    pipeline.rpush(this.messagesKey, serialized);
    pipeline.expire(this.messagesKey, MESSAGE_TTL);
    pipeline.publish(this.channel, serialized);
    await pipeline.exec();

    logger.debug(
      { messageId: msg.id, type, agentId: this.agentId },
      "Message published"
    );
  }

  async subscribe(handler: (msg: AgentBusMessage) => void): Promise<void> {
    const { createRedisConnection } = await import("@prometheus/queue");
    this.subscriber = createRedisConnection();
    this.handler = handler;

    this.subscriber.on("message", (_channel: string, raw: string) => {
      try {
        const msg = JSON.parse(raw) as AgentBusMessage;

        if (msg.fromAgentId === this.agentId) {
          return;
        }

        this.handler?.(msg);
      } catch (err) {
        logger.error({ err }, "Failed to parse bus message");
      }
    });

    await this.subscriber.subscribe(this.channel);

    logger.debug(
      { agentId: this.agentId, channel: this.channel },
      "Subscribed to agent bus"
    );
  }

  async unsubscribe(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.channel);
      this.subscriber.disconnect();
      this.subscriber = null;
      this.handler = null;

      logger.debug(
        { agentId: this.agentId, channel: this.channel },
        "Unsubscribed from agent bus"
      );
    }
  }

  async drainMessages(): Promise<AgentBusMessage[]> {
    const { redis } = await import("@prometheus/queue");

    const raw = await redis.lrange(this.messagesKey, 0, -1);
    await redis.del(this.messagesKey);

    const messages: AgentBusMessage[] = [];
    const seenIds = new Set<string>();

    for (const entry of raw) {
      try {
        const msg = JSON.parse(entry) as AgentBusMessage;

        if (seenIds.has(msg.id)) {
          continue;
        }
        seenIds.add(msg.id);

        messages.push(msg);
      } catch (err) {
        logger.error({ err }, "Failed to parse stored message");
      }
    }

    logger.debug(
      { agentId: this.agentId, count: messages.length },
      "Drained messages"
    );

    return messages;
  }

  async claimFile(filePath: string): Promise<boolean> {
    const { redis } = await import("@prometheus/queue");

    const claimed = await redis.hsetnx(this.claimsKey, filePath, this.agentId);
    await redis.expire(this.claimsKey, MESSAGE_TTL);

    if (claimed === 1) {
      await this.publish("file_claim", { filePath, agentId: this.agentId });
      logger.debug(
        { agentId: this.agentId, filePath },
        "File claimed successfully"
      );
      return true;
    }

    const owner = await redis.hget(this.claimsKey, filePath);
    logger.debug(
      { agentId: this.agentId, filePath, owner },
      "File already claimed"
    );
    return false;
  }

  async getFileClaims(): Promise<Record<string, string>> {
    const { redis } = await import("@prometheus/queue");
    const claims = await redis.hgetall(this.claimsKey);
    return claims;
  }

  async publishDecision(decision: string, context: unknown): Promise<void> {
    await this.publish("decision", { decision, context });
  }

  async publishCompletion(
    summary: string,
    filesChanged: string[]
  ): Promise<void> {
    await this.publish("completion", { summary, filesChanged });
  }

  async destroy(): Promise<void> {
    await this.unsubscribe();

    const { redis } = await import("@prometheus/queue");
    const pipeline = redis.pipeline();
    pipeline.del(this.dedupKey);
    pipeline.del(this.messagesKey);
    pipeline.del(this.claimsKey);
    await pipeline.exec();

    logger.debug(
      { agentId: this.agentId, sessionId: this.sessionId },
      "Agent bus destroyed"
    );
  }
}
