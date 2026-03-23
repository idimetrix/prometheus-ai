import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:conflict-detector");

export interface FileChange {
  agentId: string;
  agentRole: string;
  changeType: "create" | "modify" | "delete";
  filePath: string;
  timestamp: number;
}

export interface ConflictReport {
  conflicts: FileConflict[];
  hasConflicts: boolean;
  totalFilesModified: number;
}

export interface FileConflict {
  agents: Array<{ id: string; role: string; changeType: string }>;
  filePath: string;
  severity: "low" | "medium" | "high";
  suggestion: string;
}

export class ConflictDetector {
  private readonly changes = new Map<string, FileChange[]>();

  recordChange(change: FileChange): void {
    const existing = this.changes.get(change.filePath) ?? [];
    existing.push(change);
    this.changes.set(change.filePath, existing);
  }

  recordChanges(changes: FileChange[]): void {
    for (const change of changes) {
      this.recordChange(change);
    }
  }

  detect(): ConflictReport {
    const conflicts: FileConflict[] = [];

    for (const [filePath, changes] of this.changes) {
      const uniqueAgents = new Map<string, FileChange>();
      for (const change of changes) {
        const existing = uniqueAgents.get(change.agentId);
        if (!existing || change.timestamp > existing.timestamp) {
          uniqueAgents.set(change.agentId, change);
        }
      }

      if (uniqueAgents.size <= 1) {
        continue;
      }

      const agents = [...uniqueAgents.values()].map((c) => ({
        id: c.agentId,
        role: c.agentRole,
        changeType: c.changeType,
      }));

      const hasDelete = agents.some((a) => a.changeType === "delete");
      const hasCreate = agents.some((a) => a.changeType === "create");
      const allModify = agents.every((a) => a.changeType === "modify");

      let severity: "low" | "medium" | "high";
      let suggestion: string;

      if (hasDelete) {
        severity = "high";
        suggestion =
          "One agent deleted this file while another modified it. Manual review required.";
      } else if (hasCreate && allModify) {
        severity = "medium";
        suggestion =
          "Multiple agents modified this newly created file. Consider three-way merge.";
      } else if (allModify) {
        severity = "medium";
        suggestion =
          "Multiple agents modified the same file. Attempt automatic merge, fall back to manual review.";
      } else {
        severity = "low";
        suggestion =
          "Concurrent access detected but changes may be compatible.";
      }

      conflicts.push({ filePath, agents, severity, suggestion });

      logger.warn(
        {
          filePath,
          agents: agents.map((a) => `${a.role}(${a.changeType})`),
          severity,
        },
        "Fleet conflict detected"
      );
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts: conflicts.sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      totalFilesModified: this.changes.size,
    };
  }

  clear(): void {
    this.changes.clear();
  }

  getModifiedFiles(): string[] {
    return [...this.changes.keys()];
  }

  getChangesForFile(filePath: string): FileChange[] {
    return this.changes.get(filePath) ?? [];
  }
}
