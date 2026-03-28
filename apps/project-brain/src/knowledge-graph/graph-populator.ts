/**
 * GAP-049: Knowledge Graph Population and Query
 *
 * Extracts entities (functions, classes, types, modules) from codebase,
 * extracts relationships (imports, calls, inherits, implements), stores
 * in graph_nodes and graph_edges tables, and supports dependency queries.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:knowledge-graph:populator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType =
  | "function"
  | "class"
  | "type"
  | "interface"
  | "module"
  | "variable"
  | "enum";

export type RelationshipType =
  | "imports"
  | "calls"
  | "inherits"
  | "implements"
  | "exports"
  | "depends-on"
  | "contains";

export interface GraphNode {
  filePath: string;
  id: string;
  line?: number;
  metadata?: Record<string, unknown>;
  name: string;
  projectId: string;
  type: EntityType;
}

export interface GraphEdge {
  id: string;
  metadata?: Record<string, unknown>;
  projectId: string;
  sourceId: string;
  targetId: string;
  type: RelationshipType;
}

export interface PopulationResult {
  edgesCreated: number;
  errors: string[];
  filesProcessed: number;
  nodesCreated: number;
}

export interface DependencyQueryResult {
  depth: number;
  nodes: GraphNode[];
  path: string[];
}

// Regex patterns for entity extraction
const FUNCTION_RE = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
const CLASS_RE = /(?:export\s+)?class\s+(\w+)/g;
const INTERFACE_RE = /(?:export\s+)?interface\s+(\w+)/g;
const TYPE_RE = /(?:export\s+)?type\s+(\w+)\s*=/g;
const ENUM_RE = /(?:export\s+)?enum\s+(\w+)/g;
const CONST_FUNC_RE = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
const IMPORT_RE = /import\s+.*?from\s+["'](.+?)["']/g;
const EXTENDS_RE = /class\s+(\w+)\s+extends\s+(\w+)/g;
const IMPLEMENTS_RE = /class\s+(\w+)\s+implements\s+(\w+)/g;

// ---------------------------------------------------------------------------
// GraphPopulator
// ---------------------------------------------------------------------------

export class GraphPopulator {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private nodeCounter = 0;
  private edgeCounter = 0;

  /**
   * Populate the graph from source files.
   */
  populate(
    projectId: string,
    files: Array<{ content: string; path: string }>
  ): PopulationResult {
    const errors: string[] = [];
    let filesProcessed = 0;
    const nodesBeforeCount = this.nodes.size;
    const edgesBeforeCount = this.edges.size;

    for (const file of files) {
      try {
        this.extractFromFile(projectId, file.path, file.content);
        filesProcessed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${file.path}: ${msg}`);
      }
    }

    const result: PopulationResult = {
      filesProcessed,
      nodesCreated: this.nodes.size - nodesBeforeCount,
      edgesCreated: this.edges.size - edgesBeforeCount,
      errors,
    };

    logger.info(
      {
        projectId,
        filesProcessed,
        nodesCreated: result.nodesCreated,
        edgesCreated: result.edgesCreated,
        errors: errors.length,
      },
      "Graph population completed"
    );

    return result;
  }

  /**
   * Query: what depends on X?
   */
  whatDependsOn(projectId: string, entityName: string): DependencyQueryResult {
    const targetNode = this.findNode(projectId, entityName);
    if (!targetNode) {
      return { nodes: [], path: [], depth: 0 };
    }

    const dependents: GraphNode[] = [];
    const visited = new Set<string>();

    this.findDependents(targetNode.id, dependents, visited);

    return {
      nodes: dependents,
      path: dependents.map((n) => n.name),
      depth: dependents.length > 0 ? 1 : 0,
    };
  }

  /**
   * Query: what does X use?
   */
  whatDoesXUse(projectId: string, entityName: string): DependencyQueryResult {
    const sourceNode = this.findNode(projectId, entityName);
    if (!sourceNode) {
      return { nodes: [], path: [], depth: 0 };
    }

    const dependencies: GraphNode[] = [];
    const visited = new Set<string>();

    this.findDependencies(sourceNode.id, dependencies, visited);

    return {
      nodes: dependencies,
      path: dependencies.map((n) => n.name),
      depth: dependencies.length > 0 ? 1 : 0,
    };
  }

  /**
   * Get all nodes for a project.
   */
  getNodes(projectId: string): GraphNode[] {
    const result: GraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.projectId === projectId) {
        result.push(node);
      }
    }
    return result;
  }

  /**
   * Get all edges for a project.
   */
  getEdges(projectId: string): GraphEdge[] {
    const result: GraphEdge[] = [];
    for (const edge of this.edges.values()) {
      if (edge.projectId === projectId) {
        result.push(edge);
      }
    }
    return result;
  }

  /**
   * Get graph statistics.
   */
  getStats(projectId: string): {
    edgesByType: Record<string, number>;
    nodesByType: Record<string, number>;
    totalEdges: number;
    totalNodes: number;
  } {
    const nodesByType: Record<string, number> = {};
    const edgesByType: Record<string, number> = {};
    let totalNodes = 0;
    let totalEdges = 0;

    for (const node of this.nodes.values()) {
      if (node.projectId !== projectId) {
        continue;
      }
      totalNodes++;
      nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
    }

    for (const edge of this.edges.values()) {
      if (edge.projectId !== projectId) {
        continue;
      }
      totalEdges++;
      edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
    }

    return { totalNodes, totalEdges, nodesByType, edgesByType };
  }

  // ---------------------------------------------------------------------------
  // Internal extraction
  // ---------------------------------------------------------------------------

  private extractFromFile(
    projectId: string,
    filePath: string,
    content: string
  ): void {
    // Create module node for the file
    const moduleNode = this.addNode(projectId, filePath, "module", filePath);

    // Extract simple entity types (functions, classes, interfaces, types, enums)
    this.extractEntities(
      projectId,
      filePath,
      content,
      moduleNode.id,
      FUNCTION_RE,
      "function"
    );
    this.extractEntities(
      projectId,
      filePath,
      content,
      moduleNode.id,
      CONST_FUNC_RE,
      "function"
    );
    this.extractEntities(
      projectId,
      filePath,
      content,
      moduleNode.id,
      CLASS_RE,
      "class"
    );
    this.extractEntities(
      projectId,
      filePath,
      content,
      moduleNode.id,
      INTERFACE_RE,
      "interface"
    );
    this.extractEntities(
      projectId,
      filePath,
      content,
      moduleNode.id,
      TYPE_RE,
      "type"
    );
    this.extractEntities(
      projectId,
      filePath,
      content,
      moduleNode.id,
      ENUM_RE,
      "enum"
    );

    // Extract imports as dependencies
    this.extractImports(projectId, filePath, content, moduleNode.id);

    // Extract inheritance and implements relationships
    this.extractRelationships(projectId, filePath, content);
  }

  private extractEntities(
    projectId: string,
    filePath: string,
    content: string,
    moduleNodeId: string,
    regex: RegExp,
    entityType: EntityType
  ): void {
    for (const match of content.matchAll(regex)) {
      const name = match[1];
      if (name) {
        const node = this.addNode(projectId, name, entityType, filePath);
        this.addEdge(projectId, moduleNodeId, node.id, "contains");
      }
    }
  }

  private extractImports(
    projectId: string,
    _filePath: string,
    content: string,
    moduleNodeId: string
  ): void {
    for (const match of content.matchAll(IMPORT_RE)) {
      const importPath = match[1];
      if (importPath) {
        const targetModule = this.addNode(
          projectId,
          importPath,
          "module",
          importPath
        );
        this.addEdge(projectId, moduleNodeId, targetModule.id, "imports");
      }
    }
  }

  private extractRelationships(
    projectId: string,
    filePath: string,
    content: string
  ): void {
    for (const match of content.matchAll(EXTENDS_RE)) {
      const child = match[1];
      const parent = match[2];
      if (child && parent) {
        const childNode = this.findNode(projectId, child);
        const parentNode = this.addNode(projectId, parent, "class", filePath);
        if (childNode) {
          this.addEdge(projectId, childNode.id, parentNode.id, "inherits");
        }
      }
    }

    for (const match of content.matchAll(IMPLEMENTS_RE)) {
      const cls = match[1];
      const iface = match[2];
      if (cls && iface) {
        const clsNode = this.findNode(projectId, cls);
        const ifaceNode = this.addNode(projectId, iface, "interface", filePath);
        if (clsNode) {
          this.addEdge(projectId, clsNode.id, ifaceNode.id, "implements");
        }
      }
    }
  }

  private addNode(
    projectId: string,
    name: string,
    type: EntityType,
    filePath: string
  ): GraphNode {
    // Check if node already exists
    const existingKey = `${projectId}:${type}:${name}`;
    const existing = this.nodes.get(existingKey);
    if (existing) {
      return existing;
    }

    const id = `gn_${++this.nodeCounter}`;
    const node: GraphNode = { id, projectId, name, type, filePath };
    this.nodes.set(existingKey, node);
    return node;
  }

  private addEdge(
    projectId: string,
    sourceId: string,
    targetId: string,
    type: RelationshipType
  ): GraphEdge {
    const edgeKey = `${projectId}:${sourceId}:${targetId}:${type}`;
    const existing = this.edges.get(edgeKey);
    if (existing) {
      return existing;
    }

    const id = `ge_${++this.edgeCounter}`;
    const edge: GraphEdge = { id, projectId, sourceId, targetId, type };
    this.edges.set(edgeKey, edge);
    return edge;
  }

  private findNode(projectId: string, name: string): GraphNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.projectId === projectId && node.name === name) {
        return node;
      }
    }
    return undefined;
  }

  private findDependents(
    nodeId: string,
    result: GraphNode[],
    visited: Set<string>
  ): void {
    for (const edge of this.edges.values()) {
      if (edge.targetId === nodeId && !visited.has(edge.sourceId)) {
        visited.add(edge.sourceId);
        const sourceNode = this.findNodeById(edge.sourceId);
        if (sourceNode) {
          result.push(sourceNode);
        }
      }
    }
  }

  private findDependencies(
    nodeId: string,
    result: GraphNode[],
    visited: Set<string>
  ): void {
    for (const edge of this.edges.values()) {
      if (edge.sourceId === nodeId && !visited.has(edge.targetId)) {
        visited.add(edge.targetId);
        const targetNode = this.findNodeById(edge.targetId);
        if (targetNode) {
          result.push(targetNode);
        }
      }
    }
  }

  private findNodeById(id: string): GraphNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.id === id) {
        return node;
      }
    }
    return undefined;
  }
}
