import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, inArray } from "drizzle-orm";
import type { KnowledgeGraphLayer } from "../layers/knowledge-graph";
import type { SemanticLayer } from "../layers/semantic";
import { MerkleTree } from "./merkle-tree";

const logger = createLogger("project-brain:incremental-pipeline");

const CONCURRENCY_LIMIT = 10;

export type ChangeType = "create" | "modify" | "delete";

/**
 * Priority levels for indexing queue.
 * P0: Active files (immediate processing)
 * P1: Same-directory files (<1s target)
 * P2: Dependent files (<5s target)
 * P3: Background/bulk indexing
 */
export type IndexPriority = 0 | 1 | 2 | 3;

interface QueuedItem {
  changeType: ChangeType;
  content: string;
  filePath: string;
  priority: IndexPriority;
  queuedAt: number;
}

export interface PriorityQueueStats {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  total: number;
}

/**
 * IncrementalPipeline handles per-file re-indexing operations:
 *   - delete: remove from semantic index and knowledge graph
 *   - create/modify: re-parse, re-embed, update knowledge graph
 *
 * Includes a priority queue with 4 levels (P0-P3) for ordering
 * indexing work by urgency. P0 is processed immediately, P1-P3
 * are processed in priority order.
 *
 * Designed to be called from the FileWatcher or from BullMQ job handlers
 * for background incremental re-indexing.
 */
export class IncrementalPipeline {
  private readonly semantic: SemanticLayer;
  private readonly knowledgeGraph: KnowledgeGraphLayer;
  private readonly merkleTree: MerkleTree;

  /** Priority queues: index 0 = P0, 1 = P1, 2 = P2, 3 = P3 */
  private readonly queues: Map<string, QueuedItem>[] = [
    new Map(),
    new Map(),
    new Map(),
    new Map(),
  ];

  /** Whether the queue processor is currently running */
  private processing = false;

  constructor(semantic: SemanticLayer, knowledgeGraph: KnowledgeGraphLayer) {
    this.semantic = semantic;
    this.knowledgeGraph = knowledgeGraph;
    this.merkleTree = new MerkleTree();
  }

  /**
   * Add a file to the priority indexing queue.
   * P0 items trigger immediate processing.
   */
  queueForIndexing(
    filePath: string,
    content: string,
    changeType: ChangeType,
    priority: IndexPriority
  ): void {
    const item: QueuedItem = {
      filePath,
      content,
      changeType,
      priority,
      queuedAt: Date.now(),
    };

    const queue = this.queues[priority] as Map<string, QueuedItem>;
    queue.set(filePath, item);

    logger.debug(
      {
        filePath,
        priority,
        changeType,
        queueSize: this.getTotalQueueSize(),
      },
      "File queued for indexing"
    );
  }

  /**
   * Get current queue sizes per priority level.
   */
  getQueueStats(): PriorityQueueStats {
    return {
      p0: (this.queues[0] as Map<string, QueuedItem>).size,
      p1: (this.queues[1] as Map<string, QueuedItem>).size,
      p2: (this.queues[2] as Map<string, QueuedItem>).size,
      p3: (this.queues[3] as Map<string, QueuedItem>).size,
      total: this.getTotalQueueSize(),
    };
  }

  /**
   * Process all queued items in priority order.
   * P0 first, then P1, then P2, then P3.
   * Returns total number of files successfully processed.
   */
  async processQueue(projectId: string): Promise<number> {
    if (this.processing) {
      logger.debug("Queue processor already running, skipping");
      return 0;
    }

    this.processing = true;
    let totalProcessed = 0;

    try {
      // Process each priority level in order
      for (let p = 0; p <= 3; p++) {
        const queue = this.queues[p] as Map<string, QueuedItem>;
        if (queue.size === 0) {
          continue;
        }

        const items = Array.from(queue.values());
        queue.clear();

        logger.debug(
          { projectId, priority: p, itemCount: items.length },
          "Processing priority queue"
        );

        // Process with concurrency limit
        for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
          const batch = items.slice(i, i + CONCURRENCY_LIMIT);
          const results = await Promise.allSettled(
            batch.map((item) =>
              this.processFile(
                projectId,
                item.filePath,
                item.content,
                item.changeType
              )
            )
          );

          for (let j = 0; j < results.length; j++) {
            const result = results[j] as PromiseSettledResult<void>;
            if (result.status === "fulfilled") {
              totalProcessed++;
            } else {
              const item = batch[j] as QueuedItem;
              logger.error(
                {
                  err: result.reason as unknown,
                  projectId,
                  filePath: item.filePath,
                  priority: p,
                },
                "Failed to process queued file"
              );
            }
          }
        }
      }

      logger.info(
        { projectId, totalProcessed, stats: this.getQueueStats() },
        "Priority queue processing complete"
      );
    } finally {
      this.processing = false;
    }

    return totalProcessed;
  }

  /**
   * Drain a single priority level. Useful for processing only P0 items immediately.
   */
  async drainPriority(
    projectId: string,
    priority: IndexPriority
  ): Promise<number> {
    const queue = this.queues[priority] as Map<string, QueuedItem>;
    if (queue.size === 0) {
      return 0;
    }

    const items = Array.from(queue.values());
    queue.clear();

    let processed = 0;
    for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
      const batch = items.slice(i, i + CONCURRENCY_LIMIT);
      const results = await Promise.allSettled(
        batch.map((item) =>
          this.processFile(
            projectId,
            item.filePath,
            item.content,
            item.changeType
          )
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          processed++;
        }
      }
    }

    return processed;
  }

  private getTotalQueueSize(): number {
    let total = 0;
    for (const queue of this.queues) {
      total += queue.size;
    }
    return total;
  }

  /**
   * Process a single file change through the indexing pipeline.
   *
   * For "delete": removes the file from the semantic index and knowledge graph.
   * For "create" or "modify": re-indexes the file in both layers.
   */
  async processFile(
    projectId: string,
    filePath: string,
    content: string,
    changeType: ChangeType
  ): Promise<void> {
    logger.debug({ projectId, filePath, changeType }, "Processing file change");

    if (changeType === "delete") {
      await this.removeFile(projectId, filePath);
      return;
    }

    // For create/modify: re-index in both layers
    await this.indexFile(projectId, filePath, content);
  }

  /**
   * Process a batch of file changes. Uses a Merkle tree to detect which files
   * actually changed (comparing old vs new hashes) before processing. Returns
   * the number of files successfully processed.
   */
  async processBatch(
    projectId: string,
    changes: Array<{
      filePath: string;
      content: string;
      changeType: ChangeType;
    }>,
    previousHashes?: Map<string, string>
  ): Promise<number> {
    let filteredChanges = changes;

    // Use Merkle tree to filter out files that haven't actually changed
    if (previousHashes && previousHashes.size > 0) {
      const { createHash } = await import("node:crypto");
      const newHashes = new Map<string, string>();
      for (const change of changes) {
        const hash = createHash("sha256").update(change.content).digest("hex");
        newHashes.set(change.filePath, hash);
      }

      const diff = this.merkleTree.detectChanges(previousHashes, newHashes);
      const changedPaths = new Set([
        ...diff.added,
        ...diff.modified,
        ...diff.deleted,
      ]);

      filteredChanges = changes.filter((c) => changedPaths.has(c.filePath));

      // Also process deletions that are no longer in the new set
      for (const deletedPath of diff.deleted) {
        if (!filteredChanges.some((c) => c.filePath === deletedPath)) {
          filteredChanges.push({
            filePath: deletedPath,
            content: "",
            changeType: "delete",
          });
        }
      }

      // Rebuild Merkle tree with current file hashes
      this.merkleTree.build(
        Array.from(newHashes.entries()).map(([path, hash]) => ({ path, hash }))
      );

      logger.info(
        {
          projectId,
          original: changes.length,
          filtered: filteredChanges.length,
          added: diff.added.length,
          modified: diff.modified.length,
          deleted: diff.deleted.length,
        },
        "Merkle tree change detection complete"
      );
    }

    // Process with concurrency limit using Promise.allSettled
    let processed = 0;
    for (let i = 0; i < filteredChanges.length; i += CONCURRENCY_LIMIT) {
      const batch = filteredChanges.slice(i, i + CONCURRENCY_LIMIT);
      const results = await Promise.allSettled(
        batch.map((change) =>
          this.processFile(
            projectId,
            change.filePath,
            change.content,
            change.changeType
          )
        )
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j] as PromiseSettledResult<void>;
        if (result.status === "fulfilled") {
          processed++;
        } else {
          const change = batch[j] as (typeof batch)[number];
          logger.error(
            {
              err: result.reason as unknown,
              projectId,
              filePath: change.filePath,
              changeType: change.changeType,
            },
            "Failed to process file change"
          );
        }
      }
    }

    logger.info(
      { projectId, processed, total: filteredChanges.length },
      "Incremental batch complete"
    );

    return processed;
  }

  /**
   * Remove a file from all index layers.
   */
  private async removeFile(projectId: string, filePath: string): Promise<void> {
    try {
      await this.semantic.removeFile(projectId, filePath);
      logger.debug({ projectId, filePath }, "Removed from semantic index");
    } catch (err) {
      logger.warn(
        { err, projectId, filePath },
        "Failed to remove from semantic index"
      );
    }

    try {
      // Remove graph nodes for this file and their edges
      const fileNodes = await db
        .select({ id: graphNodes.id })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.projectId, projectId),
            eq(graphNodes.filePath, filePath)
          )
        );

      if (fileNodes.length > 0) {
        const nodeIds = fileNodes.map((n) => n.id);
        await db
          .delete(graphEdges)
          .where(
            and(
              eq(graphEdges.projectId, projectId),
              inArray(graphEdges.sourceId, nodeIds)
            )
          );
        await db
          .delete(graphEdges)
          .where(
            and(
              eq(graphEdges.projectId, projectId),
              inArray(graphEdges.targetId, nodeIds)
            )
          );
        await db
          .delete(graphNodes)
          .where(
            and(
              eq(graphNodes.projectId, projectId),
              eq(graphNodes.filePath, filePath)
            )
          );
      }
      logger.debug({ projectId, filePath }, "Removed from knowledge graph");
    } catch (err) {
      logger.warn(
        { err, projectId, filePath },
        "Failed to remove from knowledge graph"
      );
    }
  }

  /**
   * Index (or re-index) a file in all layers.
   */
  private async indexFile(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    // Index in semantic layer (embeddings)
    await this.semantic.indexFile(projectId, filePath, content);

    // Analyze in knowledge graph (AST relationships)
    await this.knowledgeGraph.analyzeFile(projectId, filePath, content);

    logger.debug({ projectId, filePath }, "File re-indexed");
  }
}
