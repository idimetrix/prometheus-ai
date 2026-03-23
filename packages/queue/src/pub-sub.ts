import type IORedis from "ioredis";
import { createRedisConnection } from "./connection";

export interface SessionEvent {
  agentRole?: string;
  data: Record<string, unknown>;
  timestamp: string;
  type: string;
}

export class EventPublisher {
  private readonly redis: IORedis;

  constructor(redis?: IORedis) {
    this.redis = redis ?? createRedisConnection();
  }

  /**
   * Publish a session event with a monotonic sequence number.
   * Also appends to Redis Streams for replay on reconnection.
   */
  async publishSessionEvent(
    sessionId: string,
    event: SessionEvent
  ): Promise<void> {
    // Assign monotonic sequence number per session
    const seqKey = `session:seq:${sessionId}`;
    const sequence = await this.redis.incr(seqKey);

    const enrichedEvent = { ...event, sequence };
    const channel = `session:${sessionId}:events`;

    // Publish to pub/sub for live subscribers
    await this.redis.publish(channel, JSON.stringify(enrichedEvent));

    // Also append to Redis Stream for replay on reconnection
    const streamKey = `session:${sessionId}:stream`;
    await this.redis
      .xadd(
        streamKey,
        "MAXLEN",
        "~",
        "1000",
        "*",
        "event",
        JSON.stringify(enrichedEvent)
      )
      .catch(() => {
        // Best-effort stream append — pub/sub is primary
      });
  }

  async publishFleetEvent(orgId: string, event: SessionEvent): Promise<void> {
    await this.redis.publish(
      "fleet:events",
      JSON.stringify({ ...event, orgId })
    );
  }

  async publishNotification(
    userId: string,
    notification: {
      type: string;
      title: string;
      message: string;
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    const channel = `user:${userId}:notifications`;
    await this.redis.publish(
      channel,
      JSON.stringify({
        ...notification,
        timestamp: new Date().toISOString(),
      })
    );
  }

  async publishQueuePosition(
    sessionId: string,
    position: {
      taskId: string;
      position: number;
      estimatedWaitSeconds: number;
      totalInQueue: number;
    }
  ): Promise<void> {
    await this.publishSessionEvent(sessionId, {
      type: "queue_position",
      data: position,
      timestamp: new Date().toISOString(),
    });
  }
}
