import { createLogger } from "@prometheus/logger";
import { EpisodicLayer } from "../layers/episodic";
import { Mem0Client } from "./mem0-client";

const logger = createLogger("project-brain:mem0-sync");

/**
 * Syncs episodic memories from the local database to Mem0
 * and retrieves user preferences from Mem0's semantic search.
 */
export class Mem0Sync {
  private readonly mem0: Mem0Client;
  private readonly episodic: EpisodicLayer;

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
}
