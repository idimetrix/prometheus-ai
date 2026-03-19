import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:file-watcher");

/** Debounce window in milliseconds */
const DEBOUNCE_MS = 1000;

export type ChangeType = "create" | "modify" | "delete";

export interface FileChange {
  changeType: ChangeType;
  filePath: string;
  recordedAt: number;
}

/**
 * FileWatcher tracks file changes and batches them within a debounce window.
 *
 * Changes are accumulated in an internal buffer. When `processChanges` is called,
 * only changes older than the debounce window are returned and cleared, ensuring
 * rapid successive edits to the same file are coalesced.
 */
export class FileWatcher {
  /** Pending changes keyed by filePath (latest change wins) */
  private readonly pending = new Map<string, FileChange>();

  /** Timer handle for debounce flush */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Optional callback invoked after debounce window expires */
  private readonly onFlush: ((changes: FileChange[]) => void) | null;

  constructor(onFlush?: (changes: FileChange[]) => void) {
    this.onFlush = onFlush ?? null;
  }

  /**
   * Record a file change. If the same file is changed multiple times within
   * the debounce window, only the latest change is kept.
   */
  recordChange(filePath: string, changeType: ChangeType): void {
    const change: FileChange = {
      filePath,
      changeType,
      recordedAt: Date.now(),
    };

    this.pending.set(filePath, change);
    logger.debug({ filePath, changeType }, "Change recorded");

    this.scheduleFlush();
  }

  /**
   * Return all pending file changes without clearing.
   */
  getChangedFiles(): FileChange[] {
    return Array.from(this.pending.values());
  }

  /**
   * Return the number of pending changes.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Process all pending changes that have settled (older than debounce window).
   * Returns the changes that were processed and removes them from the buffer.
   */
  async processChanges(
    projectId: string,
    handler: (projectId: string, changes: FileChange[]) => Promise<number>
  ): Promise<number> {
    const now = Date.now();
    const settled: FileChange[] = [];
    const remaining: [string, FileChange][] = [];

    for (const [key, change] of this.pending) {
      if (now - change.recordedAt >= DEBOUNCE_MS) {
        settled.push(change);
      } else {
        remaining.push([key, change]);
      }
    }

    if (settled.length === 0) {
      return 0;
    }

    // Clear settled entries
    this.pending.clear();
    for (const [key, change] of remaining) {
      this.pending.set(key, change);
    }

    logger.info(
      { projectId, changeCount: settled.length },
      "Processing settled file changes"
    );

    const processed = await handler(projectId, settled);

    logger.info(
      { projectId, processed, total: settled.length },
      "File changes processed"
    );

    return processed;
  }

  /**
   * Force-flush all pending changes regardless of debounce window.
   */
  flush(): FileChange[] {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const changes = Array.from(this.pending.values());
    this.pending.clear();
    return changes;
  }

  /**
   * Clear all pending changes without processing.
   */
  clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pending.clear();
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.onFlush && this.pending.size > 0) {
        const changes = Array.from(this.pending.values());
        this.onFlush(changes);
      }
    }, DEBOUNCE_MS);
  }
}
