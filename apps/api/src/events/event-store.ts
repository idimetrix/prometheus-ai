import { db, workflowEvents } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, desc, eq, gt } from "drizzle-orm";

const logger = createLogger("api:event-store");

export interface StoredEvent {
  data: Record<string, unknown>;
  id: string;
  sessionId: string;
  stepName: string;
  timestamp: string;
  type: string;
  workflowId: string;
}

let sequenceCounter = 0;

function nextSequence(): number {
  return ++sequenceCounter;
}

export async function appendEvent(
  sessionId: string,
  workflowId: string,
  stepName: string,
  type: "start" | "complete" | "fail" | "retry" | "skip",
  data: Record<string, unknown>
): Promise<StoredEvent> {
  const id = generateId("evt");
  const seq = nextSequence();
  const enrichedData = { ...data, sequence: seq };

  try {
    await db.insert(workflowEvents).values({
      id,
      sessionId,
      workflowId,
      stepName,
      eventType: type,
      data: enrichedData,
      createdAt: new Date(),
    });
  } catch (error) {
    logger.error(
      { sessionId, type, error: String(error) },
      "Failed to persist event"
    );
  }

  return {
    id,
    sessionId,
    workflowId,
    stepName,
    type,
    data: enrichedData,
    timestamp: new Date().toISOString(),
  };
}

export async function replayEvents(
  sessionId: string,
  afterTimestamp?: string,
  limit = 1000
): Promise<StoredEvent[]> {
  try {
    const conditions = [eq(workflowEvents.sessionId, sessionId)];
    if (afterTimestamp) {
      conditions.push(gt(workflowEvents.createdAt, new Date(afterTimestamp)));
    }

    const rows = await db
      .select()
      .from(workflowEvents)
      .where(and(...conditions))
      .orderBy(workflowEvents.createdAt)
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      workflowId: row.workflowId,
      stepName: row.stepName,
      type: row.eventType,
      data: (row.data as Record<string, unknown>) ?? {},
      timestamp: row.createdAt.toISOString(),
    }));
  } catch (error) {
    logger.error(
      { sessionId, error: String(error) },
      "Failed to replay events"
    );
    return [];
  }
}

export async function getLatestTimestamp(
  sessionId: string
): Promise<string | null> {
  try {
    const rows = await db
      .select({ createdAt: workflowEvents.createdAt })
      .from(workflowEvents)
      .where(eq(workflowEvents.sessionId, sessionId))
      .orderBy(desc(workflowEvents.createdAt))
      .limit(1);

    const first = rows[0];
    return first ? first.createdAt.toISOString() : null;
  } catch {
    return null;
  }
}
