/**
 * Phase 7.19: Enhanced Mem0 Sync with user preference learning.
 *
 * Syncs episodic memories to Mem0 and retrieves user preferences.
 * Enhanced with thumbs up/down feedback for preference learning.
 */
import { createLogger } from "@prometheus/logger";
import { EpisodicLayer } from "../layers/episodic";
import { Mem0Client } from "./mem0-client";

const logger = createLogger("project-brain:mem0-sync");

interface FeedbackRecord {
  memoryId: string;
  thumbsUp: boolean;
  timestamp: number;
}

/**
 * Mem0Sync handles bidirectional sync with Mem0 and
 * user preference learning from thumbs up/down feedback.
 */
export class Mem0Sync {
  private readonly mem0: Mem0Client;
  private readonly episodic: EpisodicLayer;
  private readonly feedbackLog: Map<string, FeedbackRecord[]> = new Map();

  constructor(mem0?: Mem0Client, episodic?: EpisodicLayer) {
    this.mem0 = mem0 ?? new Mem0Client();
    this.episodic = episodic ?? new EpisodicLayer();
  }

  /**
   * Sync recent episodic events for a project to Mem0.
   * Returns the number of memories synced.
   */
  async syncEpisodicToMem0(projectId: string): Promise<number> {
    const recentMemories = await this.episodic.getRecent(projectId, 20);

    if (recentMemories.length === 0) {
      logger.debug({ projectId }, "No recent episodic memories to sync");
      return 0;
    }

    let synced = 0;

    for (const memory of recentMemories) {
      try {
        const text = this.formatMemoryForMem0(memory);
        await this.mem0.addMemory(text, projectId, {
          source: "episodic",
          eventType: memory.eventType,
          episodicId: memory.id,
          projectId: memory.projectId,
        });
        synced++;
      } catch (err) {
        logger.warn(
          { projectId, memoryId: memory.id, err },
          "Failed to sync episodic memory to Mem0"
        );
      }
    }

    logger.info(
      { projectId, synced, total: recentMemories.length },
      "Episodic memories synced to Mem0"
    );

    return synced;
  }

  /**
   * Retrieve user/project preferences from Mem0 via semantic search.
   * Returns a list of relevant preference strings.
   */
  async getPreferences(userId: string, query: string): Promise<string[]> {
    try {
      const memories = await this.mem0.searchMemories(query, userId, 5);
      return memories.map((m) => m.memory);
    } catch (err) {
      logger.warn(
        { userId, query, err },
        "Failed to retrieve preferences from Mem0"
      );
      return [];
    }
  }

  /**
   * Record user feedback (thumbs up/down) for a memory.
   * Used to learn and refine user preferences over time.
   */
  recordFeedback(memoryId: string, thumbsUp: boolean): void {
    const userId = this.getUserIdFromMemory(memoryId);
    const records = this.feedbackLog.get(userId) ?? [];

    records.push({
      memoryId,
      thumbsUp,
      timestamp: Date.now(),
    });

    this.feedbackLog.set(userId, records);

    logger.debug({ memoryId, thumbsUp, userId }, "Memory feedback recorded");
  }

  /**
   * Sync accumulated user preferences from feedback to Mem0.
   * Positive feedback reinforces memories; negative feedback reduces their weight.
   */
  async syncPreferences(userId: string): Promise<number> {
    const records = this.feedbackLog.get(userId);
    if (!records || records.length === 0) {
      return 0;
    }

    let synced = 0;

    // Group feedback by memory
    const feedbackByMemory = new Map<
      string,
      { positive: number; negative: number }
    >();
    for (const record of records) {
      const existing = feedbackByMemory.get(record.memoryId) ?? {
        positive: 0,
        negative: 0,
      };
      if (record.thumbsUp) {
        existing.positive++;
      } else {
        existing.negative++;
      }
      feedbackByMemory.set(record.memoryId, existing);
    }

    // Sync to Mem0 as preference signals
    for (const [memoryId, feedback] of feedbackByMemory) {
      const net = feedback.positive - feedback.negative;
      if (net > 0) {
        try {
          await this.mem0.addMemory(
            `[preference:positive] Memory ${memoryId} was helpful (net score: ${net})`,
            userId,
            { source: "feedback", memoryId, netScore: net }
          );
          synced++;
        } catch (err) {
          logger.warn(
            { userId, memoryId, err },
            "Failed to sync positive preference to Mem0"
          );
        }
      } else if (net < 0) {
        try {
          await this.mem0.addMemory(
            `[preference:negative] Memory ${memoryId} was not helpful (net score: ${net})`,
            userId,
            { source: "feedback", memoryId, netScore: net }
          );
          synced++;
        } catch (err) {
          logger.warn(
            { userId, memoryId, err },
            "Failed to sync negative preference to Mem0"
          );
        }
      }
    }

    // Clear synced records
    this.feedbackLog.delete(userId);

    logger.info(
      { userId, synced, totalRecords: records.length },
      "User preferences synced to Mem0"
    );

    return synced;
  }

  private formatMemoryForMem0(memory: {
    decision: string;
    eventType: string;
    outcome: string | null;
    reasoning: string | null;
  }): string {
    const parts = [`[${memory.eventType}] ${memory.decision}`];

    if (memory.reasoning) {
      parts.push(`Reasoning: ${memory.reasoning}`);
    }
    if (memory.outcome) {
      parts.push(`Outcome: ${memory.outcome}`);
    }

    return parts.join(" | ");
  }

  private getUserIdFromMemory(memoryId: string): string {
    // Extract user context from memory ID prefix
    // In practice this would look up the memory's project/user association
    return memoryId.split("_")[0] ?? "unknown";
  }
}
