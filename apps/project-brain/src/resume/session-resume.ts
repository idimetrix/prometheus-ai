import { db, sessionEvents, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { desc, eq } from "drizzle-orm";
import type { ContextAssembler } from "../context/assembler";
import type { EpisodicLayer } from "../layers/episodic";
import type { WorkingMemoryLayer } from "../layers/working-memory";

const logger = createLogger("project-brain:resume");

export interface SessionBriefing {
  contextAssembled: boolean;
  currentState: string;
  lastActions: string[];
  nextSteps: string[];
  resumeTimeMs: number;
  summary: string;
}

export class SessionResume {
  constructor(
    readonly _contextAssembler: ContextAssembler,
    private readonly workingMemory: WorkingMemoryLayer,
    private readonly episodic: EpisodicLayer
  ) {}

  async generateBriefing(
    sessionId: string,
    projectId: string
  ): Promise<SessionBriefing> {
    const startTime = Date.now();

    // Load session info, recent events, working memory, and episodic memories in parallel
    const [sessionInfo, recentEvents, workingMem, recentDecisions] =
      await Promise.all([
        this.loadSession(sessionId),
        this.loadRecentEvents(sessionId, 20),
        this.workingMemory.getAll(sessionId),
        this.episodic.getRecent(projectId, 5),
      ]);

    // Build summary from session state
    const status = sessionInfo?.status ?? "unknown";
    const mode = sessionInfo?.mode ?? "task";

    // Extract last actions from session events
    const lastActions = recentEvents
      .filter(
        (e) =>
          e.type === "file_change" ||
          e.type === "agent_output" ||
          e.type === "task_status"
      )
      .slice(0, 5)
      .map((e) => {
        const data = e.data as Record<string, unknown>;
        if (e.type === "file_change") {
          return `File changed: ${data.filePath ?? data.path ?? "unknown"}`;
        }
        if (e.type === "agent_output") {
          const content = String(data.content ?? data.message ?? "");
          return content.length > 100 ? `${content.slice(0, 100)}...` : content;
        }
        if (e.type === "task_status") {
          return `Task ${data.taskId ?? ""}: ${data.status ?? "updated"}`;
        }
        return `${e.type}: ${JSON.stringify(data).slice(0, 80)}`;
      });

    // Determine current state from working memory
    const currentTask = workingMem.current_task
      ? String(workingMem.current_task)
      : null;
    const activeFiles = workingMem.active_files
      ? (workingMem.active_files as string[])
      : [];
    const agentState = workingMem.agent_state
      ? String(workingMem.agent_state)
      : null;

    let currentState = `Session status: ${status}, mode: ${mode}`;
    if (currentTask) {
      currentState += `\nCurrent task: ${currentTask}`;
    }
    if (activeFiles.length > 0) {
      currentState += `\nActive files: ${activeFiles.join(", ")}`;
    }
    if (agentState) {
      currentState += `\nAgent state: ${agentState}`;
    }

    // Derive next steps from recent decisions and current state
    const nextSteps: string[] = [];

    // Look at the most recent decisions for context
    for (const decision of recentDecisions.slice(0, 3)) {
      if (decision.outcome === null) {
        // Decision without outcome = still in progress
        nextSteps.push(`Continue: ${decision.decision}`);
      }
    }

    // Check for recent errors
    const errorEvents = recentEvents.filter((e) => e.type === "error");
    if (errorEvents.length > 0) {
      const lastError = errorEvents[0] as (typeof errorEvents)[0];
      const errorData = lastError.data as Record<string, unknown>;
      nextSteps.push(
        `Address error: ${errorData.message ?? errorData.error ?? "Unknown error"}`
      );
    }

    // If no next steps derived, suggest generic continuation
    if (nextSteps.length === 0 && currentTask) {
      nextSteps.push(`Resume work on: ${currentTask}`);
    }

    const summary = this.buildSummary(
      sessionId,
      projectId,
      status,
      mode,
      lastActions,
      recentDecisions
    );

    const briefing: SessionBriefing = {
      summary,
      lastActions,
      currentState,
      nextSteps,
      contextAssembled: true,
      resumeTimeMs: Date.now() - startTime,
    };

    logger.info(
      {
        sessionId,
        projectId,
        resumeTimeMs: briefing.resumeTimeMs,
        eventsLoaded: recentEvents.length,
        decisionsLoaded: recentDecisions.length,
      },
      "Session briefing generated"
    );

    return briefing;
  }

  private async loadSession(sessionId: string) {
    try {
      const result = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      return result[0] ?? null;
    } catch (err) {
      logger.warn({ sessionId, err }, "Failed to load session");
      return null;
    }
  }

  private async loadRecentEvents(sessionId: string, limit: number) {
    try {
      const result = await db
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(desc(sessionEvents.timestamp))
        .limit(limit);
      return result;
    } catch (err) {
      logger.warn({ sessionId, err }, "Failed to load session events");
      return [];
    }
  }

  private buildSummary(
    sessionId: string,
    projectId: string,
    status: string,
    mode: string,
    lastActions: string[],
    recentDecisions: Array<{ decision: string; outcome: string | null }>
  ): string {
    const parts: string[] = [
      "# Session Resume Briefing",
      "",
      `**Session:** ${sessionId}`,
      `**Project:** ${projectId}`,
      `**Status:** ${status} | **Mode:** ${mode}`,
    ];

    if (lastActions.length > 0) {
      parts.push("", "## Where We Left Off");
      for (const action of lastActions) {
        parts.push(`- ${action}`);
      }
    }

    if (recentDecisions.length > 0) {
      parts.push("", "## Recent Decisions");
      for (const d of recentDecisions) {
        const outcome = d.outcome ? ` -> ${d.outcome}` : " (in progress)";
        parts.push(`- ${d.decision}${outcome}`);
      }
    }

    return parts.join("\n");
  }
}
