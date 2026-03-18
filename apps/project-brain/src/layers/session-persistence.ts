import { createLogger } from "@prometheus/logger";
import type { EpisodicLayer } from "./episodic";
import type { WorkingMemoryLayer } from "./working-memory";

const logger = createLogger("project-brain:session-persistence");

const SESSION_MEMORY_KEY_RE = /^\[(\w+)\]\s*/;
const SESSION_MEMORY_KEY_STRIP_RE = /^\[\w+\]\s*/;

/** Keys in working memory that should persist across sessions */
const PERSISTENT_KEYS = [
  "current_task",
  "architecture_decisions",
  "discovered_conventions",
  "known_issues",
  "user_preferences",
  "file_ownership",
  "recent_changes_summary",
];

/**
 * SessionPersistence handles saving important working memory to episodic
 * memory at session end, and pre-loading relevant context at session start.
 */
export class SessionPersistence {
  constructor(
    private readonly workingMemory: WorkingMemoryLayer,
    private readonly episodic: EpisodicLayer
  ) {}

  /**
   * Save important working memory entries as episodic memories at session end.
   */
  async onSessionEnd(
    sessionId: string,
    projectId: string,
    summary?: string
  ): Promise<{ savedCount: number }> {
    logger.info({ sessionId, projectId }, "Persisting session memory");

    const allMemory = await this.workingMemory.getAll(sessionId);
    let savedCount = 0;

    // Save persistent keys as episodic memories
    for (const key of PERSISTENT_KEYS) {
      const value = allMemory[key];
      if (value != null) {
        const content =
          typeof value === "string" ? value : JSON.stringify(value);
        await this.episodic.store(projectId, {
          eventType: "session_memory",
          decision: `[${key}] ${content.slice(0, 500)}`,
          reasoning: `Persisted from session ${sessionId}`,
          outcome: "preserved",
        });
        savedCount++;
      }
    }

    // Store session summary if provided
    if (summary) {
      await this.episodic.store(projectId, {
        eventType: "session_summary",
        decision: summary,
        reasoning: `Summary of session ${sessionId}`,
        outcome: "completed",
      });
      savedCount++;
    }

    // Clear the working memory for this session
    await this.workingMemory.clearSession(sessionId);

    logger.info(
      { sessionId, projectId, savedCount },
      "Session memory persisted"
    );
    return { savedCount };
  }

  /**
   * Pre-populate working memory from prior session context.
   */
  async onSessionStart(
    sessionId: string,
    projectId: string
  ): Promise<{ loadedCount: number }> {
    logger.info({ sessionId, projectId }, "Loading prior session context");

    // Load recent episodic memories from past sessions
    const recentDecisions = await this.episodic.getRecent(projectId, 20);
    let loadedCount = 0;

    // Find session_memory entries and restore them
    const sessionMemories = recentDecisions.filter(
      (d) => d.eventType === "session_memory"
    );

    for (const memory of sessionMemories.slice(0, 10)) {
      // Extract key from the decision format: [key] value
      const keyMatch = memory.decision.match(SESSION_MEMORY_KEY_RE);
      if (keyMatch?.[1]) {
        const key = keyMatch[1];
        const value = memory.decision.replace(SESSION_MEMORY_KEY_STRIP_RE, "");
        await this.workingMemory.set(sessionId, `prior_${key}`, value, 7200); // 2h TTL
        loadedCount++;
      }
    }

    // Load latest session summary
    const summaries = recentDecisions.filter(
      (d) => d.eventType === "session_summary"
    );
    if (summaries.length > 0) {
      await this.workingMemory.set(
        sessionId,
        "prior_session_summary",
        summaries[0]?.decision ?? "",
        7200
      );
      loadedCount++;
    }

    logger.info(
      { sessionId, projectId, loadedCount },
      "Prior session context loaded"
    );
    return { loadedCount };
  }

  /**
   * Generate a summary of the current session for persistence.
   */
  async generateSessionSummary(
    sessionId: string,
    projectId: string
  ): Promise<string> {
    const allMemory = await this.workingMemory.getAll(sessionId);
    const recentDecisions = await this.episodic.getRecent(projectId, 5);

    const parts: string[] = [];

    // Working memory state
    const memKeys = Object.keys(allMemory);
    if (memKeys.length > 0) {
      parts.push(
        `Working memory: ${memKeys.length} entries (${memKeys.join(", ")})`
      );
    }

    // Recent decisions
    if (recentDecisions.length > 0) {
      parts.push(
        `Recent decisions: ${recentDecisions.map((d) => d.decision.slice(0, 100)).join("; ")}`
      );
    }

    return parts.join("\n") || "No significant session activity recorded.";
  }
}
