import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:decision-logger");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export interface DecisionLogEntry {
  agentRole: string;
  confidence?: number;
  creditsConsumed?: number;
  decision: string;
  filesChanged?: string[];
  outcome?: string;
  projectId: string;
  reasoning?: string;
  sessionId: string;
}

/**
 * DecisionLogger records all agent decisions to the decision_logs table
 * and to the episodic memory layer for cross-session learning.
 */
export class DecisionLogger {
  /**
   * Log a decision after agent execution completes.
   * Fire-and-forget to avoid blocking the agent pipeline.
   */
  logDecision(entry: DecisionLogEntry): Promise<void> {
    const id = generateId("dec");

    // Log to DB via internal API
    this.persistToDb(id, entry).catch((err) => {
      logger.warn({ err, id }, "Failed to persist decision to DB");
    });

    // Also store as episodic memory for cross-session learning
    this.persistToMemory(entry).catch((err) => {
      logger.warn({ err }, "Failed to persist decision to episodic memory");
    });

    logger.debug(
      {
        id,
        agentRole: entry.agentRole,
        decision: entry.decision.slice(0, 100),
        outcome: entry.outcome,
      },
      "Decision logged"
    );

    return Promise.resolve();
  }

  /**
   * Log a tool action (state-modifying tool call).
   */
  async logToolAction(params: {
    projectId: string;
    sessionId: string;
    agentRole: string;
    toolName: string;
    filePath?: string;
    command?: string;
  }): Promise<void> {
    let decision: string;
    if (params.filePath) {
      decision = `Tool: ${params.toolName} on ${params.filePath}`;
    } else if (params.command) {
      decision = `Tool: ${params.toolName} - ${params.command.slice(0, 200)}`;
    } else {
      decision = `Tool: ${params.toolName}`;
    }

    await this.logDecision({
      projectId: params.projectId,
      sessionId: params.sessionId,
      agentRole: params.agentRole,
      decision,
    });
  }

  private async persistToDb(
    id: string,
    entry: DecisionLogEntry
  ): Promise<void> {
    await fetch(`${API_URL}/internal/decision-log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({
        id,
        ...entry,
      }),
      signal: AbortSignal.timeout(5000),
    });
  }

  private async persistToMemory(entry: DecisionLogEntry): Promise<void> {
    await fetch(
      `${PROJECT_BRAIN_URL}/api/projects/${entry.projectId}/memories`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          memoryType: "episodic",
          content: `Decision by ${entry.agentRole}: ${entry.decision}${entry.reasoning ? `\nReasoning: ${entry.reasoning}` : ""}${entry.outcome ? `\nOutcome: ${entry.outcome}` : ""}`,
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
  }
}
