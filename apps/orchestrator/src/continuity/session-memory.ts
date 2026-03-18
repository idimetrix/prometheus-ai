import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:continuity");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

export interface SessionSummary {
  blockers: string[];
  creditsConsumed: number;
  decisions: string[];
  duration: number;
  filesChanged: string[];
  outcome: "completed" | "failed" | "cancelled";
  projectId: string;
  sessionId: string;
}

/**
 * SessionMemory handles loading previous session context at session start
 * and saving session summaries at session end for cross-session continuity.
 */
export class SessionMemory {
  /**
   * Load context from previous sessions for this project.
   */
  async loadPriorContext(
    sessionId: string,
    projectId: string
  ): Promise<{
    loaded: boolean;
    priorSessions: number;
    context: string;
  }> {
    logger.info({ sessionId, projectId }, "Loading prior session context");

    try {
      const response = await fetch(
        `${PROJECT_BRAIN_URL}/sessions/${sessionId}/load-prior`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (response.ok) {
        const data = (await response.json()) as { loadedCount: number };

        // Also fetch recent episodic memories for context
        const memResponse = await fetch(
          `${PROJECT_BRAIN_URL}/memory/${projectId}?type=episodic&limit=10`,
          { signal: AbortSignal.timeout(5000) }
        );

        let context = "";
        if (memResponse.ok) {
          const memData = (await memResponse.json()) as {
            memories: Array<{ decision: string; outcome?: string }>;
          };
          if (memData.memories.length > 0) {
            context = memData.memories
              .map(
                (m) => `- ${m.decision}${m.outcome ? ` (${m.outcome})` : ""}`
              )
              .join("\n");
          }
        }

        return {
          loaded: data.loadedCount > 0,
          priorSessions: data.loadedCount,
          context,
        };
      }
    } catch (err) {
      logger.warn({ err }, "Failed to load prior session context");
    }

    return { loaded: false, priorSessions: 0, context: "" };
  }

  /**
   * Save session summary for future reference.
   */
  async saveSessionSummary(summary: SessionSummary): Promise<void> {
    logger.info(
      { sessionId: summary.sessionId, outcome: summary.outcome },
      "Saving session summary"
    );

    try {
      const summaryText = [
        `Session ${summary.sessionId}: ${summary.outcome}`,
        `Files changed: ${summary.filesChanged.length}`,
        `Credits: ${summary.creditsConsumed}`,
        summary.decisions.length > 0
          ? `Key decisions: ${summary.decisions.slice(0, 5).join("; ")}`
          : null,
        summary.blockers.length > 0
          ? `Blockers: ${summary.blockers.join("; ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      await fetch(
        `${PROJECT_BRAIN_URL}/sessions/${summary.sessionId}/persist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: summary.projectId,
            summary: summaryText,
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
    } catch (err) {
      logger.warn({ err }, "Failed to save session summary");
    }
  }

  /**
   * Search past decisions via semantic search.
   */
  async searchDecisions(
    projectId: string,
    query: string,
    limit = 5
  ): Promise<string[]> {
    try {
      const response = await fetch(
        `${PROJECT_BRAIN_URL}/memory/${projectId}?type=episodic&query=${encodeURIComponent(query)}&limit=${limit}`,
        {
          signal: AbortSignal.timeout(5000),
        }
      );

      if (response.ok) {
        const data = (await response.json()) as {
          memories: Array<{ decision: string }>;
        };
        return data.memories.map((m) => m.decision);
      }
    } catch {
      // Silent failure for non-critical feature
    }

    return [];
  }
}
