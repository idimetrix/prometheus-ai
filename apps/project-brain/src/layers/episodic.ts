import { db } from "@prometheus/db";
import { episodicMemories } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { createLogger } from "@prometheus/logger";
import { eq, and, or, ilike, desc } from "drizzle-orm";

const logger = createLogger("project-brain:episodic");

export interface EpisodicMemory {
  id: string;
  projectId: string;
  eventType: string;
  decision: string;
  reasoning: string | null;
  outcome: string | null;
  createdAt: Date;
}

export class EpisodicLayer {
  async store(
    projectId: string,
    data: {
      eventType: string;
      decision: string;
      reasoning?: string;
      outcome?: string;
    },
  ): Promise<EpisodicMemory> {
    const id = generateId("ep");

    const [inserted] = await db
      .insert(episodicMemories)
      .values({
        id,
        projectId,
        eventType: data.eventType,
        decision: data.decision,
        reasoning: data.reasoning ?? null,
        outcome: data.outcome ?? null,
      })
      .returning();

    logger.debug({ projectId, eventType: data.eventType, id }, "Episodic memory stored");

    return {
      id: inserted!.id,
      projectId: inserted!.projectId,
      eventType: inserted!.eventType,
      decision: inserted!.decision,
      reasoning: inserted!.reasoning,
      outcome: inserted!.outcome,
      createdAt: inserted!.createdAt,
    };
  }

  async recall(projectId: string, query: string, limit: number = 5): Promise<EpisodicMemory[]> {
    const results = await db
      .select()
      .from(episodicMemories)
      .where(
        and(
          eq(episodicMemories.projectId, projectId),
          or(
            ilike(episodicMemories.decision, `%${query}%`),
            ilike(episodicMemories.reasoning, `%${query}%`),
          ),
        ),
      )
      .orderBy(desc(episodicMemories.createdAt))
      .limit(limit);

    return results.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      eventType: r.eventType,
      decision: r.decision,
      reasoning: r.reasoning,
      outcome: r.outcome,
      createdAt: r.createdAt,
    }));
  }

  async getRecent(projectId: string, limit: number = 10): Promise<EpisodicMemory[]> {
    const results = await db
      .select()
      .from(episodicMemories)
      .where(eq(episodicMemories.projectId, projectId))
      .orderBy(desc(episodicMemories.createdAt))
      .limit(limit);

    return results.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      eventType: r.eventType,
      decision: r.decision,
      reasoning: r.reasoning,
      outcome: r.outcome,
      createdAt: r.createdAt,
    }));
  }
}
