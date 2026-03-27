import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:changeset-manager");

export interface FileChange {
  content: string;
  operation: "create" | "modify" | "delete";
  path: string;
  previousContent?: string;
}

export interface Changeset {
  changes: FileChange[];
  createdAt: Date;
  description: string;
  gitCommitSha?: string;
  id: string;
  sessionId: string;
  status: "pending" | "approved" | "rejected" | "applied";
  stepNumber: number;
  taskId: string;
}

/**
 * Manages atomic changesets from agent actions, enabling approve/reject/undo.
 */
export class ChangesetManager {
  private readonly changesets: Map<string, Changeset> = new Map();

  /**
   * Create a new changeset from a batch of file changes.
   */
  createChangeset(params: {
    changes: FileChange[];
    description: string;
    sessionId: string;
    stepNumber: number;
    taskId: string;
  }): Changeset {
    const id = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const changeset: Changeset = {
      id,
      sessionId: params.sessionId,
      taskId: params.taskId,
      stepNumber: params.stepNumber,
      description: params.description,
      changes: params.changes,
      status: "pending",
      createdAt: new Date(),
    };

    this.changesets.set(id, changeset);
    logger.info(
      {
        changesetId: id,
        fileCount: params.changes.length,
        step: params.stepNumber,
      },
      "Changeset created"
    );

    return changeset;
  }

  /**
   * Approve a changeset, marking it ready for application.
   */
  approve(changesetId: string): boolean {
    const cs = this.changesets.get(changesetId);
    if (!cs || cs.status !== "pending") {
      return false;
    }
    cs.status = "approved";
    logger.info({ changesetId }, "Changeset approved");
    return true;
  }

  /**
   * Reject a changeset, preventing its application.
   */
  reject(changesetId: string): boolean {
    const cs = this.changesets.get(changesetId);
    if (!cs || cs.status !== "pending") {
      return false;
    }
    cs.status = "rejected";
    logger.info({ changesetId }, "Changeset rejected");
    return true;
  }

  /**
   * Mark a changeset as applied and record the git commit SHA.
   */
  markApplied(changesetId: string, gitCommitSha: string): boolean {
    const cs = this.changesets.get(changesetId);
    if (!cs) {
      return false;
    }
    cs.status = "applied";
    cs.gitCommitSha = gitCommitSha;
    logger.info({ changesetId, gitCommitSha }, "Changeset applied");
    return true;
  }

  /**
   * Get all changesets for a session, ordered by step number.
   */
  getSessionChangesets(sessionId: string): Changeset[] {
    const result: Changeset[] = [];
    for (const cs of this.changesets.values()) {
      if (cs.sessionId === sessionId) {
        result.push(cs);
      }
    }
    return result.sort((a, b) => a.stepNumber - b.stepNumber);
  }

  /**
   * Get pending changesets for a session that need approval.
   */
  getPendingChangesets(sessionId: string): Changeset[] {
    return this.getSessionChangesets(sessionId).filter(
      (cs) => cs.status === "pending"
    );
  }

  /**
   * Get a specific changeset by ID.
   */
  getChangeset(changesetId: string): Changeset | undefined {
    return this.changesets.get(changesetId);
  }

  /**
   * Get the git commit SHA for undoing a changeset (the previous changeset's SHA).
   */
  getUndoTarget(changesetId: string): string | null {
    const cs = this.changesets.get(changesetId);
    if (!cs) {
      return null;
    }

    const sessionChangesets = this.getSessionChangesets(cs.sessionId);
    const idx = sessionChangesets.findIndex((c) => c.id === changesetId);

    if (idx <= 0) {
      return null;
    }

    // Return the previous changeset's commit SHA to revert to
    const prev = sessionChangesets[idx - 1];
    return prev?.gitCommitSha ?? null;
  }
}
