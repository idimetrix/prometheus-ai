import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:knowledge-graph");

export interface GraphNode {
  id: string;
  type: "file" | "function" | "class" | "module" | "component";
  name: string;
  filePath: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "imports" | "calls" | "extends" | "implements" | "depends_on" | "contains";
}

export interface GraphQueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class KnowledgeGraphLayer {
  // In-memory graph (TODO: persist to PostgreSQL or Neo4j)
  private nodes = new Map<string, Map<string, GraphNode>>();
  private edges = new Map<string, GraphEdge[]>();

  async addNode(projectId: string, node: GraphNode): Promise<void> {
    if (!this.nodes.has(projectId)) {
      this.nodes.set(projectId, new Map());
    }
    this.nodes.get(projectId)!.set(node.id, node);
  }

  async addEdge(projectId: string, edge: GraphEdge): Promise<void> {
    if (!this.edges.has(projectId)) {
      this.edges.set(projectId, []);
    }
    this.edges.get(projectId)!.push(edge);
  }

  async query(projectId: string, query: string): Promise<GraphQueryResult> {
    const projectNodes = this.nodes.get(projectId);
    if (!projectNodes) return { nodes: [], edges: [] };

    // Simple query: find nodes matching the query string
    const matchingNodes: GraphNode[] = [];
    for (const node of projectNodes.values()) {
      if (node.name.toLowerCase().includes(query.toLowerCase()) ||
          node.filePath.toLowerCase().includes(query.toLowerCase())) {
        matchingNodes.push(node);
      }
    }

    // Find related edges
    const nodeIds = new Set(matchingNodes.map((n) => n.id));
    const relatedEdges = (this.edges.get(projectId) ?? []).filter(
      (e) => nodeIds.has(e.source) || nodeIds.has(e.target)
    );

    return { nodes: matchingNodes, edges: relatedEdges };
  }

  async getDependencies(projectId: string, nodeId: string): Promise<GraphNode[]> {
    const projectEdges = this.edges.get(projectId) ?? [];
    const depIds = projectEdges
      .filter((e) => e.source === nodeId && e.type === "depends_on")
      .map((e) => e.target);

    const projectNodes = this.nodes.get(projectId);
    if (!projectNodes) return [];

    return depIds
      .map((id) => projectNodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  async getDependents(projectId: string, nodeId: string): Promise<GraphNode[]> {
    const projectEdges = this.edges.get(projectId) ?? [];
    const depIds = projectEdges
      .filter((e) => e.target === nodeId && e.type === "depends_on")
      .map((e) => e.source);

    const projectNodes = this.nodes.get(projectId);
    if (!projectNodes) return [];

    return depIds
      .map((id) => projectNodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  async analyzeFile(projectId: string, filePath: string, content: string): Promise<void> {
    // Extract imports, exports, function/class definitions
    const imports = this.extractImports(content);
    const exports = this.extractExports(content);
    const functions = this.extractFunctions(content);

    const fileNode: GraphNode = {
      id: `file:${filePath}`,
      type: "file",
      name: filePath.split("/").pop() ?? filePath,
      filePath,
      metadata: { imports: imports.length, exports: exports.length, functions: functions.length },
    };
    await this.addNode(projectId, fileNode);

    for (const fn of functions) {
      const fnNode: GraphNode = {
        id: `fn:${filePath}:${fn}`,
        type: "function",
        name: fn,
        filePath,
      };
      await this.addNode(projectId, fnNode);
      await this.addEdge(projectId, { source: fileNode.id, target: fnNode.id, type: "contains" });
    }

    for (const imp of imports) {
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: `file:${imp}`,
        type: "imports",
      });
    }

    logger.debug({ projectId, filePath, functions: functions.length }, "File analyzed");
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+.*?\s+from\s+["'](.+?)["']/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) imports.push(match[1]);
    }
    return imports;
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      if (match[1]) exports.push(match[1]);
    }
    return exports;
  }

  private extractFunctions(content: string): string[] {
    const fns: string[] = [];
    const fnRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
      const name = match[1] ?? match[2];
      if (name) fns.push(name);
    }
    return fns;
  }
}
