import { db } from "@prometheus/db";
import { agentMemories } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { createLogger } from "@prometheus/logger";
import { eq, and, sql } from "drizzle-orm";

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

/**
 * Knowledge Graph stored using agent_memories table with memoryType = 'architectural'.
 * Nodes and edges are stored as JSONB in the content field.
 * Each project has one "graph:nodes" record and one "graph:edges" record.
 */
export class KnowledgeGraphLayer {
  private async loadNodes(projectId: string): Promise<Map<string, GraphNode>> {
    const results = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE 'graph:nodes:%'`,
        ),
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
          sql`${agentMemories.content} LIKE 'graph:edge:%'`,
        ),
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
    const nodeKey = `graph:node:${projectId}:${node.id}`;

    // Check if node already exists by looking for its ID
    const existing = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE ${"graph:nodes:" + JSON.stringify({ id: node.id }).slice(0, -1) + "%"}`,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(agentMemories)
        .set({ content })
        .where(eq(agentMemories.id, existing[0]!.id));
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

    // Check for duplicate edge
    const existing = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} = ${content}`,
        ),
      )
      .limit(1);

    if (existing.length > 0) return; // Edge already exists

    await db.insert(agentMemories).values({
      id: generateId("ge"),
      projectId,
      memoryType: "architectural",
      content,
    });
  }

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
      (e) => nodeIds.has(e.source) || nodeIds.has(e.target),
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

  async getDependencies(projectId: string, filePath: string): Promise<GraphNode[]> {
    const nodeId = `file:${filePath}`;
    const allEdges = await this.loadEdges(projectId);
    const allNodes = await this.loadNodes(projectId);

    const depIds = allEdges
      .filter(
        (e) =>
          e.source === nodeId &&
          (e.type === "imports" || e.type === "depends_on"),
      )
      .map((e) => e.target);

    return depIds
      .map((id) => allNodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  async getDependents(projectId: string, filePath: string): Promise<GraphNode[]> {
    const nodeId = `file:${filePath}`;
    const allEdges = await this.loadEdges(projectId);
    const allNodes = await this.loadNodes(projectId);

    const depIds = allEdges
      .filter(
        (e) =>
          e.target === nodeId &&
          (e.type === "imports" || e.type === "depends_on"),
      )
      .map((e) => e.source);

    return depIds
      .map((id) => allNodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  async analyzeFile(projectId: string, filePath: string, content: string): Promise<void> {
    const imports = this.extractImports(content);
    const exports = this.extractExports(content);
    const functions = this.extractFunctions(content);
    const classes = this.extractClasses(content);

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
      },
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
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: fnNode.id,
        type: "contains",
      });
    }

    for (const cls of classes) {
      const clsNode: GraphNode = {
        id: `class:${filePath}:${cls.name}`,
        type: "class",
        name: cls.name,
        filePath,
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

    for (const imp of imports) {
      await this.addEdge(projectId, {
        source: fileNode.id,
        target: `file:${imp}`,
        type: "imports",
      });
    }

    logger.debug(
      { projectId, filePath, functions: functions.length, classes: classes.length },
      "File analyzed for knowledge graph",
    );
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
    const exportRegex =
      /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      if (match[1]) exports.push(match[1]);
    }
    return exports;
  }

  private extractFunctions(content: string): string[] {
    const fns: string[] = [];
    const fnRegex =
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
      const name = match[1] ?? match[2];
      if (name) fns.push(name);
    }
    return fns;
  }

  private extractClasses(
    content: string,
  ): Array<{ name: string; extends?: string; implements?: string[] }> {
    const classes: Array<{ name: string; extends?: string; implements?: string[] }> = [];
    const classRegex =
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      if (match[1]) {
        classes.push({
          name: match[1],
          extends: match[2] ?? undefined,
          implements: match[3]
            ? match[3].split(",").map((s) => s.trim())
            : undefined,
        });
      }
    }
    return classes;
  }
}
