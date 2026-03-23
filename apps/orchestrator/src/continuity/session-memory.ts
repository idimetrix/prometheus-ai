import { createLogger } from "@prometheus/logger";
import { projectBrainClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:continuity");

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
      const response = await projectBrainClient.post<{ loadedCount: number }>(
        `/sessions/${sessionId}/load-prior`,
        { projectId }
      );

      // Also fetch recent episodic memories for context
      let context = "";
      try {
        const memResponse = await projectBrainClient.get<{
          memories: Array<{ decision: string; outcome?: string }>;
        }>(`/memory/${projectId}?type=episodic&limit=10`, { timeout: 5000 });

        if (memResponse.data.memories.length > 0) {
          context = memResponse.data.memories
            .map((m) => `- ${m.decision}${m.outcome ? ` (${m.outcome})` : ""}`)
            .join("\n");
        }
      } catch {
        // Non-critical: episodic memory fetch failure
      }

      return {
        loaded: response.data.loadedCount > 0,
        priorSessions: response.data.loadedCount,
        context,
      };
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

      await projectBrainClient.post(`/sessions/${summary.sessionId}/persist`, {
        projectId: summary.projectId,
        summary: summaryText,
      });
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
      const response = await projectBrainClient.get<{
        memories: Array<{ decision: string }>;
      }>(
        `/memory/${projectId}?type=episodic&query=${encodeURIComponent(query)}&limit=${limit}`,
        { timeout: 5000 }
      );
      return response.data.memories.map((m) => m.decision);
    } catch {
      // Silent failure for non-critical feature
    }

    return [];
  }
}
