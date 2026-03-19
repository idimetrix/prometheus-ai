import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, fileIndexes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq } from "drizzle-orm";
import type { KnowledgeGraphLayer } from "../layers/knowledge-graph";
import type { SemanticLayer } from "../layers/semantic";

const logger = createLogger("project-brain:indexer");

/** File extensions we index */
const INDEXABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".css",
  ".html",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
  ".sql",
  ".graphql",
  ".gql",
  ".prisma",
  ".proto",
]);

/** Directories to skip */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".cache",
  "vendor",
  "target",
]);

/** Max file size to index (256KB) */
const MAX_FILE_SIZE = 256 * 1024;

export interface FileChange {
  action: "added" | "modified" | "deleted";
  content: string;
  hash: string;
  path: string;
}

export interface IndexProgress {
  currentFile: string | null;
  errorFiles: number;
  estimatedRemainingMs: number | null;
  indexedFiles: number;
  projectId: string;
  skippedFiles: number;
  startedAt: string;
  totalFiles: number;
}

export class FileIndexer {
  private readonly progressMap = new Map<string, IndexProgress>();

  private readonly semantic: SemanticLayer;
  private readonly knowledgeGraph: KnowledgeGraphLayer;

  constructor(semantic: SemanticLayer, knowledgeGraph: KnowledgeGraphLayer) {
    this.semantic = semantic;
    this.knowledgeGraph = knowledgeGraph;
  }

  /**
   * Get current indexing progress for a project.
   */
  getProgress(projectId: string): IndexProgress | null {
    return this.progressMap.get(projectId) ?? null;
  }

  /**
   * Index a single file. Computes hash and skips if unchanged.
   */
  async indexFile(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<boolean> {
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    // Check existing hash in DB
    const existing = await db
      .select()
      .from(fileIndexes)
      .where(
        and(
          eq(fileIndexes.projectId, projectId),
          eq(fileIndexes.filePath, filePath)
        )
      )
      .limit(1);

    if (existing.length > 0 && existing[0]?.fileHash === hash) {
      logger.debug({ projectId, filePath }, "File unchanged, skipping");
      return false;
    }

    // Index in both semantic layer and knowledge graph
    await this.semantic.indexFile(projectId, filePath, content);
    await this.knowledgeGraph.analyzeFile(projectId, filePath, content);

    logger.info({ projectId, filePath }, "File indexed");
    return true;
  }

  /**
   * Walk a directory and index all source files. Supports incremental re-indexing
   * by checking file hashes against the file_indexes table.
   * Publishes progress updates for tracking.
   */
  async indexDirectory(
    projectId: string,
    dirPath: string,
    onProgress?: (progress: IndexProgress) => void
  ): Promise<{
    indexed: number;
    skipped: number;
    errors: number;
    totalFiles: number;
  }> {
    const stats = { indexed: 0, skipped: 0, errors: 0, totalFiles: 0 };
    const startedAt = new Date().toISOString();

    const filePaths = await this.walkDirectory(dirPath);
    stats.totalFiles = filePaths.length;
    logger.info(
      { projectId, dirPath, totalFiles: filePaths.length },
      "Starting directory index"
    );

    // Initialize progress
    const progress: IndexProgress = {
      projectId,
      totalFiles: filePaths.length,
      indexedFiles: 0,
      skippedFiles: 0,
      errorFiles: 0,
      currentFile: null,
      startedAt,
      estimatedRemainingMs: null,
    };
    this.progressMap.set(projectId, progress);

    const batchStartTime = Date.now();

    for (const absPath of filePaths) {
      const relativePath = path.relative(dirPath, absPath);
      progress.currentFile = relativePath;

      try {
        const content = await fs.readFile(absPath, "utf-8");
        const wasIndexed = await this.indexFile(
          projectId,
          relativePath,
          content
        );

        if (wasIndexed) {
          stats.indexed++;
          progress.indexedFiles++;
        } else {
          stats.skipped++;
          progress.skippedFiles++;
        }
      } catch (err) {
        logger.warn({ projectId, file: absPath, err }, "Failed to index file");
        stats.errors++;
        progress.errorFiles++;
      }

      // Estimate remaining time
      const elapsed = Date.now() - batchStartTime;
      const processed =
        progress.indexedFiles + progress.skippedFiles + progress.errorFiles;
      if (processed > 0) {
        const msPerFile = elapsed / processed;
        const remaining = filePaths.length - processed;
        progress.estimatedRemainingMs = Math.round(msPerFile * remaining);
      }

      // Emit progress every 10 files or on completion
      if (
        onProgress &&
        (processed % 10 === 0 || processed === filePaths.length)
      ) {
        onProgress({ ...progress });
      }
    }

    progress.currentFile = null;
    progress.estimatedRemainingMs = 0;
    this.progressMap.set(projectId, progress);

    if (onProgress) {
      onProgress({ ...progress });
    }

    logger.info({ projectId, dirPath, ...stats }, "Directory index complete");
    return stats;
  }

  /**
   * Process a batch of file changes for incremental indexing.
   */
  async indexChanges(
    projectId: string,
    changes: FileChange[]
  ): Promise<{ indexed: number; skipped: number; removed: number }> {
    let indexed = 0;
    let skipped = 0;
    let removed = 0;

    for (const change of changes) {
      if (change.action === "deleted") {
        await this.semantic.removeFile(projectId, change.path);
        removed++;
        continue;
      }

      // Check if hash changed
      const existing = await db
        .select()
        .from(fileIndexes)
        .where(
          and(
            eq(fileIndexes.projectId, projectId),
            eq(fileIndexes.filePath, change.path)
          )
        )
        .limit(1);

      if (existing.length > 0 && existing[0]?.fileHash === change.hash) {
        skipped++;
        continue;
      }

      await this.semantic.indexFile(projectId, change.path, change.content);
      await this.knowledgeGraph.analyzeFile(
        projectId,
        change.path,
        change.content
      );
      indexed++;
    }

    logger.info(
      { projectId, indexed, skipped, removed },
      "Index update complete"
    );
    return { indexed, skipped, removed };
  }

  /**
   * Full reindex: clear hashes and reindex all files.
   */
  async fullReindex(
    projectId: string,
    files: Array<{ path: string; content: string; hash: string }>
  ): Promise<void> {
    logger.info(
      { projectId, fileCount: files.length },
      "Starting full reindex"
    );

    const changes: FileChange[] = files.map((f) => ({
      ...f,
      action: "added" as const,
    }));

    await this.indexChanges(projectId, changes);
    logger.info(
      { projectId, fileCount: files.length },
      "Full reindex complete"
    );
  }

  /**
   * Detect language from file extension.
   */
  detectLanguage(filePath: string): string | null {
    return this.semantic.detectLanguage(filePath);
  }

  /**
   * Count lines of code in content.
   */
  countLOC(content: string): number {
    const lines = content.split("\n");
    // Count non-empty, non-comment lines
    let loc = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.length > 0 &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("#")
      ) {
        loc++;
      }
    }
    return loc;
  }

  /**
   * Recursively walk a directory, returning absolute paths of indexable files.
   */
  private async walkDirectory(dirPath: string): Promise<string[]> {
    const results: string[] = [];

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) {
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await this.walkDirectory(fullPath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!INDEXABLE_EXTENSIONS.has(ext)) {
          continue;
        }

        // Check file size
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE) {
            continue;
          }
        } catch {
          continue;
        }

        results.push(fullPath);
      }
    }

    return results;
  }
}
