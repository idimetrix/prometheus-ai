import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:episodic");

export interface EpisodicMemory {
  id: string;
  projectId: string;
  eventType: string;
  decision: string;
  reasoning: string;
  outcome: string | null;
  createdAt: Date;
}

export class EpisodicLayer {
  // In-memory store (TODO: persist to episodic_memories table via Mem0)
  private memories = new Map<string, EpisodicMemory[]>();

  async store(projectId: string, data: {
    eventType: string;
    decision: string;
    reasoning: string;
    outcome?: string;
  }): Promise<void> {
    if (!this.memories.has(projectId)) {
      this.memories.set(projectId, []);
    }

    const memory: EpisodicMemory = {
      id: `ep_${Date.now()}`,
      projectId,
      eventType: data.eventType,
      decision: data.decision,
      reasoning: data.reasoning,
      outcome: data.outcome ?? null,
      createdAt: new Date(),
    };

    this.memories.get(projectId)!.push(memory);
    logger.debug({ projectId, eventType: data.eventType }, "Episodic memory stored");
  }

  async recall(projectId: string, query: string, limit: number = 5): Promise<EpisodicMemory[]> {
    const projectMemories = this.memories.get(projectId) ?? [];
    // Simple text matching (TODO: semantic search via embeddings)
    return projectMemories
      .filter((m) =>
        m.decision.toLowerCase().includes(query.toLowerCase()) ||
        m.reasoning.toLowerCase().includes(query.toLowerCase())
      )
      .slice(-limit);
  }

  async getRecent(projectId: string, limit: number = 10): Promise<EpisodicMemory[]> {
    const projectMemories = this.memories.get(projectId) ?? [];
    return projectMemories.slice(-limit);
  }
}
