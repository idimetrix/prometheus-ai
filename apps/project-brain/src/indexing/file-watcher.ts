import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:file-watcher");

/** Debounce window in milliseconds */
const DEBOUNCE_MS = 1000;

/** Coalescing window: edits within this window are merged */
const COALESCE_WINDOW_MS = 1000;

/** Maximum number of edits to track per file for coalescing stats */
const MAX_EDIT_HISTORY = 20;

export type ChangeType = "create" | "modify" | "delete";

export interface FileChange {
  changeType: ChangeType;
  filePath: string;
  recordedAt: number;
}

/**
 * Tracks pending change metadata for debouncing and coalescing.
 */
interface PendingChangeInfo {
  /** The latest change for this file */
  change: FileChange;
  /** Number of edits coalesced into this pending change */
  coalescedCount: number;
  /** Timestamps of recent edits within the coalescing window */
  editTimestamps: number[];
}

export interface FileWatcherStats {
  /** Files currently being debounced (edit within last COALESCE_WINDOW_MS) */
  activelyDebouncing: number;
  /** Number of unique files with pending changes */
  pendingFiles: number;
  /** Total edits coalesced (saved from redundant processing) */
  totalCoalesced: number;
}

/**
 * FileWatcher tracks file changes and batches them within a debounce window.
 *
 * Changes are accumulated in an internal buffer. When `processChanges` is called,
 * only changes older than the debounce window are returned and cleared, ensuring
 * rapid successive edits to the same file are coalesced.
 *
 * Phase 3.4 enhancements:
 * - Debouncing/coalescing: 5 edits to the same file within 1s results in only
 *   the final version being indexed.
 * - Tracks pending changes per file with timestamps.
 * - Flush debounced changes after the debounce window.
 */
export class FileWatcher {
  /** Pending changes keyed by filePath with coalescing metadata */
  private readonly pending = new Map<string, PendingChangeInfo>();

  /** Timer handle for debounce flush */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Per-file debounce timers for coalescing */
  private readonly fileTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /** Optional callback invoked after debounce window expires */
  private readonly onFlush: ((changes: FileChange[]) => void) | null;

  /** Running count of coalesced edits */
  private totalCoalesced = 0;

  constructor(onFlush?: (changes: FileChange[]) => void) {
    this.onFlush = onFlush ?? null;
  }

  /**
   * Record a file change. If the same file is changed multiple times within
   * the coalescing window, only the latest change is kept.
   *
   * Coalescing: multiple rapid edits to the same file within COALESCE_WINDOW_MS
   * are merged into a single pending change. Only the final state is indexed.
   */
  recordChange(filePath: string, changeType: ChangeType): void {
    const now = Date.now();
    const existing = this.pending.get(filePath);

    if (existing) {
      // Coalesce: update the existing pending change
      existing.change = {
        filePath,
        changeType,
        recordedAt: now,
      };

      // Track edit timestamps within the coalescing window
      existing.editTimestamps.push(now);
      // Prune old timestamps outside the window
      existing.editTimestamps = existing.editTimestamps
        .filter((t) => now - t < COALESCE_WINDOW_MS)
        .slice(-MAX_EDIT_HISTORY);

      existing.coalescedCount++;
      this.totalCoalesced++;

      logger.debug(
        {
          filePath,
          changeType,
          coalescedCount: existing.coalescedCount,
          recentEdits: existing.editTimestamps.length,
        },
        "Change coalesced"
      );
    } else {
      // New file change
      this.pending.set(filePath, {
        change: {
          filePath,
          changeType,
          recordedAt: now,
        },
        editTimestamps: [now],
        coalescedCount: 1,
      });

      logger.debug({ filePath, changeType }, "Change recorded");
    }

    // Reset the per-file debounce timer
    this.resetFileTimer(filePath);
    // Schedule the global flush
    this.scheduleFlush();
  }

  /**
   * Return all pending file changes without clearing.
   */
  getChangedFiles(): FileChange[] {
    return Array.from(this.pending.values()).map((info) => info.change);
  }

  /**
   * Return the number of pending changes.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Get statistics about the watcher's current state.
   */
  getStats(): FileWatcherStats {
    const now = Date.now();
    let activelyDebouncing = 0;

    for (const info of this.pending.values()) {
      if (now - info.change.recordedAt < COALESCE_WINDOW_MS) {
        activelyDebouncing++;
      }
    }

    return {
      pendingFiles: this.pending.size,
      totalCoalesced: this.totalCoalesced,
      activelyDebouncing,
    };
  }

  /**
   * Process all pending changes that have settled (older than debounce window).
   * Returns the changes that were processed and removes them from the buffer.
   *
   * Only processes changes where the file has not been edited within the
   * debounce window, ensuring rapid edits are fully coalesced before indexing.
   */
  async processChanges(
    projectId: string,
    handler: (projectId: string, changes: FileChange[]) => Promise<number>
  ): Promise<number> {
    const now = Date.now();
    const settled: FileChange[] = [];
    const remaining: [string, PendingChangeInfo][] = [];

    for (const [key, info] of this.pending) {
      if (now - info.change.recordedAt >= DEBOUNCE_MS) {
        settled.push(info.change);
      } else {
        remaining.push([key, info]);
      }
    }

    if (settled.length === 0) {
      return 0;
    }

    // Clear settled entries
    this.pending.clear();
    for (const [key, info] of remaining) {
      this.pending.set(key, info);
    }

    // Clean up file timers for settled files
    for (const change of settled) {
      const timer = this.fileTimers.get(change.filePath);
      if (timer) {
        clearTimeout(timer);
        this.fileTimers.delete(change.filePath);
      }
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
   * Cancels all pending timers.
   */
  flush(): FileChange[] {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Clear all per-file timers
    for (const timer of this.fileTimers.values()) {
      clearTimeout(timer);
    }
    this.fileTimers.clear();

    const changes = Array.from(this.pending.values()).map(
      (info) => info.change
    );
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

    for (const timer of this.fileTimers.values()) {
      clearTimeout(timer);
    }
    this.fileTimers.clear();
    this.pending.clear();
  }

  /**
   * Reset the per-file debounce timer. When the timer fires without
   * further edits, the file's change is considered settled.
   */
  private resetFileTimer(filePath: string): void {
    const existing = this.fileTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.fileTimers.delete(filePath);
      // The file has settled -- the global flush will pick it up
      logger.debug({ filePath }, "File debounce settled");
    }, COALESCE_WINDOW_MS);

    this.fileTimers.set(filePath, timer);
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.onFlush && this.pending.size > 0) {
        const changes = Array.from(this.pending.values()).map(
          (info) => info.change
        );
        this.onFlush(changes);
      }
    }, DEBOUNCE_MS);
  }
}
