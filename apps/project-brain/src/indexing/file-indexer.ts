import { db } from "@prometheus/db";
import { fileIndexes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SemanticLayer } from "../layers/semantic";
import type { KnowledgeGraphLayer } from "../layers/knowledge-graph";

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
  path: string;
  content: string;
  hash: string;
  action: "added" | "modified" | "deleted";
}

export class FileIndexer {
  constructor(
    private readonly semantic: SemanticLayer,
    private readonly knowledgeGraph: KnowledgeGraphLayer,
  ) {}

  /**
   * Index a single file. Computes hash and skips if unchanged.
   */
  async indexFile(projectId: string, filePath: string, content: string): Promise<boolean> {
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    // Check existing hash in DB
    const existing = await db
      .select()
      .from(fileIndexes)
      .where(and(eq(fileIndexes.projectId, projectId), eq(fileIndexes.filePath, filePath)))
      .limit(1);

    if (existing.length > 0 && existing[0]!.fileHash === hash) {
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
   */
  async indexDirectory(
    projectId: string,
    dirPath: string,
  ): Promise<{ indexed: number; skipped: number; errors: number }> {
    const stats = { indexed: 0, skipped: 0, errors: 0 };

    const filePaths = await this.walkDirectory(dirPath);
    logger.info({ projectId, dirPath, totalFiles: filePaths.length }, "Starting directory index");

    for (const absPath of filePaths) {
      try {
        const content = await fs.readFile(absPath, "utf-8");
        // Use relative path from the dirPath for consistency
        const relativePath = path.relative(dirPath, absPath);
        const wasIndexed = await this.indexFile(projectId, relativePath, content);

        if (wasIndexed) {
          stats.indexed++;
        } else {
          stats.skipped++;
        }
      } catch (err) {
        logger.warn({ projectId, file: absPath, err }, "Failed to index file");
        stats.errors++;
      }
    }

    logger.info({ projectId, dirPath, ...stats }, "Directory index complete");
    return stats;
  }

  /**
   * Process a batch of file changes for incremental indexing.
   */
  async indexChanges(
    projectId: string,
    changes: FileChange[],
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
          and(eq(fileIndexes.projectId, projectId), eq(fileIndexes.filePath, change.path)),
        )
        .limit(1);

      if (existing.length > 0 && existing[0]!.fileHash === change.hash) {
        skipped++;
        continue;
      }

      await this.semantic.indexFile(projectId, change.path, change.content);
      await this.knowledgeGraph.analyzeFile(projectId, change.path, change.content);
      indexed++;
    }

    logger.info({ projectId, indexed, skipped, removed }, "Index update complete");
    return { indexed, skipped, removed };
  }

  /**
   * Full reindex: clear hashes and reindex all files.
   */
  async fullReindex(
    projectId: string,
    files: Array<{ path: string; content: string; hash: string }>,
  ): Promise<void> {
    logger.info({ projectId, fileCount: files.length }, "Starting full reindex");

    const changes: FileChange[] = files.map((f) => ({
      ...f,
      action: "added" as const,
    }));

    await this.indexChanges(projectId, changes);
    logger.info({ projectId, fileCount: files.length }, "Full reindex complete");
  }

  /**
   * Recursively walk a directory, returning absolute paths of indexable files.
   */
  private async walkDirectory(dirPath: string): Promise<string[]> {
    const results: string[] = [];

    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await this.walkDirectory(fullPath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!INDEXABLE_EXTENSIONS.has(ext)) continue;

        // Check file size
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue;
        } catch {
          continue;
        }

        results.push(fullPath);
      }
    }

    return results;
  }
}
