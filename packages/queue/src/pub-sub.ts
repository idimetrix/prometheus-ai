import type IORedis from "ioredis";
import { createRedisConnection } from "./connection";

export interface SessionEvent {
  type: string;
  data: Record<string, unknown>;
  agentRole?: string;
  timestamp: string;
}

export class EventPublisher {
  private readonly redis: IORedis;

  constructor(redis?: IORedis) {
    this.redis = redis ?? createRedisConnection();
  }

  async publishSessionEvent(sessionId: string, event: SessionEvent): Promise<void> {
    const channel = `session:${sessionId}:events`;
    await this.redis.publish(channel, JSON.stringify(event));
  }

  async publishFleetEvent(orgId: string, event: SessionEvent): Promise<void> {
    await this.redis.publish("fleet:events", JSON.stringify({ ...event, orgId }));
  }

  async publishNotification(userId: string, notification: {
    type: string;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const channel = `user:${userId}:notifications`;
    await this.redis.publish(channel, JSON.stringify({
      ...notification,
      timestamp: new Date().toISOString(),
    }));
  }

  async publishQueuePosition(sessionId: string, position: {
    taskId: string;
    position: number;
    estimatedWaitSeconds: number;
    totalInQueue: number;
  }): Promise<void> {
    await this.publishSessionEvent(sessionId, {
      type: "queue_position",
      data: position,
      timestamp: new Date().toISOString(),
    });
  }
}
