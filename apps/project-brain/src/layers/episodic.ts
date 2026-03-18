import { db, episodicMemories } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, desc, eq, ilike, or } from "drizzle-orm";

const logger = createLogger("project-brain:episodic");

export interface EpisodicMemory {
  createdAt: Date;
  decision: string;
  eventType: string;
  id: string;
  outcome: string | null;
  projectId: string;
  reasoning: string | null;
}

export class EpisodicLayer {
  async store(
    projectId: string,
    data: {
      eventType: string;
      decision: string;
      reasoning?: string;
      outcome?: string;
    }
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

    logger.debug(
      { projectId, eventType: data.eventType, id },
      "Episodic memory stored"
    );

    const record = inserted as NonNullable<typeof inserted>;
    return {
      id: record.id,
      projectId: record.projectId,
      eventType: record.eventType,
      decision: record.decision,
      reasoning: record.reasoning,
      outcome: record.outcome,
      createdAt: record.createdAt,
    };
  }

  async recall(
    projectId: string,
    query: string,
    limit = 5
  ): Promise<EpisodicMemory[]> {
    const results = await db
      .select()
      .from(episodicMemories)
      .where(
        and(
          eq(episodicMemories.projectId, projectId),
          or(
            ilike(episodicMemories.decision, `%${query}%`),
            ilike(episodicMemories.reasoning, `%${query}%`)
          )
        )
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

  async getRecent(projectId: string, limit = 10): Promise<EpisodicMemory[]> {
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
