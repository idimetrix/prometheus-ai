/**
 * MOON-049: Knowledge Graph Manager
 *
 * High-level manager for building and querying a fully populated
 * knowledge graph of a codebase. Provides natural-language query
 * capabilities, relationship discovery, and graph statistics.
 *
 * Builds on the existing KnowledgeGraphLayer, ProjectGraph, and
 * CogneeEngine infrastructure to offer a unified API surface.
 */
import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, ilike, sql } from "drizzle-orm";

const logger = createLogger("project-brain:knowledge-graph-manager");

const NON_ALPHA_RE = /[^a-z0-9\s_-]/g;
const WHITESPACE_RE = /\s+/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphBuildResult {
  /** Node counts grouped by type */
  categories: Record<string, number>;
  /** Total number of edges */
  edges: number;
  /** Total number of nodes */
  nodes: number;
}

export interface GraphQueryResult {
  /** Natural-language answer */
  answer: string;
  /** Confidence in the answer (0-1) */
  confidence: number;
  /** Nodes related to the answer */
  relatedNodes: Array<{ name: string; path?: string; type: string }>;
}

export interface FileRelationships {
  /** Functions/methods this file calls in other files */
  calledBy: string[];
  /** Functions/methods that call into this file */
  callsTo: string[];
  /** Documentation files referencing this file */
  docs: string[];
  /** Files that import this file */
  importedBy: string[];
  /** Files imported by this file */
  imports: string[];
  /** Test files covering this file */
  tests: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_FILE_RE = /\.(test|spec|__test__|__spec__)\.(ts|tsx|js|jsx)$/;
const DOC_FILE_RE = /\.(md|mdx|rst|txt)$/;

// ---------------------------------------------------------------------------
// KnowledgeGraphManager
// ---------------------------------------------------------------------------

export class KnowledgeGraphManager {
  /**
   * Build (or refresh) the knowledge graph for a project.
   * Scans the graph_nodes and graph_edges tables and returns statistics.
   */
  async buildGraph(projectId: string): Promise<GraphBuildResult> {
    logger.info({ projectId }, "Building knowledge graph statistics");

    // Count nodes grouped by type
    const nodeCountRows = await db
      .select({
        nodeType: graphNodes.nodeType,
        count: sql<number>`count(*)`,
      })
      .from(graphNodes)
      .where(eq(graphNodes.projectId, projectId))
      .groupBy(graphNodes.nodeType);

    const categories: Record<string, number> = {};
    let totalNodes = 0;
    for (const row of nodeCountRows) {
      const count = Number(row.count);
      categories[row.nodeType] = count;
      totalNodes += count;
    }

    // Count edges
    const edgeCountRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphEdges)
      .where(eq(graphEdges.projectId, projectId));

    const totalEdges = Number(edgeCountRows[0]?.count ?? 0);

    logger.info(
      { projectId, nodes: totalNodes, edges: totalEdges },
      "Knowledge graph build complete"
    );

    return {
      nodes: totalNodes,
      edges: totalEdges,
      categories,
    };
  }

  /**
   * Query the knowledge graph using a natural-language question.
   * Uses keyword extraction + graph traversal to find relevant nodes,
   * then synthesizes an answer from the graph structure.
   */
  async query(projectId: string, question: string): Promise<GraphQueryResult> {
    logger.info(
      { projectId, question: question.slice(0, 100) },
      "Querying knowledge graph"
    );

    // Extract keywords from the question
    const keywords = this.extractKeywords(question);

    if (keywords.length === 0) {
      return {
        answer: "Could not extract meaningful keywords from the question.",
        relatedNodes: [],
        confidence: 0,
      };
    }

    // Search for matching nodes
    const matchingNodes = await this.searchNodes(projectId, keywords);

    if (matchingNodes.length === 0) {
      return {
        answer: `No relevant code entities found for: "${question}"`,
        relatedNodes: [],
        confidence: 0.1,
      };
    }

    // Get edges connecting matched nodes to discover relationships
    const nodeIds = matchingNodes.map((n) => n.id);
    const relatedEdges = await this.getRelatedEdges(projectId, nodeIds);

    // Build the answer from graph structure
    const answer = this.synthesizeAnswer(question, matchingNodes, relatedEdges);

    const relatedNodes = matchingNodes.slice(0, 20).map((n) => ({
      type: n.nodeType,
      name: n.name,
      path: n.filePath || undefined,
    }));

    // Confidence is based on how many matches we found
    const confidence = Math.min(matchingNodes.length / 10, 1.0);

    logger.debug(
      { projectId, matchCount: matchingNodes.length, confidence },
      "Knowledge graph query complete"
    );

    return { answer, relatedNodes, confidence };
  }

  /**
   * Get all relationships for a specific file in the knowledge graph.
   */
  async getRelated(
    projectId: string,
    filePath: string
  ): Promise<FileRelationships> {
    logger.debug({ projectId, filePath }, "Getting file relationships");

    // Find the file node
    const fileNodes = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.filePath, filePath),
          eq(graphNodes.nodeType, "file")
        )
      )
      .limit(1);

    const fileNode = fileNodes[0];
    if (!fileNode) {
      return {
        imports: [],
        importedBy: [],
        callsTo: [],
        calledBy: [],
        tests: [],
        docs: [],
      };
    }

    // Get outgoing edges (imports, calls)
    const outgoing = await db
      .select({
        edgeType: graphEdges.edgeType,
        targetId: graphEdges.targetId,
      })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.sourceId, fileNode.id)
        )
      )
      .limit(500);

    // Get incoming edges (importedBy, calledBy)
    const incoming = await db
      .select({
        edgeType: graphEdges.edgeType,
        sourceId: graphEdges.sourceId,
      })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.targetId, fileNode.id)
        )
      )
      .limit(500);

    // Resolve node IDs to file paths
    const allNodeIds = new Set<string>();
    for (const e of outgoing) {
      allNodeIds.add(e.targetId);
    }
    for (const e of incoming) {
      allNodeIds.add(e.sourceId);
    }

    const nodeMap = await this.resolveNodePaths(
      projectId,
      Array.from(allNodeIds)
    );

    // Categorize relationships
    const imports: string[] = [];
    const callsTo: string[] = [];
    for (const edge of outgoing) {
      const targetPath = nodeMap.get(edge.targetId);
      if (!targetPath) {
        continue;
      }
      if (edge.edgeType === "imports" || edge.edgeType === "depends_on") {
        imports.push(targetPath);
      } else if (edge.edgeType === "calls") {
        callsTo.push(targetPath);
      }
    }

    const importedBy: string[] = [];
    const calledBy: string[] = [];
    for (const edge of incoming) {
      const sourcePath = nodeMap.get(edge.sourceId);
      if (!sourcePath) {
        continue;
      }
      if (edge.edgeType === "imports" || edge.edgeType === "depends_on") {
        importedBy.push(sourcePath);
      } else if (edge.edgeType === "calls") {
        calledBy.push(sourcePath);
      }
    }

    // Find test files: files in the project that match test patterns
    // and have edges to this file
    const tests = importedBy.filter((p) => TEST_FILE_RE.test(p));
    const docs = importedBy.filter((p) => DOC_FILE_RE.test(p));

    logger.debug(
      {
        filePath,
        imports: imports.length,
        importedBy: importedBy.length,
        callsTo: callsTo.length,
        calledBy: calledBy.length,
        tests: tests.length,
        docs: docs.length,
      },
      "File relationships resolved"
    );

    return { imports, importedBy, callsTo, calledBy, tests, docs };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private extractKeywords(question: string): string[] {
    const stopWords = new Set([
      "a",
      "an",
      "the",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "shall",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "above",
      "below",
      "between",
      "out",
      "off",
      "over",
      "under",
      "again",
      "further",
      "then",
      "once",
      "here",
      "there",
      "when",
      "where",
      "why",
      "how",
      "all",
      "each",
      "every",
      "both",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "nor",
      "not",
      "only",
      "own",
      "same",
      "so",
      "than",
      "too",
      "very",
      "what",
      "which",
      "who",
      "whom",
      "this",
      "that",
      "these",
      "those",
      "am",
      "and",
      "but",
      "if",
      "or",
      "because",
      "about",
      "it",
      "its",
    ]);

    return question
      .toLowerCase()
      .replace(NON_ALPHA_RE, " ")
      .split(WHITESPACE_RE)
      .filter((w) => w.length > 2 && !stopWords.has(w));
  }

  private async searchNodes(
    projectId: string,
    keywords: string[]
  ): Promise<
    Array<{ filePath: string; id: string; name: string; nodeType: string }>
  > {
    const results: Array<{
      filePath: string;
      id: string;
      name: string;
      nodeType: string;
    }> = [];

    for (const keyword of keywords.slice(0, 5)) {
      const rows = await db
        .select({
          id: graphNodes.id,
          name: graphNodes.name,
          nodeType: graphNodes.nodeType,
          filePath: graphNodes.filePath,
        })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.projectId, projectId),
            ilike(graphNodes.name, `%${keyword}%`)
          )
        )
        .limit(20);

      for (const row of rows) {
        if (!results.some((r) => r.id === row.id)) {
          results.push(row);
        }
      }
    }

    return results;
  }

  private async getRelatedEdges(
    projectId: string,
    nodeIds: string[]
  ): Promise<Array<{ edgeType: string; sourceId: string; targetId: string }>> {
    if (nodeIds.length === 0) {
      return [];
    }

    // Query edges where either source or target is in our node set
    const batchSize = 50;
    const edges: Array<{
      edgeType: string;
      sourceId: string;
      targetId: string;
    }> = [];

    for (let i = 0; i < nodeIds.length; i += batchSize) {
      const batch = nodeIds.slice(i, i + batchSize);
      const rows = await db
        .select({
          sourceId: graphEdges.sourceId,
          targetId: graphEdges.targetId,
          edgeType: graphEdges.edgeType,
        })
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.projectId, projectId),
            sql`(${graphEdges.sourceId} = ANY(${batch}) OR ${graphEdges.targetId} = ANY(${batch}))`
          )
        )
        .limit(200);

      for (const row of rows) {
        edges.push(row);
      }
    }

    return edges;
  }

  private synthesizeAnswer(
    _question: string,
    nodes: Array<{
      filePath: string;
      id: string;
      name: string;
      nodeType: string;
    }>,
    edges: Array<{ edgeType: string; sourceId: string; targetId: string }>
  ): string {
    const parts: string[] = [];

    // Group nodes by type
    const byType: Record<string, string[]> = {};
    for (const node of nodes) {
      const list = byType[node.nodeType] ?? [];
      list.push(node.name);
      byType[node.nodeType] = list;
    }

    parts.push(
      `Found ${nodes.length} relevant entities across ${Object.keys(byType).length} categories.`
    );

    for (const [type, names] of Object.entries(byType)) {
      const displayed = names.slice(0, 5);
      const suffix = names.length > 5 ? ` and ${names.length - 5} more` : "";
      parts.push(`${type}: ${displayed.join(", ")}${suffix}`);
    }

    if (edges.length > 0) {
      // Summarize edge types
      const edgeTypes: Record<string, number> = {};
      for (const edge of edges) {
        edgeTypes[edge.edgeType] = (edgeTypes[edge.edgeType] ?? 0) + 1;
      }

      const edgeSummary = Object.entries(edgeTypes)
        .map(([type, count]) => `${type} (${count})`)
        .join(", ");
      parts.push(`Relationships: ${edgeSummary}`);
    }

    return parts.join("\n");
  }

  private async resolveNodePaths(
    projectId: string,
    nodeIds: string[]
  ): Promise<Map<string, string>> {
    const pathMap = new Map<string, string>();
    if (nodeIds.length === 0) {
      return pathMap;
    }

    const batchSize = 100;
    for (let i = 0; i < nodeIds.length; i += batchSize) {
      const batch = nodeIds.slice(i, i + batchSize);
      const rows = await db
        .select({
          id: graphNodes.id,
          filePath: graphNodes.filePath,
        })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.projectId, projectId),
            sql`${graphNodes.id} = ANY(${batch})`
          )
        );

      for (const row of rows) {
        if (row.filePath) {
          pathMap.set(row.id, row.filePath);
        }
      }
    }

    return pathMap;
  }
}
