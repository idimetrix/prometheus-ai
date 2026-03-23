/**
 * Phase 12: Redis Streams abstraction for event replay on reconnection.
 *
 * Uses XADD with MAXLEN for bounded streams and XRANGE for gap-fill.
 * Each session gets its own stream: `session:{id}:stream`.
 */
import type IORedis from "ioredis";
import { createRedisConnection } from "./connection";

export interface StreamEvent {
  agentRole?: string;
  data: Record<string, unknown>;
  id?: string;
  sequence?: number;
  timestamp: string;
  type: string;
}

const DEFAULT_MAX_LEN = 1000;
const SEQUENCE_KEY_PREFIX = "session:seq:";

export class EventStream {
  private readonly redis: IORedis;
  private readonly maxLen: number;

  constructor(redis?: IORedis, maxLen = DEFAULT_MAX_LEN) {
    this.redis = redis ?? createRedisConnection();
    this.maxLen = maxLen;
  }

  /**
   * Append an event to the session stream.
   * Returns the Redis stream entry ID.
   */
  async append(sessionId: string, event: StreamEvent): Promise<string> {
    const streamKey = `session:${sessionId}:stream`;
    const seqKey = `${SEQUENCE_KEY_PREFIX}${sessionId}`;

    // Atomically increment sequence counter
    const sequence = await this.redis.incr(seqKey);

    const enrichedEvent = {
      ...event,
      sequence,
    };

    // XADD with approximate MAXLEN trimming
    const entryId = await this.redis.xadd(
      streamKey,
      "MAXLEN",
      "~",
      String(this.maxLen),
      "*",
      "event",
      JSON.stringify(enrichedEvent)
    );

    return entryId ?? "";
  }

  /**
   * Read events from a session stream starting after `lastEventId`.
   * Used for gap-fill on reconnection.
   */
  async readAfter(
    sessionId: string,
    lastEventId: string,
    count = 100
  ): Promise<StreamEvent[]> {
    const streamKey = `session:${sessionId}:stream`;

    const results = await this.redis.xrange(
      streamKey,
      lastEventId === "0" ? "-" : `(${lastEventId}`,
      "+",
      "COUNT",
      String(count)
    );

    if (!results || results.length === 0) {
      return [];
    }

    return results.map(([id, fields]) => {
      const eventJson = fields?.[1] ?? "{}";
      const event = JSON.parse(eventJson) as StreamEvent;
      return { ...event, id };
    });
  }

  /**
   * Read events within a time range.
   */
  async readRange(
    sessionId: string,
    startId = "-",
    endId = "+",
    count = 100
  ): Promise<StreamEvent[]> {
    const streamKey = `session:${sessionId}:stream`;

    const results = await this.redis.xrange(
      streamKey,
      startId,
      endId,
      "COUNT",
      String(count)
    );

    if (!results || results.length === 0) {
      return [];
    }

    return results.map(([id, fields]) => {
      const eventJson = fields?.[1] ?? "{}";
      const event = JSON.parse(eventJson) as StreamEvent;
      return { ...event, id };
    });
  }

  /**
   * Get the current sequence number for a session.
   */
  async getSequence(sessionId: string): Promise<number> {
    const seqKey = `${SEQUENCE_KEY_PREFIX}${sessionId}`;
    const val = await this.redis.get(seqKey);
    return val ? Number.parseInt(val, 10) : 0;
  }

  /**
   * Get the length of the stream.
   */
  async length(sessionId: string): Promise<number> {
    const streamKey = `session:${sessionId}:stream`;
    return await this.redis.xlen(streamKey);
  }

  /**
   * Delete the stream and sequence counter for a session.
   */
  async cleanup(sessionId: string): Promise<void> {
    const streamKey = `session:${sessionId}:stream`;
    const seqKey = `${SEQUENCE_KEY_PREFIX}${sessionId}`;
    await this.redis.del(streamKey, seqKey);
  }
}
