import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, sql } from "drizzle-orm";

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
    | "exports";
}

export interface GraphQueryResult {
  edges: GraphEdge[];
  nodes: GraphNode[];
}

/**
 * Knowledge Graph stored using agent_memories table with memoryType = 'architectural'.
 * Nodes and edges are stored as JSONB in the content field.
 *
 * Phase 9.1 enhancements:
 *  - File dependency graph (track imports/exports)
 *  - Function call graph
 *  - Graph traversal for context (find related files within N hops)
 *  - Recursive CTE-based graph queries via Drizzle raw SQL
 *  - Edges stored with JSONB metadata for richer relationships
 */
export class KnowledgeGraphLayer {
  // ─── Node & Edge Persistence ─────────────────────────────────────

  private async loadNodes(projectId: string): Promise<Map<string, GraphNode>> {
    const results = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE 'graph:nodes:%'`
        )
      );

    const nodeMap = new Map<string, GraphNode>();
    for (const row of results) {
      const json = row.content.slice("graph:nodes:".length);
      try {
        const node = JSON.parse(json) as GraphNode;
        nodeMap.set(node.id, node);
      } catch {
        // skip malformed
      }
    }
    return nodeMap;
  }

  private async loadEdges(projectId: string): Promise<GraphEdge[]> {
    const results = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE 'graph:edge:%'`
        )
      );

    const edges: GraphEdge[] = [];
    for (const row of results) {
      const json = row.content.slice("graph:edge:".length);
      try {
        edges.push(JSON.parse(json) as GraphEdge);
      } catch {
        // skip malformed
      }
    }
    return edges;
  }

  async addNode(projectId: string, node: GraphNode): Promise<void> {
    const content = `graph:nodes:${JSON.stringify(node)}`;

    // Check if node already exists by looking for its ID
    const existing = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE ${`graph:nodes:${JSON.stringify({ id: node.id }).slice(0, -1)}%`}`
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(agentMemories)
        .set({ content })
        .where(eq(agentMemories.id, (existing[0] as (typeof existing)[0]).id));
    } else {
      await db.insert(agentMemories).values({
        id: generateId("gn"),
        projectId,
        memoryType: "architectural",
        content,
      });
    }
  }

  async addEdge(projectId: string, edge: GraphEdge): Promise<void> {
    const content = `graph:edge:${JSON.stringify(edge)}`;

    // Check for duplicate edge (same source, target, type)
    const existing = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} = ${content}`
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return; // Edge already exists
    }

    await db.insert(agentMemories).values({
      id: generateId("ge"),
      projectId,
      memoryType: "architectural",
      content,
    });
  }

  // ─── Basic Queries ───────────────────────────────────────────────

  async query(projectId: string, queryStr: string): Promise<GraphQueryResult> {
    const allNodes = await this.loadNodes(projectId);
    const allEdges = await this.loadEdges(projectId);

    const lowerQuery = queryStr.toLowerCase();

    // Find matching nodes
    const matchingNodes: GraphNode[] = [];
    for (const node of allNodes.values()) {
      if (
        node.name.toLowerCase().includes(lowerQuery) ||
        node.filePath.toLowerCase().includes(lowerQuery) ||
        node.id.toLowerCase().includes(lowerQuery)
      ) {
        matchingNodes.push(node);
      }
    }

    // Find related edges (edges touching matching nodes)
    const nodeIds = new Set(matchingNodes.map((n) => n.id));
    const relatedEdges = allEdges.filter(
      (e) => nodeIds.has(e.source) || nodeIds.has(e.target)
    );

    // Also include nodes referenced by edges but not in the initial match
    for (const edge of relatedEdges) {
      if (!nodeIds.has(edge.source)) {
        const node = allNodes.get(edge.source);
        if (node) {
          matchingNodes.push(node);
          nodeIds.add(node.id);
        }
      }
      if (!nodeIds.has(edge.target)) {
        const node = allNodes.get(edge.target);
        if (node) {
          matchingNodes.push(node);
          nodeIds.add(node.id);
        }
      }
    }

    return { nodes: matchingNodes, edges: relatedEdges };
  }

  async getDependencies(
    projectId: string,
    filePath: string
  ): Promise<GraphNode[]> {
    const nodeId = `file:${filePath}`;
    const allEdges = await this.loadEdges(projectId);
    const allNodes = await this.loadNodes(projectId);

    const depIds = allEdges
      .filter(
        (e) =>
          e.source === nodeId &&
          (e.type === "imports" || e.type === "depends_on")
      )
      .map((e) => e.target);

    return depIds
      .map((id) => allNodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  async getDependents(
    projectId: string,
    filePath: string
  ): Promise<GraphNode[]> {
    const nodeId = `file:${filePath}`;
    const allEdges = await this.loadEdges(projectId);
    const allNodes = await this.loadNodes(projectId);

    const depIds = allEdges
      .filter(
        (e) =>
          e.target === nodeId &&
          (e.type === "imports" || e.type === "depends_on")
      )
      .map((e) => e.source);

    return depIds
      .map((id) => allNodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  // ─── Phase 9.1: N-Hop Graph Traversal ────────────────────────────

  /**
   * Traverse the graph from a starting node, returning all nodes and edges
   * within N hops. Uses BFS for breadth-first exploration.
   *
   * This provides rich context: "What files/functions/classes are related
   * to this file within 2-3 hops?"
   */
  async traverseFromNode(
    projectId: string,
    startNodeId: string,
    maxHops = 2,
    edgeTypes?: GraphEdge["type"][]
  ): Promise<GraphQueryResult> {
    const allNodes = await this.loadNodes(projectId);
    const allEdges = await this.loadEdges(projectId);

    const visitedNodeIds = new Set<string>();
    const collectedEdges: GraphEdge[] = [];
    let frontier = new Set<string>([startNodeId]);

    for (let hop = 0; hop < maxHops && frontier.size > 0; hop++) {
      const nextFrontier = new Set<string>();

      for (const nodeId of frontier) {
        if (visitedNodeIds.has(nodeId)) {
          continue;
        }
        visitedNodeIds.add(nodeId);

        // Find all edges touching this node
        for (const edge of allEdges) {
          const matchesType = !edgeTypes || edgeTypes.includes(edge.type);
          if (!matchesType) {
            continue;
          }

          if (edge.source === nodeId && !visitedNodeIds.has(edge.target)) {
            nextFrontier.add(edge.target);
            collectedEdges.push(edge);
          }
          if (edge.target === nodeId && !visitedNodeIds.has(edge.source)) {
            nextFrontier.add(edge.source);
            collectedEdges.push(edge);
          }
        }
      }

      frontier = nextFrontier;
    }

    // Include last frontier nodes as visited
    for (const nodeId of frontier) {
      visitedNodeIds.add(nodeId);
    }

    const collectedNodes = Array.from(visitedNodeIds)
      .map((id) => allNodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);

    return { nodes: collectedNodes, edges: collectedEdges };
  }

  /**
   * Traverse from a file path, finding all related context within N hops.
   * Convenience wrapper around traverseFromNode.
   */
  async getRelatedContext(
    projectId: string,
    filePath: string,
    maxHops = 2
  ): Promise<GraphQueryResult> {
    return await this.traverseFromNode(projectId, `file:${filePath}`, maxHops);
  }

  /**
   * Recursive CTE-based graph query using Drizzle raw SQL.
   * Finds all nodes reachable from a start node within N hops, entirely in SQL.
   * Falls back to in-memory BFS if CTE fails (e.g., non-Postgres).
   */
  async traverseWithCTE(
    projectId: string,
    startNodeId: string,
    maxDepth = 3
  ): Promise<GraphQueryResult> {
    try {
      // Use a recursive CTE to traverse graph edges stored in agent_memories
      const cteResults = await db.execute<{
        content: string;
        depth: number;
      }>(sql`
        WITH RECURSIVE graph_walk AS (
          -- Base case: edges starting from our node
          SELECT
            am.content,
            1 AS depth
          FROM agent_memories am
          WHERE am.project_id = ${projectId}
            AND am.memory_type = 'architectural'
            AND am.content LIKE 'graph:edge:%'
            AND (
              am.content LIKE ${`%${JSON.stringify({ source: startNodeId }).slice(0, -1)}%`}
              OR am.content LIKE ${`%${JSON.stringify({ target: startNodeId }).slice(0, -1)}%`}
            )

          UNION ALL

          -- Recursive case: edges touching previously found nodes
          SELECT
            am.content,
            gw.depth + 1 AS depth
          FROM agent_memories am
          CROSS JOIN graph_walk gw
          WHERE am.project_id = ${projectId}
            AND am.memory_type = 'architectural'
            AND am.content LIKE 'graph:edge:%'
            AND gw.depth < ${maxDepth}
            AND am.content != gw.content
        )
        SELECT DISTINCT content, MIN(depth) as depth
        FROM graph_walk
        GROUP BY content
        ORDER BY depth
        LIMIT 200
      `);

      // Parse CTE results into edges
      const edges: GraphEdge[] = [];
      const referencedNodeIds = new Set<string>();
      referencedNodeIds.add(startNodeId);

      for (const row of cteResults ?? []) {
        const json = (row as { content: string }).content.slice(
          "graph:edge:".length
        );
        try {
          const edge = JSON.parse(json) as GraphEdge;
          edges.push(edge);
          referencedNodeIds.add(edge.source);
          referencedNodeIds.add(edge.target);
        } catch {
          // skip malformed
        }
      }

      // Load referenced nodes
      const allNodes = await this.loadNodes(projectId);
      const nodes = Array.from(referencedNodeIds)
        .map((id) => allNodes.get(id))
        .filter((n): n is GraphNode => n !== undefined);

      return { nodes, edges };
    } catch (err) {
      logger.warn(
        { err, projectId, startNodeId },
        "CTE traversal failed, falling back to BFS"
      );
      return this.traverseFromNode(projectId, startNodeId, maxDepth);
    }
  }

  // ─── Phase 9.1: File Dependency Graph ────────────────────────────

  /**
   * Build a file dependency graph for the entire project.
   * Returns only file-level nodes with import edges between them.
   */
  async getFileDependencyGraph(projectId: string): Promise<GraphQueryResult> {
    const allNodes = await this.loadNodes(projectId);
    const allEdges = await this.loadEdges(projectId);

    const fileNodes: GraphNode[] = [];
    for (const node of allNodes.values()) {
      if (node.type === "file") {
        fileNodes.push(node);
      }
    }

    const importEdges = allEdges.filter(
      (e) => e.type === "imports" || e.type === "depends_on"
    );

    return { nodes: fileNodes, edges: importEdges };
  }

  // ─── Phase 9.1: Function Call Graph ──────────────────────────────

  /**
   * Build a function call graph for the project.
   * Returns function/method nodes with "calls" edges between them.
   */
  async getFunctionCallGraph(projectId: string): Promise<GraphQueryResult> {
    const allNodes = await this.loadNodes(projectId);
    const allEdges = await this.loadEdges(projectId);

    const fnNodes: GraphNode[] = [];
    for (const node of allNodes.values()) {
      if (node.type === "function") {
        fnNodes.push(node);
      }
    }

    const callEdges = allEdges.filter((e) => e.type === "calls");

    return { nodes: fnNodes, edges: callEdges };
  }

  // ─── File Analysis ───────────────────────────────────────────────

  async analyzeFile(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const imports = this.extractImports(content);
    const exports = this.extractExports(content);
    const functions = this.extractFunctions(content);
    const classes = this.extractClasses(content);
    const callGraph = this.extractFunctionCalls(
      content,
      functions.map((f) => f.name)
    );

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

    // Index exported symbols
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

    // Index functions
    for (const fn of functions) {
      const fnNode: GraphNode = {
        id: `fn:${filePath}:${fn.name}`,
        type: "function",
        name: fn.name,
        filePath,
        metadata: {
          async: fn.isAsync,
          exported: fn.isExported,
          params: fn.params,
        },
      };
      await this.addNode(projectId, fnNode);
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: fnNode.id,
        type: "contains",
      });
    }

    // Index classes
    for (const cls of classes) {
      const clsNode: GraphNode = {
        id: `class:${filePath}:${cls.name}`,
        type: "class",
        name: cls.name,
        filePath,
        metadata: {
          methods: cls.methods,
          isAbstract: cls.isAbstract,
        },
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

    // Index import edges
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

    // Index function call edges
    for (const call of callGraph) {
      await this.addEdge(projectId, {
        source: `fn:${filePath}:${call.caller}`,
        target: `fn:${filePath}:${call.callee}`,
        type: "calls",
      });
    }

    logger.debug(
      {
        projectId,
        filePath,
        functions: functions.length,
        classes: classes.length,
        imports: imports.length,
        exports: exports.length,
        callEdges: callGraph.length,
      },
      "File analyzed for knowledge graph"
    );
  }

  // ─── Enhanced Extraction (Phase 9.1) ─────────────────────────────

  private extractImports(content: string): Array<{
    source: string;
    specifiers: string[];
    isDefault: boolean;
    isNamespace: boolean;
  }> {
    const imports: Array<{
      source: string;
      specifiers: string[];
      isDefault: boolean;
      isNamespace: boolean;
    }> = [];

    // Named imports: import { A, B } from "module"
    const namedRegex = /import\s+\{([^}]+)\}\s+from\s+["'](.+?)["']/g;
    let match: RegExpExecArray | null = namedRegex.exec(content);
    while (match !== null) {
      if (match[1] && match[2]) {
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
      match = namedRegex.exec(content);
    }

    // Default imports: import Foo from "module"
    const defaultRegex = /import\s+(\w+)\s+from\s+["'](.+?)["']/g;
    match = defaultRegex.exec(content);
    while (match !== null) {
      if (match[1] && match[2] && !match[1].startsWith("{")) {
        imports.push({
          source: match[2],
          specifiers: [match[1]],
          isDefault: true,
          isNamespace: false,
        });
      }
      match = defaultRegex.exec(content);
    }

    // Namespace imports: import * as Foo from "module"
    const nsRegex = /import\s+\*\s+as\s+(\w+)\s+from\s+["'](.+?)["']/g;
    match = nsRegex.exec(content);
    while (match !== null) {
      if (match[1] && match[2]) {
        imports.push({
          source: match[2],
          specifiers: [match[1]],
          isDefault: false,
          isNamespace: true,
        });
      }
      match = nsRegex.exec(content);
    }

    // Side-effect imports: import "module"
    const sideEffectRegex = /import\s+["'](.+?)["']/g;
    match = sideEffectRegex.exec(content);
    while (match !== null) {
      if (match[1]) {
        imports.push({
          source: match[1],
          specifiers: [],
          isDefault: false,
          isNamespace: false,
        });
      }
      match = sideEffectRegex.exec(content);
    }

    // Dynamic imports: import("module")
    const dynamicRegex = /import\(\s*["'](.+?)["']\s*\)/g;
    match = dynamicRegex.exec(content);
    while (match !== null) {
      if (match[1]) {
        imports.push({
          source: match[1],
          specifiers: [],
          isDefault: false,
          isNamespace: false,
        });
      }
      match = dynamicRegex.exec(content);
    }

    // Deduplicate by source
    const seen = new Set<string>();
    return imports.filter((imp) => {
      const key = `${imp.source}:${imp.specifiers.join(",")}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private extractExports(
    content: string
  ): Array<{ name: string; kind: string }> {
    const exports: Array<{ name: string; kind: string }> = [];
    const exportRegex =
      /export\s+(?:default\s+)?(?:abstract\s+)?(function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
    let match: RegExpExecArray | null = exportRegex.exec(content);
    while (match !== null) {
      if (match[1] && match[2]) {
        exports.push({ name: match[2], kind: match[1] });
      }
      match = exportRegex.exec(content);
    }

    // Re-exports: export { Foo, Bar } from "module"
    const reExportRegex = /export\s+\{([^}]+)\}\s+from\s+["'](.+?)["']/g;
    match = reExportRegex.exec(content);
    while (match !== null) {
      if (match[1]) {
        const names = match[1]
          .split(",")
          .map((s) => s.trim().split(" as ").pop()?.trim());
        for (const name of names) {
          if (name) {
            exports.push({ name, kind: "re-export" });
          }
        }
      }
      match = reExportRegex.exec(content);
    }

    return exports;
  }

  private extractFunctions(content: string): Array<{
    name: string;
    isAsync: boolean;
    isExported: boolean;
    params: string[];
  }> {
    const fns: Array<{
      name: string;
      isAsync: boolean;
      isExported: boolean;
      params: string[];
    }> = [];

    // function declarations
    const fnRegex =
      /(export\s+)?(?:default\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    let match: RegExpExecArray | null = fnRegex.exec(content);
    while (match !== null) {
      if (match[3]) {
        fns.push({
          name: match[3],
          isAsync: !!match[2],
          isExported: !!match[1],
          params: match[4]
            ? match[4]
                .split(",")
                .map((p) => p.trim().split(":")[0]?.trim())
                .filter((p): p is string => Boolean(p))
            : [],
        });
      }
      match = fnRegex.exec(content);
    }

    // Arrow function const declarations
    const arrowRegex =
      /(export\s+)?(?:const|let)\s+(\w+)\s*=\s*(async\s+)?(?:\([^)]*\)|(\w+))\s*(?::\s*[^=]+)?\s*=>/g;
    match = arrowRegex.exec(content);
    while (match !== null) {
      if (match[2]) {
        fns.push({
          name: match[2],
          isAsync: !!match[3],
          isExported: !!match[1],
          params: [],
        });
      }
      match = arrowRegex.exec(content);
    }

    return fns;
  }

  private extractClasses(content: string): Array<{
    name: string;
    extends?: string;
    implements?: string[];
    methods: string[];
    isAbstract: boolean;
  }> {
    const classes: Array<{
      name: string;
      extends?: string;
      implements?: string[];
      methods: string[];
      isAbstract: boolean;
    }> = [];

    const classRegex =
      /(?:export\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;
    let match: RegExpExecArray | null = classRegex.exec(content);
    while (match !== null) {
      if (match[2]) {
        // Extract methods from the class body
        const classStart = classRegex.lastIndex;
        const methods = this.extractClassMethods(content, classStart);

        classes.push({
          name: match[2],
          extends: match[3] ?? undefined,
          implements: match[4]
            ? match[4].split(",").map((s) => s.trim())
            : undefined,
          methods,
          isAbstract: !!match[1],
        });
      }
      match = classRegex.exec(content);
    }
    return classes;
  }

  /**
   * Extract method names from a class body starting at a given index.
   */
  private extractClassMethods(content: string, startIdx: number): string[] {
    const methods: string[] = [];
    let braceDepth = 0;
    let foundOpen = false;
    const slice = content.slice(startIdx, startIdx + 5000); // limit scan window

    const _methodRegex = /(?:async\s+)?(\w+)\s*\(/g;
    let _inClass = false;

    for (const ch of slice) {
      if (ch === "{") {
        braceDepth++;
        if (!foundOpen) {
          foundOpen = true;
        }
        _inClass = true;
      }
      if (ch === "}") {
        braceDepth--;
        if (foundOpen && braceDepth === 0) {
          break; // end of class
        }
      }
    }

    // Simple method extraction from the class body
    if (foundOpen) {
      let classBody = slice;
      let depth = 0;
      let bodyStart = -1;
      for (let i = 0; i < classBody.length; i++) {
        if (classBody[i] === "{") {
          if (bodyStart === -1) {
            bodyStart = i + 1;
          }
          depth++;
        }
        if (classBody[i] === "}") {
          depth--;
          if (depth === 0) {
            classBody = classBody.slice(bodyStart, i);
            break;
          }
        }
      }

      // Match method signatures at depth 0 of the class body
      const mRegex =
        /(?:private\s+|protected\s+|public\s+|static\s+|readonly\s+)*(?:async\s+)?(\w+)\s*\(/g;
      let m: RegExpExecArray | null = mRegex.exec(classBody);
      while (m !== null) {
        if (
          m[1] &&
          ![
            "if",
            "for",
            "while",
            "switch",
            "catch",
            "constructor",
            "new",
            "return",
          ].includes(m[1])
        ) {
          methods.push(m[1]);
        }
        m = mRegex.exec(classBody);
      }
    }

    return methods;
  }

  /**
   * Extract function-to-function call relationships within a file.
   * For each function, scan its body for calls to other known functions.
   */
  private extractFunctionCalls(
    content: string,
    knownFunctionNames: string[]
  ): Array<{ caller: string; callee: string }> {
    const calls: Array<{ caller: string; callee: string }> = [];
    if (knownFunctionNames.length === 0) {
      return calls;
    }

    const fnNameSet = new Set(knownFunctionNames);

    // Find function boundaries, then check for calls within each
    const fnBoundaryRegex =
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{/g;

    let match: RegExpExecArray | null = fnBoundaryRegex.exec(content);
    while (match !== null) {
      const callerName = match[1] ?? match[2];
      if (!(callerName && fnNameSet.has(callerName))) {
        match = fnBoundaryRegex.exec(content);
        continue;
      }

      // Scan forward to find the matching closing brace
      const startIdx = fnBoundaryRegex.lastIndex;
      let depth = 1;
      let endIdx = startIdx;
      for (let i = startIdx; i < content.length && depth > 0; i++) {
        if (content[i] === "{") {
          depth++;
        }
        if (content[i] === "}") {
          depth--;
        }
        endIdx = i;
      }

      const fnBody = content.slice(startIdx, endIdx);

      // Check for calls to other known functions
      for (const targetName of knownFunctionNames) {
        if (targetName === callerName) {
          continue; // skip self-calls (usually recursion, less interesting)
        }
        const callPattern = new RegExp(`\\b${targetName}\\s*\\(`, "g");
        if (callPattern.test(fnBody)) {
          calls.push({ caller: callerName, callee: targetName });
        }
      }
      match = fnBoundaryRegex.exec(content);
    }

    return calls;
  }

  // ─── Bulk Operations ─────────────────────────────────────────────

  /**
   * Remove all graph data for a project (useful before full reindex).
   */
  async clearProject(projectId: string): Promise<void> {
    await db
      .delete(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE 'graph:%'`
        )
      );
    logger.info({ projectId }, "Knowledge graph cleared");
  }

  /**
   * Get graph statistics for a project.
   */
  async getStats(projectId: string): Promise<{
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    functionCount: number;
    classCount: number;
  }> {
    const nodes = await this.loadNodes(projectId);
    const edges = await this.loadEdges(projectId);

    let fileCount = 0;
    let functionCount = 0;
    let classCount = 0;
    for (const node of nodes.values()) {
      if (node.type === "file") {
        fileCount++;
      } else if (node.type === "function") {
        functionCount++;
      } else if (node.type === "class") {
        classCount++;
      }
    }

    return {
      nodeCount: nodes.size,
      edgeCount: edges.length,
      fileCount,
      functionCount,
      classCount,
    };
  }
}
