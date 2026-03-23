import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, fileIndexes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq } from "drizzle-orm";
import type { KnowledgeGraphLayer } from "../layers/knowledge-graph";
import type { SemanticLayer } from "../layers/semantic";
import { parseTypeScript } from "../parsers/tree-sitter";

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

    // Parse with tree-sitter for TS/JS files to extract symbols
    const ext = path.extname(filePath);
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
      try {
        const symbolTable = parseTypeScript(filePath, content);
        logger.debug(
          {
            filePath,
            functions: symbolTable.functions.length,
            classes: symbolTable.classes.length,
            imports: symbolTable.imports.length,
          },
          "Parsed symbols"
        );
      } catch (parseErr) {
        logger.warn({ filePath, err: parseErr }, "Symbol parsing failed");
      }
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
   * Tiered indexing: prioritize files based on task context.
   *
   * - Tier 1 (immediate): Files referenced in the task description — indexed synchronously.
   * - Tier 2 (priority): Files within 2 hops in the knowledge graph — indexed via priority queue.
   * - Tier 3 (background): All remaining files — indexed as a background job.
   *
   * @param projectId - Project identifier
   * @param taskDescription - The task description used to extract referenced files
   * @param allFiles - Array of { path, content } for all available files
   */
  async indexTiered(
    projectId: string,
    taskDescription: string,
    allFiles: Array<{ path: string; content: string }>
  ): Promise<void> {
    logger.info(
      { projectId, totalFiles: allFiles.length },
      "Starting tiered indexing"
    );

    const fileMap = new Map<string, string>();
    for (const f of allFiles) {
      fileMap.set(f.path, f.content);
    }

    // --- Tier 1: Files mentioned in the task description ---
    const tier1Paths = this.extractReferencedFiles(taskDescription, allFiles);
    const tier1Set = new Set(tier1Paths);
    logger.info(
      { projectId, tier1Count: tier1Paths.length },
      "Tier 1: indexing referenced files synchronously"
    );
    await this.indexFileList(projectId, tier1Paths, fileMap, "Tier 1");

    // --- Tier 2: Files within 2 hops in knowledge graph ---
    const tier2Set = await this.collectTier2Files(
      projectId,
      tier1Paths,
      tier1Set,
      fileMap
    );
    logger.info(
      { projectId, tier2Count: tier2Set.size },
      "Tier 2: indexing graph-adjacent files"
    );
    await this.indexFileList(
      projectId,
      Array.from(tier2Set),
      fileMap,
      "Tier 2"
    );

    // --- Tier 3: Everything else (background) ---
    const indexedSet = new Set([...tier1Set, ...tier2Set]);
    const tier3Files = allFiles.filter((f) => !indexedSet.has(f.path));
    logger.info(
      { projectId, tier3Count: tier3Files.length },
      "Tier 3: queuing remaining files for background indexing"
    );
    await this.indexInBatches(projectId, tier3Files);

    logger.info(
      {
        projectId,
        tier1: tier1Paths.length,
        tier2: tier2Set.size,
        tier3: tier3Files.length,
      },
      "Tiered indexing complete"
    );
  }

  private async indexFileList(
    projectId: string,
    filePaths: string[],
    fileMap: Map<string, string>,
    tierLabel: string
  ): Promise<void> {
    for (const filePath of filePaths) {
      const content = fileMap.get(filePath);
      if (!content) {
        continue;
      }
      try {
        await this.indexFile(projectId, filePath, content);
      } catch (err) {
        logger.warn(
          { projectId, filePath, err },
          `${tierLabel} indexing failed`
        );
      }
    }
  }

  private async collectTier2Files(
    projectId: string,
    tier1Paths: string[],
    tier1Set: Set<string>,
    fileMap: Map<string, string>
  ): Promise<Set<string>> {
    const tier2Set = new Set<string>();
    for (const filePath of tier1Paths) {
      try {
        const related = await this.knowledgeGraph.traverseFromNode(
          projectId,
          `file:${filePath}`,
          2
        );
        if (related && Array.isArray(related.nodes)) {
          for (const node of related.nodes) {
            if (
              node.filePath &&
              !tier1Set.has(node.filePath) &&
              fileMap.has(node.filePath)
            ) {
              tier2Set.add(node.filePath);
            }
          }
        }
      } catch {
        // Knowledge graph may not have this node yet
      }
    }
    return tier2Set;
  }

  private async indexInBatches(
    projectId: string,
    files: Array<{ path: string; content: string }>
  ): Promise<void> {
    const BATCH_SIZE = 20;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (f) => {
        try {
          await this.indexFile(projectId, f.path, f.content);
        } catch (err) {
          logger.warn(
            { projectId, filePath: f.path, err },
            "Tier 3 indexing failed"
          );
        }
      });
      await Promise.all(promises);
    }
  }

  /**
   * Extract file paths referenced in a task description.
   * Looks for quoted paths, import-style references, and file extensions.
   */
  private extractReferencedFiles(
    description: string,
    allFiles: Array<{ path: string }>
  ): string[] {
    const referenced: string[] = [];
    const descLower = description.toLowerCase();

    for (const file of allFiles) {
      // Check if the file path or filename appears in the description
      const fileName = file.path.split("/").pop() ?? "";
      if (
        description.includes(file.path) ||
        (fileName.length > 3 && descLower.includes(fileName.toLowerCase()))
      ) {
        referenced.push(file.path);
      }
    }

    return referenced;
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
