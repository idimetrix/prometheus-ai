/**
 * Phase 3.2: Project Graph API.
 *
 * High-level APIs for querying the project dependency graph.
 * Uses the KnowledgeGraphLayer internally for all DB operations.
 * Provides file imports, dependents, symbol usage, impact analysis,
 * full module graph, and file complexity information.
 */
import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import type { KnowledgeGraphLayer } from "../layers/knowledge-graph";

const logger = createLogger("project-brain:project-graph");

export interface SymbolUsage {
  /** File where the symbol is used */
  filePath: string;
  /** Node ID of the usage site */
  nodeId: string;
  /** Import specifier details if applicable */
  specifiers?: string[];
  /** How the symbol is referenced (import specifier, call, etc.) */
  usageType: "import" | "call" | "extends" | "implements" | "uses_type";
}

export interface ModuleGraph {
  /** Number of strongly connected components (cycles) */
  cycleCount: number;
  /** All import/dependency edges */
  edges: ModuleEdge[];
  /** Entry point files (no incoming imports) */
  entryPoints: string[];
  /** Leaf files (no outgoing imports) */
  leaves: string[];
  /** All file nodes in the graph */
  nodes: ModuleNode[];
}

export interface ModuleNode {
  /** Number of files that import this module */
  dependentCount: number;
  filePath: string;
  /** Number of files this module imports */
  importCount: number;
  nodeId: string;
}

export interface ModuleEdge {
  edgeType: string;
  metadata?: Record<string, unknown>;
  source: string;
  target: string;
}

export interface FileComplexityInfo {
  /** Number of classes */
  classCount: number;
  /** Coupling score: (dependentCount + dependencyCount) / total files */
  couplingScore: number;
  /** Number of files this file depends on */
  dependencyCount: number;
  /** Number of files that depend on this file */
  dependentCount: number;
  /** Number of exports */
  exportCount: number;
  filePath: string;
  /** Number of functions/methods in the file */
  functionCount: number;
  /** Number of imports */
  importCount: number;
  /** Lines of code (if stored in metadata) */
  linesOfCode: number;
}

/**
 * ProjectGraph provides high-level APIs for querying the project
 * dependency graph and performing impact analysis.
 */
export class ProjectGraph {
  private readonly knowledgeGraph: KnowledgeGraphLayer;

  constructor(knowledgeGraph: KnowledgeGraphLayer) {
    this.knowledgeGraph = knowledgeGraph;
  }

  /**
   * Get all files imported by a given file.
   */
  async getFileImports(projectId: string, filePath: string): Promise<string[]> {
    const deps = await this.knowledgeGraph.getDependencies(projectId, filePath);
    return deps.map((n) => n.filePath).filter(Boolean);
  }

  /**
   * Get all files that import a given file.
   */
  async getFileDependents(
    projectId: string,
    filePath: string
  ): Promise<string[]> {
    const deps = await this.knowledgeGraph.getDependents(projectId, filePath);
    return deps.map((n) => n.filePath).filter(Boolean);
  }

  /**
   * Find all usages of a symbol across the project.
   */
  async getSymbolUsages(
    projectId: string,
    symbolName: string
  ): Promise<SymbolUsage[]> {
    const usages: SymbolUsage[] = [];

    // Find all edges that reference this symbol in their metadata
    // First, find nodes matching the symbol name
    const symbolNodes = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.name, symbolName)
        )
      )
      .limit(50);

    if (symbolNodes.length === 0) {
      return usages;
    }

    const symbolNodeIds = symbolNodes.map((n) => n.id);

    // Find all edges pointing to these symbol nodes
    const edges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          or(
            inArray(graphEdges.targetId, symbolNodeIds),
            inArray(graphEdges.sourceId, symbolNodeIds)
          )
        )
      )
      .limit(200);

    for (const edge of edges) {
      // For import edges, the source file imports the symbol
      if (
        edge.edgeType === "imports" &&
        symbolNodeIds.includes(edge.targetId)
      ) {
        const sourceNode = await db
          .select()
          .from(graphNodes)
          .where(eq(graphNodes.id, edge.sourceId))
          .limit(1);

        if (sourceNode.length > 0 && sourceNode[0]) {
          const metadata = (edge.metadata ?? {}) as Record<string, unknown>;
          usages.push({
            filePath: sourceNode[0].filePath,
            nodeId: edge.sourceId,
            usageType: "import",
            specifiers: (metadata.specifiers as string[]) ?? [],
          });
        }
      }

      // For call edges
      if (edge.edgeType === "calls" && symbolNodeIds.includes(edge.targetId)) {
        const sourceNode = await db
          .select()
          .from(graphNodes)
          .where(eq(graphNodes.id, edge.sourceId))
          .limit(1);

        if (sourceNode.length > 0 && sourceNode[0]) {
          usages.push({
            filePath: sourceNode[0].filePath,
            nodeId: edge.sourceId,
            usageType: "call",
          });
        }
      }

      // For extends/implements edges
      if (
        (edge.edgeType === "extends" || edge.edgeType === "implements") &&
        symbolNodeIds.includes(edge.targetId)
      ) {
        const sourceNode = await db
          .select()
          .from(graphNodes)
          .where(eq(graphNodes.id, edge.sourceId))
          .limit(1);

        if (sourceNode.length > 0 && sourceNode[0]) {
          usages.push({
            filePath: sourceNode[0].filePath,
            nodeId: edge.sourceId,
            usageType: edge.edgeType as "extends" | "implements",
          });
        }
      }

      // For uses_type edges
      if (
        edge.edgeType === "uses_type" &&
        symbolNodeIds.includes(edge.targetId)
      ) {
        const sourceNode = await db
          .select()
          .from(graphNodes)
          .where(eq(graphNodes.id, edge.sourceId))
          .limit(1);

        if (sourceNode.length > 0 && sourceNode[0]) {
          usages.push({
            filePath: sourceNode[0].filePath,
            nodeId: edge.sourceId,
            usageType: "uses_type",
          });
        }
      }
    }

    logger.debug(
      { projectId, symbolName, usageCount: usages.length },
      "Symbol usages found"
    );

    return usages;
  }

  /**
   * Impact analysis: find all files transitively affected by changes
   * to the given set of files.
   *
   * Uses BFS traversal over the reverse dependency graph.
   */
  async getAffectedFiles(
    projectId: string,
    changedFiles: string[]
  ): Promise<string[]> {
    const affected = new Set<string>();
    const visited = new Set<string>();
    let frontier = new Set(changedFiles);

    // BFS over reverse dependency edges
    while (frontier.size > 0) {
      const nextFrontier = new Set<string>();

      for (const filePath of frontier) {
        if (visited.has(filePath)) {
          continue;
        }
        visited.add(filePath);
        affected.add(filePath);

        // Find all files that import this file
        const dependents = await this.getFileDependents(projectId, filePath);
        for (const dep of dependents) {
          if (!visited.has(dep)) {
            nextFrontier.add(dep);
          }
        }
      }

      frontier = nextFrontier;
    }

    // Remove the original changed files from the result
    for (const f of changedFiles) {
      affected.delete(f);
    }

    const result = Array.from(affected);

    logger.info(
      {
        projectId,
        changedFiles: changedFiles.length,
        affectedFiles: result.length,
      },
      "Impact analysis complete"
    );

    return result;
  }

  /**
   * Get the full module dependency graph as a DAG.
   */
  async getModuleGraph(projectId: string): Promise<ModuleGraph> {
    const graphResult =
      await this.knowledgeGraph.getFileDependencyGraph(projectId);

    // Build adjacency maps
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();

    for (const node of graphResult.nodes) {
      outgoing.set(node.filePath, new Set());
      incoming.set(node.filePath, new Set());
    }

    const edges: ModuleEdge[] = [];
    for (const edge of graphResult.edges) {
      const sourceNode = graphResult.nodes.find((n) => n.id === edge.source);
      const targetNode = graphResult.nodes.find((n) => n.id === edge.target);

      if (sourceNode && targetNode) {
        outgoing.get(sourceNode.filePath)?.add(targetNode.filePath);
        incoming.get(targetNode.filePath)?.add(sourceNode.filePath);

        edges.push({
          source: sourceNode.filePath,
          target: targetNode.filePath,
          edgeType: edge.type,
          metadata: edge.metadata,
        });
      }
    }

    // Build module nodes with counts
    const nodes: ModuleNode[] = graphResult.nodes.map((n) => ({
      filePath: n.filePath,
      nodeId: n.id,
      importCount: outgoing.get(n.filePath)?.size ?? 0,
      dependentCount: incoming.get(n.filePath)?.size ?? 0,
    }));

    // Find entry points (no incoming imports)
    const entryPoints = nodes
      .filter((n) => n.dependentCount === 0 && n.importCount > 0)
      .map((n) => n.filePath);

    // Find leaves (no outgoing imports)
    const leaves = nodes
      .filter((n) => n.importCount === 0 && n.dependentCount > 0)
      .map((n) => n.filePath);

    // Detect cycles using Tarjan's algorithm (simplified)
    const cycleCount = this.detectCycles(outgoing);

    logger.debug(
      {
        projectId,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        entryPoints: entryPoints.length,
        leaves: leaves.length,
        cycleCount,
      },
      "Module graph computed"
    );

    return {
      nodes,
      edges,
      cycleCount,
      entryPoints,
      leaves,
    };
  }

  /**
   * Get aggregated complexity info for a file.
   */
  async getFileComplexity(
    projectId: string,
    filePath: string
  ): Promise<FileComplexityInfo> {
    const nodeId = `file:${filePath}`;

    // Get the file node metadata
    const fileNodeRows = await db
      .select()
      .from(graphNodes)
      .where(
        and(eq(graphNodes.projectId, projectId), eq(graphNodes.id, nodeId))
      )
      .limit(1);

    const metadata = (fileNodeRows[0]?.metadata ?? {}) as Record<
      string,
      unknown
    >;

    // Count contained functions
    const containedNodes = await db
      .select({ nodeType: graphNodes.nodeType })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.filePath, filePath)
        )
      );

    let functionCount = 0;
    let classCount = 0;
    for (const n of containedNodes) {
      if (n.nodeType === "function") {
        functionCount++;
      }
      if (n.nodeType === "class") {
        classCount++;
      }
    }

    // Count imports (outgoing edges)
    const outEdges = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.sourceId, nodeId),
          eq(graphEdges.edgeType, "imports")
        )
      );

    // Count export edges
    const exportEdges = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.sourceId, nodeId),
          eq(graphEdges.edgeType, "exports")
        )
      );

    // Count dependents (incoming edges)
    const inEdges = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.targetId, nodeId),
          or(
            eq(graphEdges.edgeType, "imports"),
            eq(graphEdges.edgeType, "depends_on")
          )
        )
      );

    // Total file count for coupling score
    const totalFiles = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.nodeType, "file")
        )
      );

    const importCount = Number(outEdges[0]?.count ?? 0);
    const exportCount = Number(exportEdges[0]?.count ?? 0);
    const dependentCount = Number(inEdges[0]?.count ?? 0);
    const dependencyCount = importCount;
    const totalFileCount = Math.max(Number(totalFiles[0]?.count ?? 1), 1);
    const linesOfCode = Number(metadata.loc ?? 0);

    const couplingScore = (dependentCount + dependencyCount) / totalFileCount;

    return {
      filePath,
      functionCount,
      classCount,
      importCount,
      exportCount,
      dependentCount,
      dependencyCount,
      linesOfCode,
      couplingScore,
    };
  }

  /**
   * Simple cycle detection using iterative DFS.
   * Returns the number of back edges found (approximate cycle count).
   */
  private detectCycles(adjacency: Map<string, Set<string>>): number {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    let cycleCount = 0;

    for (const node of adjacency.keys()) {
      if (visited.has(node)) {
        continue;
      }

      // Iterative DFS
      const stack: Array<{ node: string; iterator: Iterator<string> }> = [];
      stack.push({
        node,
        iterator: (adjacency.get(node) ?? new Set()).values(),
      });
      visited.add(node);
      inStack.add(node);

      while (stack.length > 0) {
        const current = stack.at(-1) as {
          node: string;
          iterator: Iterator<string>;
        };
        const next = current.iterator.next();

        if (next.done) {
          inStack.delete(current.node);
          stack.pop();
          continue;
        }

        const neighbor = next.value;
        if (inStack.has(neighbor)) {
          cycleCount++;
        } else if (!visited.has(neighbor)) {
          visited.add(neighbor);
          inStack.add(neighbor);
          stack.push({
            node: neighbor,
            iterator: (adjacency.get(neighbor) ?? new Set()).values(),
          });
        }
      }
    }

    return cycleCount;
  }
}
