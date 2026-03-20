import { createLogger } from "@prometheus/logger";
import type { createRedisConnection } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";

type RedisClient = ReturnType<typeof createRedisConnection>;

const logger = createLogger("orchestrator:agent-bus");

const MESSAGE_TTL = 3600;

/** Stream-based message group for Redis Streams */
const STREAM_GROUP = "agent-bus-consumers";

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
    | "completion"
    | "file_changed"
    | "type_export_needed"
    | "tests_passing"
    | "tests_failing"
    | "status_update";
}

/**
 * AgentBus provides inter-agent communication via Redis Streams.
 *
 * Supports both pub/sub (real-time notifications) and Redis Streams
 * (durable, ordered message log) for agent-to-agent messaging.
 *
 * Message types:
 * - "file_changed": Agent modified a file, others should be aware
 * - "type_export_needed": Agent needs a type exported from another module
 * - "tests_passing": Test suite status update
 * - "tests_failing": Test suite failure notification
 * - "status_update": General agent status update
 */
export class AgentBus {
  private readonly sessionId: string;
  private readonly agentId: string;
  private readonly agentRole: string;
  private readonly channel: string;
  private readonly dedupKey: string;
  private readonly messagesKey: string;
  private readonly claimsKey: string;
  private readonly streamKey: string;
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
    this.streamKey = `fleet:stream:${sessionId}`;
  }

  /**
   * Publish a message to both pub/sub and the Redis Stream.
   */
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
    // Pub/sub for real-time notifications
    pipeline.sadd(this.dedupKey, msg.id);
    pipeline.expire(this.dedupKey, MESSAGE_TTL);
    pipeline.rpush(this.messagesKey, serialized);
    pipeline.expire(this.messagesKey, MESSAGE_TTL);
    pipeline.publish(this.channel, serialized);
    // Redis Streams for durable message log
    pipeline.xadd(this.streamKey, "*", "data", serialized);
    pipeline.expire(this.streamKey, MESSAGE_TTL);
    await pipeline.exec();

    logger.debug(
      { messageId: msg.id, type, agentId: this.agentId },
      "Message published to bus and stream"
    );
  }

  /**
   * Subscribe to real-time pub/sub messages.
   */
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

  /**
   * Read messages from the Redis Stream (durable, ordered).
   * Uses consumer groups for load balancing across agents.
   */
  async readStream(count = 10): Promise<AgentBusMessage[]> {
    const { redis } = await import("@prometheus/queue");

    // Ensure consumer group exists
    try {
      await redis.xgroup(
        "CREATE",
        this.streamKey,
        STREAM_GROUP,
        "0",
        "MKSTREAM"
      );
    } catch {
      // Group may already exist, ignore
    }

    const results = await redis.xreadgroup(
      "GROUP",
      STREAM_GROUP,
      this.agentId,
      "COUNT",
      count,
      "STREAMS",
      this.streamKey,
      ">"
    );

    if (!results) {
      return [];
    }

    const messages: AgentBusMessage[] = [];
    for (const [, entries] of results as [string, [string, string[]][]][]) {
      for (const [, fields] of entries) {
        try {
          const dataIdx = fields.indexOf("data");
          const dataValue = dataIdx >= 0 ? fields[dataIdx + 1] : undefined;
          if (dataValue) {
            const msg = JSON.parse(dataValue) as AgentBusMessage;
            if (msg.fromAgentId !== this.agentId) {
              messages.push(msg);
            }
          }
        } catch (err) {
          logger.error({ err }, "Failed to parse stream message");
        }
      }
    }

    return messages;
  }

  /**
   * Drain all messages from the legacy list-based store.
   */
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

  /** Notify other agents that a file was changed */
  async publishFileChanged(
    filePath: string,
    changeType: "created" | "modified" | "deleted"
  ): Promise<void> {
    await this.publish("file_changed", {
      filePath,
      changeType,
      agentId: this.agentId,
    });
  }

  /** Request a type export from another agent's module */
  async publishTypeExportNeeded(
    typeName: string,
    sourceModule: string
  ): Promise<void> {
    await this.publish("type_export_needed", {
      typeName,
      sourceModule,
      requestedBy: this.agentId,
    });
  }

  /** Publish test suite status */
  async publishTestStatus(
    passed: boolean,
    details?: { testsRun: number; testsFailed: number }
  ): Promise<void> {
    const type = passed ? "tests_passing" : "tests_failing";
    await this.publish(type, {
      passed,
      ...details,
      agentId: this.agentId,
    });
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
    pipeline.del(this.streamKey);
    await pipeline.exec();

    logger.debug(
      { agentId: this.agentId, sessionId: this.sessionId },
      "Agent bus destroyed"
    );
  }
}
