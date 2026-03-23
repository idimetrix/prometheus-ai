/**
 * Index Warming Engine.
 *
 * Pre-loads and indexes critical files at session start to reduce
 * time-to-first-result. Prioritizes:
 * 1. Configuration files (tsconfig, package.json, etc.)
 * 2. Recently modified files (from git)
 * 3. Entry point files (index.ts, main.ts, app.ts)
 *
 * Target: 100K LOC indexed in <60s.
 */

import { createLogger } from "@prometheus/logger";
import {
  type IndexJob,
  IndexPriority,
  type PriorityIndexer,
} from "./priority-indexer";

const logger = createLogger("project-brain:index-warmer");

/** Maximum files to warm per category. */
const MAX_CONFIG_FILES = 20;
const MAX_RECENT_FILES = 50;
const MAX_ENTRY_POINTS = 30;

/** Config file patterns (highest priority). */
const CONFIG_PATTERNS = [
  "package.json",
  "tsconfig.json",
  "tsconfig.*.json",
  ".env.example",
  "drizzle.config.ts",
  "biome.json",
  "turbo.json",
  "docker-compose.yml",
  "Dockerfile",
  "vitest.config.ts",
  "next.config.ts",
  "next.config.js",
  "tailwind.config.ts",
];

/** Entry point patterns (high priority). */
const ENTRY_PATTERNS = [
  "index.ts",
  "index.tsx",
  "main.ts",
  "app.ts",
  "app.tsx",
  "server.ts",
  "routes.ts",
  "router.ts",
  "schema.ts",
];

/**
 * Result of an index warming session.
 */
export interface WarmingResult {
  /** Number of config files indexed */
  configFiles: number;
  /** Total warming duration in ms */
  durationMs: number;
  /** Number of entry point files indexed */
  entryPoints: number;
  /** Estimated lines of code processed */
  estimatedLoc: number;
  /** Number of recently modified files indexed */
  recentFiles: number;
  /** Total files queued for indexing */
  totalFiles: number;
}

/**
 * File information for warming.
 */
export interface WarmFile {
  /** File content */
  content: string;
  /** File path relative to project root */
  filePath: string;
  /** Detected language */
  language: string;
}

/**
 * Index Warmer pre-loads critical project files at session start.
 *
 * Warming order:
 * 1. Config files (package.json, tsconfig.json, etc.) -- highest priority
 * 2. Recently modified files (git recent) -- high priority
 * 3. Entry points (index.ts, main.ts, app.ts) -- medium priority
 *
 * @example
 * ```ts
 * const warmer = new IndexWarmer(priorityIndexer);
 * const result = await warmer.warmForSession("proj_123", "session_abc");
 * console.log(`Warmed ${result.totalFiles} files (${result.estimatedLoc} LOC)`);
 * ```
 */
export class IndexWarmer {
  private readonly indexer: PriorityIndexer;

  constructor(indexer: PriorityIndexer) {
    this.indexer = indexer;
  }

  /**
   * Warm the index for a new session.
   *
   * Queues config files, recent files, and entry points for indexing
   * in priority order.
   *
   * @param projectId - The project identifier
   * @param sessionId - The session identifier
   * @param files - Available files to warm (caller provides the file list)
   * @returns Warming statistics
   */
  async warmForSession(
    projectId: string,
    sessionId: string,
    files?: WarmFile[]
  ): Promise<WarmingResult> {
    const start = performance.now();

    logger.info(
      { projectId, sessionId, fileCount: files?.length ?? 0 },
      "Starting index warming for session"
    );

    const availableFiles = files ?? [];
    let totalFiles = 0;
    let estimatedLoc = 0;

    // Phase 1: Config files (highest priority)
    const configFiles = this.selectConfigFiles(availableFiles);
    for (const file of configFiles) {
      await this.enqueueFile(projectId, file, IndexPriority.HIGH);
      estimatedLoc += file.content.split("\n").length;
    }
    totalFiles += configFiles.length;

    // Phase 2: Recent files (high priority)
    const recentFiles = this.selectRecentFiles(availableFiles, configFiles);
    for (const file of recentFiles) {
      await this.enqueueFile(projectId, file, IndexPriority.HIGH);
      estimatedLoc += file.content.split("\n").length;
    }
    totalFiles += recentFiles.length;

    // Phase 3: Entry points (medium priority)
    const entryPoints = this.selectEntryPoints(availableFiles, [
      ...configFiles,
      ...recentFiles,
    ]);
    for (const file of entryPoints) {
      await this.enqueueFile(projectId, file, IndexPriority.MEDIUM);
      estimatedLoc += file.content.split("\n").length;
    }
    totalFiles += entryPoints.length;

    const durationMs = Math.round(performance.now() - start);

    const result: WarmingResult = {
      totalFiles,
      configFiles: configFiles.length,
      recentFiles: recentFiles.length,
      entryPoints: entryPoints.length,
      estimatedLoc,
      durationMs,
    };

    logger.info(
      {
        projectId,
        sessionId,
        ...result,
      },
      `Index warming completed: ${totalFiles} files, ~${estimatedLoc} LOC in ${durationMs}ms`
    );

    return result;
  }

  /**
   * Select configuration files from available files.
   */
  private selectConfigFiles(files: WarmFile[]): WarmFile[] {
    return files
      .filter((file) => {
        const fileName = file.filePath.split("/").pop() ?? "";
        return CONFIG_PATTERNS.some((pattern) => {
          if (pattern.includes("*")) {
            const re = new RegExp(
              `^${pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`
            );
            return re.test(fileName);
          }
          return fileName === pattern;
        });
      })
      .slice(0, MAX_CONFIG_FILES);
  }

  /**
   * Select recently modified files (not already selected as config).
   */
  private selectRecentFiles(
    files: WarmFile[],
    alreadySelected: WarmFile[]
  ): WarmFile[] {
    const selectedPaths = new Set(alreadySelected.map((f) => f.filePath));

    return files
      .filter((file) => !selectedPaths.has(file.filePath))
      .filter((file) => {
        // Exclude non-source files
        const ext = file.filePath.split(".").pop()?.toLowerCase() ?? "";
        return [
          "ts",
          "tsx",
          "js",
          "jsx",
          "py",
          "go",
          "rs",
          "java",
          "rb",
          "php",
        ].includes(ext);
      })
      .slice(0, MAX_RECENT_FILES);
  }

  /**
   * Select entry point files (not already selected).
   */
  private selectEntryPoints(
    files: WarmFile[],
    alreadySelected: WarmFile[]
  ): WarmFile[] {
    const selectedPaths = new Set(alreadySelected.map((f) => f.filePath));

    return files
      .filter((file) => !selectedPaths.has(file.filePath))
      .filter((file) => {
        const fileName = file.filePath.split("/").pop() ?? "";
        return ENTRY_PATTERNS.includes(fileName);
      })
      .slice(0, MAX_ENTRY_POINTS);
  }

  /**
   * Enqueue a file for indexing via the priority indexer.
   */
  private async enqueueFile(
    projectId: string,
    file: WarmFile,
    priority: (typeof IndexPriority)[keyof typeof IndexPriority]
  ): Promise<void> {
    const job: IndexJob = {
      projectId,
      filePath: file.filePath,
      content: file.content,
      language: file.language,
    };

    await this.indexer.enqueue(job, priority);
  }
}
