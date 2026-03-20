/**
 * Memory Evolution Engine.
 *
 * Manages the lifecycle of knowledge graph edges over time, applying
 * a 30-day exponential decay function to edge scores and pruning
 * stale edges that fall below a relevance threshold.
 */

import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

const logger = createLogger("project-brain:memory-evolution");

/**
 * Decay constant for the exponential decay function.
 * With lambda = 0.023, an edge score halves roughly every 30 days.
 * Formula: score = originalScore * exp(-0.023 * daysSinceUpdate)
 */
const DECAY_LAMBDA = 0.023;

/** Default minimum score threshold for pruning. */
const DEFAULT_MIN_SCORE = 0.1;

/** Maximum number of edges to process in a single batch. */
const BATCH_SIZE = 500;

/**
 * Statistics from a graph update operation.
 */
export interface EvolutionStats {
  /** Number of edges added */
  edgesAdded: number;
  /** Number of edges pruned (below threshold) */
  edgesPruned: number;
  /** Number of existing edges refreshed */
  edgesRefreshed: number;
  /** Number of new nodes created */
  nodesAdded: number;
}

/**
 * A file change descriptor for updating the graph.
 */
export interface ChangedFile {
  /** File content (for re-analysis) */
  content: string;
  /** File path */
  filePath: string;
  /** Detected language */
  language: string;
}

/**
 * Manages temporal evolution of the knowledge graph.
 *
 * Key responsibilities:
 * - Update graph edges incrementally without creating duplicates
 * - Apply exponential decay to edge relevance scores
 * - Prune edges that have decayed below a threshold
 */
export class MemoryEvolutionEngine {
  /**
   * Update the knowledge graph for changed files.
   *
   * For each changed file, refreshes existing edges (bumping their
   * updatedAt timestamp) rather than creating duplicates. New edges
   * discovered in the changes are added.
   */
  async updateGraph(
    projectId: string,
    changedFiles: ChangedFile[]
  ): Promise<EvolutionStats> {
    const start = performance.now();
    const stats: EvolutionStats = {
      edgesAdded: 0,
      edgesRefreshed: 0,
      edgesPruned: 0,
      nodesAdded: 0,
    };

    for (const file of changedFiles) {
      const fileNodeId = `file:${file.filePath}`;

      // Ensure file node exists
      const existing = await db
        .select({ id: graphNodes.id })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.projectId, projectId),
            eq(graphNodes.id, fileNodeId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db
          .insert(graphNodes)
          .values({
            id: fileNodeId,
            projectId,
            nodeType: "file",
            name: file.filePath.split("/").pop() ?? file.filePath,
            filePath: file.filePath,
            metadata: { language: file.language },
          })
          .onConflictDoNothing();
        stats.nodesAdded++;
      } else {
        await db
          .update(graphNodes)
          .set({ updatedAt: new Date() })
          .where(eq(graphNodes.id, fileNodeId));
      }

      // Refresh all edges originating from this file
      const existingEdges = await db
        .select({ id: graphEdges.id })
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.projectId, projectId),
            eq(graphEdges.sourceId, fileNodeId)
          )
        )
        .limit(1000);

      if (existingEdges.length > 0) {
        const edgeIds = existingEdges.map((e) => e.id);

        for (let i = 0; i < edgeIds.length; i += BATCH_SIZE) {
          const batch = edgeIds.slice(i, i + BATCH_SIZE);
          await db
            .update(graphEdges)
            .set({ createdAt: new Date() })
            .where(inArray(graphEdges.id, batch));
        }

        stats.edgesRefreshed += existingEdges.length;
      }

      // Extract new import edges from file content
      const imports = extractImportPaths(file.content);
      for (const importPath of imports) {
        const targetId = `file:${importPath}`;

        const edgeExists = await db
          .select({ id: graphEdges.id })
          .from(graphEdges)
          .where(
            and(
              eq(graphEdges.projectId, projectId),
              eq(graphEdges.sourceId, fileNodeId),
              eq(graphEdges.targetId, targetId),
              eq(graphEdges.edgeType, "imports")
            )
          )
          .limit(1);

        if (edgeExists.length === 0) {
          await db
            .insert(graphNodes)
            .values({
              id: targetId,
              projectId,
              nodeType: "module",
              name: importPath.split("/").pop() ?? importPath,
              filePath: importPath,
            })
            .onConflictDoNothing();

          await db.insert(graphEdges).values({
            id: `ge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            projectId,
            sourceId: fileNodeId,
            targetId,
            edgeType: "imports",
            metadata: {},
          });

          stats.edgesAdded++;
        }
      }
    }

    const elapsed = Math.round(performance.now() - start);

    logger.info(
      {
        projectId,
        fileCount: changedFiles.length,
        ...stats,
        durationMs: elapsed,
      },
      "Knowledge graph updated"
    );

    return stats;
  }

  /**
   * Compute the decayed score for an edge based on time since last update.
   *
   * Uses exponential decay: score = originalScore * exp(-lambda * days)
   * where lambda = 0.023 (30-day half-life).
   */
  computeDecayedScore(originalScore: number, daysSinceUpdate: number): number {
    return originalScore * Math.exp(-DECAY_LAMBDA * daysSinceUpdate);
  }

  /**
   * Prune stale edges from the knowledge graph.
   *
   * Removes edges whose decayed score has fallen below the given threshold.
   * An edge age is determined by its updatedAt timestamp.
   *
   * @param projectId - The project identifier
   * @param minScore - Minimum decayed score to keep (default: 0.1)
   * @returns Number of edges pruned
   */
  async pruneStaleEdges(
    projectId: string,
    minScore = DEFAULT_MIN_SCORE
  ): Promise<number> {
    const start = performance.now();

    // Calculate the cutoff date: when does score of 1.0 decay to minScore?
    // minScore = 1.0 * exp(-lambda * days) => days = -ln(minScore) / lambda
    const cutoffDays = -Math.log(minScore) / DECAY_LAMBDA;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);

    const result = await db
      .delete(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          lt(graphEdges.createdAt, cutoffDate)
        )
      )
      .returning({ id: graphEdges.id });

    const prunedCount = result.length;
    const elapsed = Math.round(performance.now() - start);

    logger.info(
      {
        projectId,
        prunedCount,
        cutoffDays: Math.round(cutoffDays),
        minScore,
        durationMs: elapsed,
      },
      `Pruned ${prunedCount} stale edges`
    );

    return prunedCount;
  }

  /**
   * Get decay statistics for a project knowledge graph.
   */
  async getDecayStats(projectId: string): Promise<{
    totalEdges: number;
    staleEdges: number;
    averageAgeDays: number;
  }> {
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphEdges)
      .where(eq(graphEdges.projectId, projectId));

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const staleResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          lt(graphEdges.createdAt, thirtyDaysAgo)
        )
      );

    const avgAgeResult = await db
      .select({
        avgAge: sql<number>`AVG(EXTRACT(EPOCH FROM (NOW() - ${graphEdges.createdAt})) / 86400)`,
      })
      .from(graphEdges)
      .where(eq(graphEdges.projectId, projectId));

    return {
      totalEdges: Number(totalResult[0]?.count ?? 0),
      staleEdges: Number(staleResult[0]?.count ?? 0),
      averageAgeDays:
        Math.round(Number(avgAgeResult[0]?.avgAge ?? 0) * 10) / 10,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

const IMPORT_PATH_RE =
  /import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/g;

function extractImportPaths(content: string): string[] {
  const paths: string[] = [];
  IMPORT_PATH_RE.lastIndex = 0;
  for (const match of content.matchAll(IMPORT_PATH_RE)) {
    if (match[1]) {
      paths.push(match[1]);
    }
  }
  return paths;
}
