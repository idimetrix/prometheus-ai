/**
 * Phase 6: Knowledge Graph — Migrated to proper graph_nodes/graph_edges tables.
 *
 * Replaces all agentMemories-based JSON blob storage with SQL queries.
 * Eliminates loadNodes()/loadEdges() O(n) full-table scans.
 * Uses SQL JOINs and recursive CTEs instead of in-memory Map operations.
 * Traversal via recursive CTE on graph_edges (up to configurable depth).
 *
 * Targets: <50ms 2-hop traversal, 500K nodes per project.
 */
import {
  type CodeFile,
  type KnowledgeGraph as CogneeKnowledgeGraph,
  CogneePipeline,
} from "@prometheus/code-intelligence";
import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, inArray, or, sql } from "drizzle-orm";

const FILE_PREFIX_STRIP_RE = /^file:/;

const logger = createLogger("project-brain:knowledge-graph");

export interface GraphNode {
  filePath: string;
  id: string;
  metadata?: Record<string, unknown>;
  name: string;
  type: "file" | "function" | "class" | "module" | "component" | "export";
}

export interface GraphEdge {
  metadata?: Record<string, unknown>;
  source: string;
  target: string;
  type:
    | "imports"
    | "calls"
    | "extends"
    | "implements"
    | "depends_on"
    | "contains"
    | "exports"
    | "uses_type";
}

export interface GraphQueryResult {
  edges: GraphEdge[];
  nodes: GraphNode[];
}

/** Result from "what calls X" or "what uses X" traversal queries. */
export interface TraversalQueryResult {
  callers: GraphNode[];
  edges: GraphEdge[];
  target: GraphNode | null;
}

/** Matches method calls like ClassName.methodName() */
const METHOD_CALL_RE = /\b([A-Z]\w+)\.(\w+)\s*\(/g;
/** Matches function calls like functionName() */
const FUNCTION_CALL_RE = /\b([a-z]\w+)\s*\(/g;
/** Matches type references in annotations */
const TYPE_USAGE_RE = /(?::\s*|as\s+|<\s*)([A-Z]\w+)(?:\s*[>,;)\]|}]|\s*$)/g;
/** Matches arrow function assignments */
const ARROW_FN_RE =
  /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?::\s*\w+(?:<[^>]+>)?\s*)?=>/g;
/** Matches interface and type definitions */
const INTERFACE_TYPE_RE =
  /(?:export\s+)?(?:interface|type)\s+(\w+)(?:\s*<[^>]+>)?\s*(?:extends\s+([\w,\s<>]+))?\s*[={]/g;

/**
 * Knowledge Graph backed by graph_nodes and graph_edges tables.
 * All queries use SQL — no in-memory loading of the full graph.
 */
export class KnowledgeGraphLayer {
  // ─── Node & Edge Persistence ─────────────────────────────────────

  async addNode(projectId: string, node: GraphNode): Promise<void> {
    const existing = await db
      .select({ id: graphNodes.id })
      .from(graphNodes)
      .where(
        and(eq(graphNodes.projectId, projectId), eq(graphNodes.id, node.id))
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(graphNodes)
        .set({
          name: node.name,
          filePath: node.filePath,
          nodeType: mapNodeType(node.type),
          metadata: node.metadata ?? {},
          updatedAt: new Date(),
        })
        .where(eq(graphNodes.id, node.id));
    } else {
      await db.insert(graphNodes).values({
        id: node.id,
        projectId,
        nodeType: mapNodeType(node.type),
        name: node.name,
        filePath: node.filePath,
        metadata: node.metadata ?? {},
      });
    }
  }

  async addEdge(projectId: string, edge: GraphEdge): Promise<void> {
    // Ensure source and target nodes exist
    const sourceExists = await db
      .select({ id: graphNodes.id })
      .from(graphNodes)
      .where(eq(graphNodes.id, edge.source))
      .limit(1);

    if (sourceExists.length === 0) {
      // Auto-create stub node for the source
      await db
        .insert(graphNodes)
        .values({
          id: edge.source,
          projectId,
          nodeType: "module",
          name: edge.source.split(":").pop() ?? edge.source,
          filePath: edge.source.replace(FILE_PREFIX_STRIP_RE, ""),
        })
        .onConflictDoNothing();
    }

    const targetExists = await db
      .select({ id: graphNodes.id })
      .from(graphNodes)
      .where(eq(graphNodes.id, edge.target))
      .limit(1);

    if (targetExists.length === 0) {
      await db
        .insert(graphNodes)
        .values({
          id: edge.target,
          projectId,
          nodeType: "module",
          name: edge.target.split(":").pop() ?? edge.target,
          filePath: edge.target.replace(FILE_PREFIX_STRIP_RE, ""),
        })
        .onConflictDoNothing();
    }

    // Check for duplicate edge
    const existingEdge = await db
      .select({ id: graphEdges.id })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.sourceId, edge.source),
          eq(graphEdges.targetId, edge.target),
          eq(graphEdges.edgeType, mapEdgeType(edge.type))
        )
      )
      .limit(1);

    if (existingEdge.length > 0) {
      return;
    }

    await db.insert(graphEdges).values({
      id: generateId("ge"),
      projectId,
      sourceId: edge.source,
      targetId: edge.target,
      edgeType: mapEdgeType(edge.type),
      metadata: edge.metadata ?? {},
    });
  }

  // ─── Query Methods (SQL-based, no full loads) ──────────────────

  async query(projectId: string, queryStr: string): Promise<GraphQueryResult> {
    const searchPattern = `%${queryStr}%`;

    // Find matching nodes via SQL ILIKE
    const matchingNodes = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          or(
            sql`${graphNodes.name} ILIKE ${searchPattern}`,
            sql`${graphNodes.filePath} ILIKE ${searchPattern}`
          )
        )
      )
      .limit(50);

    if (matchingNodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    const nodeIds = matchingNodes.map((n) => n.id);

    // Find edges touching matched nodes
    const relatedEdges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          or(
            inArray(graphEdges.sourceId, nodeIds),
            inArray(graphEdges.targetId, nodeIds)
          )
        )
      )
      .limit(200);

    // Collect additional node IDs referenced by edges
    const additionalIds = new Set<string>();
    for (const edge of relatedEdges) {
      if (!nodeIds.includes(edge.sourceId)) {
        additionalIds.add(edge.sourceId);
      }
      if (!nodeIds.includes(edge.targetId)) {
        additionalIds.add(edge.targetId);
      }
    }

    // Load additional nodes
    let additionalNodes: typeof matchingNodes = [];
    if (additionalIds.size > 0) {
      additionalNodes = await db
        .select()
        .from(graphNodes)
        .where(inArray(graphNodes.id, Array.from(additionalIds)))
        .limit(100);
    }

    const allNodes = [...matchingNodes, ...additionalNodes];

    return {
      nodes: allNodes.map(toGraphNode),
      edges: relatedEdges.map(toGraphEdge),
    };
  }

  async getDependencies(
    projectId: string,
    filePath: string
  ): Promise<GraphNode[]> {
    const nodeId = `file:${filePath}`;

    const edges = await db
      .select({ targetId: graphEdges.targetId })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.sourceId, nodeId),
          or(
            eq(graphEdges.edgeType, "imports"),
            eq(graphEdges.edgeType, "depends_on")
          )
        )
      )
      .limit(100);

    if (edges.length === 0) {
      return [];
    }

    const targetIds = edges.map((e) => e.targetId);
    const nodes = await db
      .select()
      .from(graphNodes)
      .where(inArray(graphNodes.id, targetIds));

    return nodes.map(toGraphNode);
  }

  async getDependents(
    projectId: string,
    filePath: string
  ): Promise<GraphNode[]> {
    const nodeId = `file:${filePath}`;

    const edges = await db
      .select({ sourceId: graphEdges.sourceId })
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
      )
      .limit(100);

    if (edges.length === 0) {
      return [];
    }

    const sourceIds = edges.map((e) => e.sourceId);
    const nodes = await db
      .select()
      .from(graphNodes)
      .where(inArray(graphNodes.id, sourceIds));

    return nodes.map(toGraphNode);
  }

  // ─── Graph Traversal Queries ────────────────────────────────────

  /** Find all callers of a function/method. Answers "what calls X.method". */
  async findCallers(
    projectId: string,
    entityName: string
  ): Promise<TraversalQueryResult> {
    const dotIdx = entityName.indexOf(".");
    const namePattern = dotIdx > 0 ? entityName.slice(dotIdx + 1) : entityName;
    const classPattern = dotIdx > 0 ? entityName.slice(0, dotIdx) : null;

    const targetNodes = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          sql`${graphNodes.name} ILIKE ${namePattern}`
        )
      )
      .limit(20);

    let filteredTargets = targetNodes;
    if (classPattern) {
      const filtered = targetNodes.filter((n) =>
        n.id.toLowerCase().includes(classPattern.toLowerCase())
      );
      if (filtered.length > 0) {
        filteredTargets = filtered;
      }
    }
    if (filteredTargets.length === 0) {
      return { target: null, callers: [], edges: [] };
    }

    const targetIds = filteredTargets.map((n) => n.id);
    const callEdges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.edgeType, "calls"),
          inArray(graphEdges.targetId, targetIds)
        )
      )
      .limit(200);

    if (callEdges.length === 0) {
      return {
        target: filteredTargets[0] ? toGraphNode(filteredTargets[0]) : null,
        callers: [],
        edges: [],
      };
    }

    const callerNodes = await db
      .select()
      .from(graphNodes)
      .where(
        inArray(
          graphNodes.id,
          callEdges.map((e) => e.sourceId)
        )
      );
    return {
      target: filteredTargets[0] ? toGraphNode(filteredTargets[0]) : null,
      callers: callerNodes.map(toGraphNode),
      edges: callEdges.map(toGraphEdge),
    };
  }

  /** Find all entities that use a specific type. */
  async findTypeUsages(
    projectId: string,
    typeName: string
  ): Promise<TraversalQueryResult> {
    const typeNodes = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          sql`${graphNodes.name} ILIKE ${typeName}`,
          or(
            eq(graphNodes.nodeType, "class"),
            eq(graphNodes.nodeType, "interface"),
            eq(graphNodes.nodeType, "type"),
            eq(graphNodes.nodeType, "module")
          )
        )
      )
      .limit(10);

    if (typeNodes.length === 0) {
      return { target: null, callers: [], edges: [] };
    }

    const usageEdges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          inArray(
            graphEdges.targetId,
            typeNodes.map((n) => n.id)
          ),
          or(
            eq(graphEdges.edgeType, "uses_type"),
            eq(graphEdges.edgeType, "extends"),
            eq(graphEdges.edgeType, "implements")
          )
        )
      )
      .limit(200);

    if (usageEdges.length === 0) {
      return {
        target: typeNodes[0] ? toGraphNode(typeNodes[0]) : null,
        callers: [],
        edges: [],
      };
    }

    const userNodes = await db
      .select()
      .from(graphNodes)
      .where(
        inArray(
          graphNodes.id,
          usageEdges.map((e) => e.sourceId)
        )
      );
    return {
      target: typeNodes[0] ? toGraphNode(typeNodes[0]) : null,
      callers: userNodes.map(toGraphNode),
      edges: usageEdges.map(toGraphEdge),
    };
  }

  /** Find all importers of a specific module. */
  async findImporters(
    projectId: string,
    modulePath: string
  ): Promise<TraversalQueryResult> {
    const targetPattern = `%${modulePath}%`;
    const targetNodes = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          or(
            sql`${graphNodes.id} ILIKE ${targetPattern}`,
            sql`${graphNodes.filePath} ILIKE ${targetPattern}`
          )
        )
      )
      .limit(20);

    const targetIds =
      targetNodes.length > 0
        ? targetNodes.map((n) => n.id)
        : [`file:${modulePath}`];
    const importEdges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.edgeType, "imports"),
          inArray(graphEdges.targetId, targetIds)
        )
      )
      .limit(200);

    if (importEdges.length === 0) {
      return {
        target: targetNodes[0] ? toGraphNode(targetNodes[0]) : null,
        callers: [],
        edges: [],
      };
    }

    const importerNodes = await db
      .select()
      .from(graphNodes)
      .where(
        inArray(
          graphNodes.id,
          importEdges.map((e) => e.sourceId)
        )
      );
    return {
      target: targetNodes[0] ? toGraphNode(targetNodes[0]) : null,
      callers: importerNodes.map(toGraphNode),
      edges: importEdges.map(toGraphEdge),
    };
  }

  // ─── N-Hop Traversal via Recursive CTE ─────────────────────────

  async traverseFromNode(
    projectId: string,
    startNodeId: string,
    maxHops = 2,
    _edgeTypes?: GraphEdge["type"][]
  ): Promise<GraphQueryResult> {
    try {
      return await this.traverseWithCTE(projectId, startNodeId, maxHops);
    } catch (err) {
      logger.warn(
        { err, projectId, startNodeId },
        "CTE traversal failed, falling back to iterative"
      );
      return this.traverseIterative(projectId, startNodeId, maxHops);
    }
  }

  async traverseWithCTE(
    projectId: string,
    startNodeId: string,
    maxDepth = 3
  ): Promise<GraphQueryResult> {
    const cteResults = await db.execute<{
      source_id: string;
      target_id: string;
      edge_type: string;
      depth: number;
    }>(sql`
      WITH RECURSIVE graph_walk AS (
        SELECT
          ge.source_id,
          ge.target_id,
          ge.edge_type,
          1 AS depth
        FROM graph_edges ge
        WHERE ge.project_id = ${projectId}
          AND (ge.source_id = ${startNodeId} OR ge.target_id = ${startNodeId})

        UNION ALL

        SELECT
          ge.source_id,
          ge.target_id,
          ge.edge_type,
          gw.depth + 1 AS depth
        FROM graph_edges ge
        JOIN graph_walk gw ON (
          ge.source_id = gw.target_id OR ge.source_id = gw.source_id
          OR ge.target_id = gw.target_id OR ge.target_id = gw.source_id
        )
        WHERE ge.project_id = ${projectId}
          AND gw.depth < ${maxDepth}
          AND ge.source_id != ge.target_id
      )
      SELECT DISTINCT source_id, target_id, edge_type, MIN(depth) as depth
      FROM graph_walk
      GROUP BY source_id, target_id, edge_type
      ORDER BY depth
      LIMIT 200
    `);

    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>([startNodeId]);

    for (const row of cteResults ?? []) {
      const r = row as {
        source_id: string;
        target_id: string;
        edge_type: string;
      };
      edges.push({
        source: r.source_id,
        target: r.target_id,
        type: r.edge_type as GraphEdge["type"],
      });
      nodeIds.add(r.source_id);
      nodeIds.add(r.target_id);
    }

    // Load all referenced nodes
    const nodes =
      nodeIds.size > 0
        ? await db
            .select()
            .from(graphNodes)
            .where(inArray(graphNodes.id, Array.from(nodeIds)))
        : [];

    return { nodes: nodes.map(toGraphNode), edges };
  }

  private async traverseIterative(
    projectId: string,
    startNodeId: string,
    maxHops: number
  ): Promise<GraphQueryResult> {
    const visitedNodeIds = new Set<string>();
    const collectedEdges: GraphEdge[] = [];
    let frontier = new Set<string>([startNodeId]);

    for (let hop = 0; hop < maxHops && frontier.size > 0; hop++) {
      const frontierArray = Array.from(frontier);
      for (const id of frontierArray) {
        visitedNodeIds.add(id);
      }

      const edges = await db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.projectId, projectId),
            or(
              inArray(graphEdges.sourceId, frontierArray),
              inArray(graphEdges.targetId, frontierArray)
            )
          )
        )
        .limit(500);

      const nextFrontier = new Set<string>();
      for (const edge of edges) {
        collectedEdges.push(toGraphEdge(edge));
        if (!visitedNodeIds.has(edge.sourceId)) {
          nextFrontier.add(edge.sourceId);
        }
        if (!visitedNodeIds.has(edge.targetId)) {
          nextFrontier.add(edge.targetId);
        }
      }

      frontier = nextFrontier;
    }

    // Add remaining frontier
    for (const id of frontier) {
      visitedNodeIds.add(id);
    }

    const nodes =
      visitedNodeIds.size > 0
        ? await db
            .select()
            .from(graphNodes)
            .where(inArray(graphNodes.id, Array.from(visitedNodeIds)))
        : [];

    return { nodes: nodes.map(toGraphNode), edges: collectedEdges };
  }

  async getRelatedContext(
    projectId: string,
    filePath: string,
    maxHops = 2
  ): Promise<GraphQueryResult> {
    return await this.traverseFromNode(projectId, `file:${filePath}`, maxHops);
  }

  // ─── File & Function Graphs ────────────────────────────────────

  async getFileDependencyGraph(projectId: string): Promise<GraphQueryResult> {
    const fileNodes = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.nodeType, "file")
        )
      )
      .limit(1000);

    const importEdges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          or(
            eq(graphEdges.edgeType, "imports"),
            eq(graphEdges.edgeType, "depends_on")
          )
        )
      )
      .limit(5000);

    return {
      nodes: fileNodes.map(toGraphNode),
      edges: importEdges.map(toGraphEdge),
    };
  }

  async getFunctionCallGraph(projectId: string): Promise<GraphQueryResult> {
    const fnNodes = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.nodeType, "function")
        )
      )
      .limit(2000);

    const callEdges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.edgeType, "calls")
        )
      )
      .limit(5000);

    return {
      nodes: fnNodes.map(toGraphNode),
      edges: callEdges.map(toGraphEdge),
    };
  }

  // ─── File Analysis ───────────────────────────────────────────────

  async analyzeFile(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const imports = extractImports(content);
    const exports = extractExports(content);
    const functions = extractFunctions(content);
    const classes = extractClasses(content);

    const fileNode: GraphNode = {
      id: `file:${filePath}`,
      type: "file",
      name: filePath.split("/").pop() ?? filePath,
      filePath,
      metadata: {
        imports: imports.length,
        exports: exports.length,
        functions: functions.length,
        classes: classes.length,
        loc: content.split("\n").length,
      },
    };
    await this.addNode(projectId, fileNode);

    await this.analyzeExports(projectId, filePath, fileNode, exports);
    await this.analyzeFunctions(projectId, filePath, fileNode, functions);
    await this.analyzeClasses(projectId, filePath, fileNode, classes);
    await this.analyzeArrowFunctions(projectId, filePath, fileNode, content);
    await this.analyzeInterfaceTypes(projectId, filePath, fileNode, content);
    const methodCallsSeen = await this.analyzeMethodCalls(
      projectId,
      fileNode,
      content
    );
    await this.analyzeFunctionCalls(projectId, fileNode, content, functions);
    const typesSeen = await this.analyzeTypeUsages(
      projectId,
      fileNode,
      content
    );
    await this.analyzeImportEdges(projectId, fileNode, imports);

    logger.debug(
      {
        projectId,
        filePath,
        functions: functions.length,
        classes: classes.length,
        methodCalls: methodCallsSeen.size,
        typeUsages: typesSeen.size,
      },
      "File analyzed for knowledge graph"
    );
  }

  private async analyzeExports(
    projectId: string,
    filePath: string,
    fileNode: GraphNode,
    exports: Array<{ name: string; kind: string }>
  ): Promise<void> {
    for (const exp of exports) {
      const exportNode: GraphNode = {
        id: `export:${filePath}:${exp.name}`,
        type: "export",
        name: exp.name,
        filePath,
        metadata: { kind: exp.kind },
      };
      await this.addNode(projectId, exportNode);
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: exportNode.id,
        type: "exports",
      });
    }
  }

  private async analyzeFunctions(
    projectId: string,
    filePath: string,
    fileNode: GraphNode,
    functions: Array<{ name: string; isAsync: boolean; isExported: boolean }>
  ): Promise<void> {
    for (const fn of functions) {
      const fnNode: GraphNode = {
        id: `fn:${filePath}:${fn.name}`,
        type: "function",
        name: fn.name,
        filePath,
        metadata: { async: fn.isAsync, exported: fn.isExported },
      };
      await this.addNode(projectId, fnNode);
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: fnNode.id,
        type: "contains",
      });
    }
  }

  private async analyzeClasses(
    projectId: string,
    filePath: string,
    fileNode: GraphNode,
    classes: Array<{
      name: string;
      extends?: string;
      implements?: string[];
      isAbstract: boolean;
    }>
  ): Promise<void> {
    for (const cls of classes) {
      const clsNode: GraphNode = {
        id: `class:${filePath}:${cls.name}`,
        type: "class",
        name: cls.name,
        filePath,
        metadata: { isAbstract: cls.isAbstract },
      };
      await this.addNode(projectId, clsNode);
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: clsNode.id,
        type: "contains",
      });

      if (cls.extends) {
        await this.addEdge(projectId, {
          source: clsNode.id,
          target: `class:unknown:${cls.extends}`,
          type: "extends",
        });
      }
      if (cls.implements) {
        for (const iface of cls.implements) {
          await this.addEdge(projectId, {
            source: clsNode.id,
            target: `class:unknown:${iface}`,
            type: "implements",
          });
        }
      }
    }
  }

  private async analyzeArrowFunctions(
    projectId: string,
    filePath: string,
    fileNode: GraphNode,
    content: string
  ): Promise<void> {
    for (const match of content.matchAll(ARROW_FN_RE)) {
      if (!match[1]) {
        continue;
      }
      await this.addNode(projectId, {
        id: `fn:${filePath}:${match[1]}`,
        type: "function",
        name: match[1],
        filePath,
        metadata: {
          arrowFunction: true,
          exported: match[0].startsWith("export"),
        },
      });
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: `fn:${filePath}:${match[1]}`,
        type: "contains",
      });
    }
  }

  private async analyzeInterfaceTypes(
    projectId: string,
    filePath: string,
    fileNode: GraphNode,
    content: string
  ): Promise<void> {
    for (const match of content.matchAll(INTERFACE_TYPE_RE)) {
      if (!match[1]) {
        continue;
      }
      const kind = match[0].includes("interface") ? "interface" : "type";
      await this.addNode(projectId, {
        id: `type:${filePath}:${match[1]}`,
        type: "module",
        name: match[1],
        filePath,
        metadata: { kind },
      });
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: `type:${filePath}:${match[1]}`,
        type: "contains",
      });
      if (!match[2]) {
        continue;
      }
      for (const ext of match[2]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)) {
        await this.addEdge(projectId, {
          source: `type:${filePath}:${match[1]}`,
          target: `type:unknown:${ext}`,
          type: "extends",
        });
      }
    }
  }

  private async analyzeMethodCalls(
    projectId: string,
    fileNode: GraphNode,
    content: string
  ): Promise<Set<string>> {
    const methodCallsSeen = new Set<string>();
    for (const match of content.matchAll(METHOD_CALL_RE)) {
      if (!(match[1] && match[2])) {
        continue;
      }
      const key = `${match[1]}.${match[2]}`;
      if (methodCallsSeen.has(key)) {
        continue;
      }
      methodCallsSeen.add(key);
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: `fn:unknown:${key}`,
        type: "calls",
        metadata: { className: match[1], methodName: match[2] },
      });
    }
    return methodCallsSeen;
  }

  private async analyzeFunctionCalls(
    projectId: string,
    fileNode: GraphNode,
    content: string,
    functions: Array<{ name: string }>
  ): Promise<void> {
    const fnNames = new Set(functions.map((f) => f.name));
    const callKeywords = new Set([
      "if",
      "for",
      "while",
      "switch",
      "catch",
      "return",
      "import",
      "export",
      "function",
      "class",
      "new",
      "typeof",
      "require",
      "await",
      "async",
      "yield",
    ]);
    const fnCallsSeen = new Set<string>();
    for (const match of content.matchAll(FUNCTION_CALL_RE)) {
      if (!match[1]) {
        continue;
      }
      if (
        callKeywords.has(match[1]) ||
        fnNames.has(match[1]) ||
        fnCallsSeen.has(match[1])
      ) {
        continue;
      }
      fnCallsSeen.add(match[1]);
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: `fn:unknown:${match[1]}`,
        type: "calls",
      });
    }
  }

  private async analyzeTypeUsages(
    projectId: string,
    fileNode: GraphNode,
    content: string
  ): Promise<Set<string>> {
    const builtinTypes = new Set([
      "String",
      "Number",
      "Boolean",
      "Array",
      "Object",
      "Promise",
      "Map",
      "Set",
      "Date",
      "Error",
      "RegExp",
      "Record",
      "Partial",
      "Required",
      "Omit",
      "Pick",
      "Readonly",
    ]);
    const typesSeen = new Set<string>();
    for (const match of content.matchAll(TYPE_USAGE_RE)) {
      if (!match[1] || builtinTypes.has(match[1]) || typesSeen.has(match[1])) {
        continue;
      }
      typesSeen.add(match[1]);
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: `type:unknown:${match[1]}`,
        type: "uses_type",
      });
    }
    return typesSeen;
  }

  private async analyzeImportEdges(
    projectId: string,
    fileNode: GraphNode,
    imports: Array<{
      source: string;
      specifiers: string[];
      isDefault: boolean;
      isNamespace: boolean;
    }>
  ): Promise<void> {
    for (const imp of imports) {
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: `file:${imp.source}`,
        type: "imports",
        metadata: {
          specifiers: imp.specifiers,
          isDefault: imp.isDefault,
          isNamespace: imp.isNamespace,
        },
      });
    }
  }

  // ─── Cognee Pipeline Integration ──────────────────────────────────

  /**
   * Run the Cognee pipeline on a set of files and persist the resulting
   * knowledge graph (call graph, class hierarchy, module dependencies,
   * data flow edges) into the graph_nodes/graph_edges tables.
   *
   * @param projectId - The project identifier
   * @param files - Array of files with path, content, and language
   * @returns The raw Cognee knowledge graph before persistence
   */
  async extractFromCognee(
    projectId: string,
    files: CodeFile[]
  ): Promise<CogneeKnowledgeGraph> {
    const pipeline = new CogneePipeline();
    const graph = pipeline.process(files);

    logger.info(
      {
        projectId,
        fileCount: files.length,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
      },
      "Cognee pipeline produced knowledge graph; persisting to database"
    );

    // Persist nodes
    for (const node of graph.nodes) {
      await this.addNode(projectId, {
        id: node.id,
        type: mapCogneeNodeType(node.type),
        name: node.name,
        filePath: node.filePath,
        metadata: node.metadata,
      });
    }

    // Persist edges
    for (const edge of graph.edges) {
      await this.addEdge(projectId, {
        source: edge.source,
        target: edge.target,
        type: edge.type,
        metadata: { ...edge.metadata, weight: edge.weight },
      });
    }

    logger.info(
      { projectId, nodes: graph.nodes.length, edges: graph.edges.length },
      "Cognee knowledge graph persisted"
    );

    return graph;
  }

  // ─── Bulk Operations ─────────────────────────────────────────────

  async clearProject(projectId: string): Promise<void> {
    await db.delete(graphEdges).where(eq(graphEdges.projectId, projectId));
    await db.delete(graphNodes).where(eq(graphNodes.projectId, projectId));
    logger.info({ projectId }, "Knowledge graph cleared");
  }

  async getStats(projectId: string): Promise<{
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    functionCount: number;
    classCount: number;
  }> {
    const nodeCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphNodes)
      .where(eq(graphNodes.projectId, projectId));

    const edgeCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphEdges)
      .where(eq(graphEdges.projectId, projectId));

    const fileCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.nodeType, "file")
        )
      );

    const fnCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.nodeType, "function")
        )
      );

    const classCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.nodeType, "class")
        )
      );

    return {
      nodeCount: Number(nodeCountResult[0]?.count ?? 0),
      edgeCount: Number(edgeCountResult[0]?.count ?? 0),
      fileCount: Number(fileCountResult[0]?.count ?? 0),
      functionCount: Number(fnCountResult[0]?.count ?? 0),
      classCount: Number(classCountResult[0]?.count ?? 0),
    };
  }
}

// ─── Mappers ───────────────────────────────────────────────────────

const NODE_TYPE_MAP: Record<string, string> = {
  file: "file",
  function: "function",
  class: "class",
  module: "module",
  component: "component",
  export: "module", // Map 'export' to 'module' for DB enum
};

function mapNodeType(
  type: string
):
  | "file"
  | "function"
  | "class"
  | "module"
  | "component"
  | "interface"
  | "type" {
  return (NODE_TYPE_MAP[type] ?? "module") as
    | "file"
    | "function"
    | "class"
    | "module"
    | "component"
    | "interface"
    | "type";
}

function mapEdgeType(
  type: string
):
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "depends_on"
  | "contains"
  | "exports"
  | "uses_type" {
  return type as
    | "imports"
    | "calls"
    | "extends"
    | "implements"
    | "depends_on"
    | "contains"
    | "exports"
    | "uses_type";
}

function toGraphNode(row: typeof graphNodes.$inferSelect): GraphNode {
  return {
    id: row.id,
    type: (row.nodeType ?? "module") as GraphNode["type"],
    name: row.name,
    filePath: row.filePath,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function toGraphEdge(row: typeof graphEdges.$inferSelect): GraphEdge {
  return {
    source: row.sourceId,
    target: row.targetId,
    type: (row.edgeType ?? "depends_on") as GraphEdge["type"],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

// ─── Extraction Helpers (moved from class to module level) ───────

const NAMED_IMPORT_RE = /import\s+\{([^}]+)\}\s+from\s+["'](.+?)["']/g;
const DEFAULT_IMPORT_RE = /import\s+(\w+)\s+from\s+["'](.+?)["']/g;
const NS_IMPORT_RE = /import\s+\*\s+as\s+(\w+)\s+from\s+["'](.+?)["']/g;
const EXPORT_DECL_RE =
  /export\s+(?:default\s+)?(?:abstract\s+)?(function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
const FN_DECL_RE =
  /(export\s+)?(?:default\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
const CLASS_DECL_RE =
  /(?:export\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;

interface ImportEntry {
  isDefault: boolean;
  isNamespace: boolean;
  source: string;
  specifiers: string[];
}

function extractImports(content: string): ImportEntry[] {
  const imports: ImportEntry[] = [];
  const seen = new Set<string>();

  collectNamedImports(content, seen, imports);
  collectDefaultImports(content, seen, imports);
  collectNamespaceImports(content, seen, imports);

  return imports;
}

function collectNamedImports(
  content: string,
  seen: Set<string>,
  imports: ImportEntry[]
): void {
  for (const match of content.matchAll(NAMED_IMPORT_RE)) {
    if (!(match[1] && match[2])) {
      continue;
    }
    const key = `named:${match[2]}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const specifiers = match[1]
      .split(",")
      .map((s) => s.trim().split(" as ")[0]?.trim())
      .filter((s): s is string => Boolean(s));
    imports.push({
      source: match[2],
      specifiers,
      isDefault: false,
      isNamespace: false,
    });
  }
}

function collectDefaultImports(
  content: string,
  seen: Set<string>,
  imports: ImportEntry[]
): void {
  for (const match of content.matchAll(DEFAULT_IMPORT_RE)) {
    if (!(match[1] && match[2]) || match[1].startsWith("{")) {
      continue;
    }
    const key = `default:${match[2]}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    imports.push({
      source: match[2],
      specifiers: [match[1]],
      isDefault: true,
      isNamespace: false,
    });
  }
}

function collectNamespaceImports(
  content: string,
  seen: Set<string>,
  imports: ImportEntry[]
): void {
  for (const match of content.matchAll(NS_IMPORT_RE)) {
    if (!(match[1] && match[2])) {
      continue;
    }
    const key = `ns:${match[2]}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    imports.push({
      source: match[2],
      specifiers: [match[1]],
      isDefault: false,
      isNamespace: true,
    });
  }
}

function extractExports(
  content: string
): Array<{ name: string; kind: string }> {
  const exports: Array<{ name: string; kind: string }> = [];
  for (const match of content.matchAll(EXPORT_DECL_RE)) {
    if (match[1] && match[2]) {
      exports.push({ name: match[2], kind: match[1] });
    }
  }
  return exports;
}

function extractFunctions(content: string): Array<{
  name: string;
  isAsync: boolean;
  isExported: boolean;
}> {
  const fns: Array<{ name: string; isAsync: boolean; isExported: boolean }> =
    [];
  for (const match of content.matchAll(FN_DECL_RE)) {
    if (match[3]) {
      fns.push({
        name: match[3],
        isAsync: !!match[2],
        isExported: !!match[1],
      });
    }
  }
  return fns;
}

function extractClasses(content: string): Array<{
  name: string;
  extends?: string;
  implements?: string[];
  isAbstract: boolean;
}> {
  const classes: Array<{
    name: string;
    extends?: string;
    implements?: string[];
    isAbstract: boolean;
  }> = [];
  for (const match of content.matchAll(CLASS_DECL_RE)) {
    if (match[2]) {
      classes.push({
        name: match[2],
        extends: match[3],
        implements: match[4]?.split(",").map((s) => s.trim()),
        isAbstract: !!match[1],
      });
    }
  }
  return classes;
}

/**
 * Map Cognee pipeline node types to the knowledge graph layer's node types.
 */
function mapCogneeNodeType(type: string): GraphNode["type"] {
  const mapping: Record<string, GraphNode["type"]> = {
    file: "file",
    function: "function",
    class: "class",
    module: "module",
    interface: "module",
    type: "module",
    variable: "module",
    component: "component",
    export: "export",
  };
  return mapping[type] ?? "module";
}
