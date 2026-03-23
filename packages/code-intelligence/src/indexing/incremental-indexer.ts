/**
 * Incremental file indexer for code intelligence.
 *
 * Tracks file content hashes to detect changes and only re-indexes
 * modified files, providing efficient workspace-level indexing.
 */

import { createHash } from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("code-intelligence:incremental-indexer");

/**
 * Metadata tracked per indexed file.
 */
export interface IndexedFileInfo {
  /** SHA-256 hash of the file content at last index time */
  contentHash: string;
  /** Detected language identifier */
  language: string | undefined;
  /** Number of symbols extracted */
  symbolCount: number;
  /** Timestamp of last indexing */
  timestamp: number;
}

/**
 * Status snapshot of the indexer.
 */
export interface IndexStatus {
  /** Map of file paths to their index metadata */
  files: Map<string, IndexedFileInfo>;
  /** Number of files currently indexed */
  indexedFileCount: number;
  /** Timestamp of the most recent indexing operation, or null if none */
  lastIndexTime: number | null;
}

/**
 * Result of indexing a batch of changed files.
 */
export interface IndexResult {
  /** Files that were added (not previously indexed) */
  added: string[];
  /** Total duration of the indexing operation in milliseconds */
  durationMs: number;
  /** Files that were removed from the index (no longer present) */
  removed: string[];
  /** Files whose content hash changed and were re-indexed */
  updated: string[];
}

/**
 * Callback invoked for each file that needs (re-)indexing.
 * Implementations should parse and extract symbols from the file content.
 *
 * @param filePath - Absolute or relative path to the file
 * @param content - The file's source content
 * @returns The number of symbols extracted, and the detected language
 */
export type IndexFileCallback = (
  filePath: string,
  content: string
) =>
  | Promise<{ symbolCount: number; language: string | undefined }>
  | { symbolCount: number; language: string | undefined };

/**
 * Incremental indexer that tracks file hashes to detect changes
 * and only re-indexes modified files.
 *
 * @example
 * ```ts
 * const indexer = new IncrementalIndexer();
 *
 * const result = await indexer.indexChangedFiles(
 *   ["src/index.ts", "src/utils.ts"],
 *   async (path, content) => {
 *     const symbols = extractSymbols(parse(content));
 *     return { symbolCount: symbols.length, language: "typescript" };
 *   },
 *   (path) => fs.readFileSync(path, "utf-8"),
 * );
 * ```
 */
export class IncrementalIndexer {
  private readonly fileIndex = new Map<string, IndexedFileInfo>();
  private lastIndexTime: number | null = null;

  /**
   * Index only the files that have actually changed since the last indexing.
   *
   * @param changedPaths - List of file paths that may have changed
   * @param indexFn - Callback to perform the actual indexing per file
   * @param readFile - Function to read file content by path
   * @returns Summary of what was added, updated, or removed
   */
  async indexChangedFiles(
    changedPaths: string[],
    indexFn: IndexFileCallback,
    readFile: (filePath: string) => Promise<string> | string
  ): Promise<IndexResult> {
    const start = performance.now();
    const added: string[] = [];
    const updated: string[] = [];

    for (const filePath of changedPaths) {
      let content: string;
      try {
        content = await readFile(filePath);
      } catch {
        logger.debug({ filePath }, "Skipping unreadable file");
        continue;
      }

      const newHash = computeHash(content);
      const existing = this.fileIndex.get(filePath);

      if (existing && existing.contentHash === newHash) {
        // File unchanged — skip re-indexing
        continue;
      }

      const result = await indexFn(filePath, content);

      const info: IndexedFileInfo = {
        contentHash: newHash,
        timestamp: Date.now(),
        symbolCount: result.symbolCount,
        language: result.language,
      };

      if (existing) {
        updated.push(filePath);
      } else {
        added.push(filePath);
      }

      this.fileIndex.set(filePath, info);
    }

    this.lastIndexTime = Date.now();
    const durationMs = Math.round(performance.now() - start);

    logger.info(
      { added: added.length, updated: updated.length, durationMs },
      `Incremental index complete: ${added.length} added, ${updated.length} updated in ${durationMs}ms`
    );

    return { added, updated, removed: [], durationMs };
  }

  /**
   * Remove files from the index.
   *
   * @param filePaths - Files to remove
   * @returns List of paths that were actually removed (were in the index)
   */
  removeFiles(filePaths: string[]): string[] {
    const removed: string[] = [];
    for (const filePath of filePaths) {
      if (this.fileIndex.delete(filePath)) {
        removed.push(filePath);
      }
    }
    if (removed.length > 0) {
      logger.info(
        { count: removed.length },
        `Removed ${removed.length} files from index`
      );
    }
    return removed;
  }

  /**
   * Check whether a file has changed since it was last indexed.
   *
   * @param filePath - The file path
   * @param currentHash - SHA-256 hash of the current content
   * @returns true if the file is new or has changed
   */
  hasChanged(filePath: string, currentHash: string): boolean {
    const existing = this.fileIndex.get(filePath);
    if (!existing) {
      return true;
    }
    return existing.contentHash !== currentHash;
  }

  /**
   * Get a snapshot of the current index status.
   */
  getIndexStatus(): IndexStatus {
    return {
      indexedFileCount: this.fileIndex.size,
      lastIndexTime: this.lastIndexTime,
      files: new Map(this.fileIndex),
    };
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.fileIndex.clear();
    this.lastIndexTime = null;
    logger.debug("Incremental index cleared");
  }
}

/**
 * Compute a SHA-256 hex hash of a string.
 */
function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
