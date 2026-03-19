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
 * IncrementalPipeline handles per-file re-indexing operations:
 *   - delete: remove from semantic index and knowledge graph
 *   - create/modify: re-parse, re-embed, update knowledge graph
 *
 * Designed to be called from the FileWatcher or from BullMQ job handlers
 * for background incremental re-indexing.
 */
export class IncrementalPipeline {
  private readonly semantic: SemanticLayer;
  private readonly knowledgeGraph: KnowledgeGraphLayer;
  private readonly merkleTree: MerkleTree;

  constructor(semantic: SemanticLayer, knowledgeGraph: KnowledgeGraphLayer) {
    this.semantic = semantic;
    this.knowledgeGraph = knowledgeGraph;
    this.merkleTree = new MerkleTree();
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
