import { createLogger } from "@prometheus/logger";
import type { GraphEdge, GraphLayout, GraphNode } from "./types";

const logger = createLogger("architecture-graph:graph-builder");

// ---------------------------------------------------------------------------
// Force-directed layout constants
// ---------------------------------------------------------------------------
const DEFAULT_REPULSION = 500;
const DEFAULT_ATTRACTION = 0.01;
const DEFAULT_DAMPING = 0.9;
const DEFAULT_ITERATIONS = 100;

interface ForceLayoutOptions {
  /** Attraction strength along edges (default: 0.01) */
  attraction?: number;
  /** Velocity damping factor (default: 0.9) */
  damping?: number;
  /** Number of simulation iterations (default: 100) */
  iterations?: number;
  /** Repulsion strength between nodes (default: 500) */
  repulsion?: number;
}

interface KnowledgeGraphEntry {
  connections?: string[];
  id: string;
  label: string;
  metadata?: Record<string, unknown>;
  type: string;
}

// ---------------------------------------------------------------------------
// GraphBuilder
// ---------------------------------------------------------------------------

/**
 * Builds a force-directed graph structure from knowledge graph data.
 *
 * Accepts an array of knowledge graph entries (nodes with connections) and
 * computes a 2D layout using a simple force-directed algorithm suitable for
 * architecture visualisation.
 */
export class GraphBuilder {
  private readonly nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];

  /**
   * Add nodes and edges from knowledge graph entries.
   * Each entry becomes a node; each connection becomes a directed edge.
   */
  addEntries(entries: KnowledgeGraphEntry[]): void {
    for (const entry of entries) {
      this.nodes.set(entry.id, {
        id: entry.id,
        label: entry.label,
        type: entry.type,
        metadata: entry.metadata ?? {},
      });
    }

    for (const entry of entries) {
      if (!entry.connections) {
        continue;
      }
      for (const targetId of entry.connections) {
        // Only add edges to known nodes
        if (this.nodes.has(targetId)) {
          this.edges.push({
            source: entry.id,
            target: targetId,
          });
        }
      }
    }

    logger.debug(
      { nodes: this.nodes.size, edges: this.edges.length },
      "Graph entries added"
    );
  }

  /** Add a single node to the graph */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  /** Add a directed edge between two existing nodes */
  addEdge(source: string, target: string, label?: string): void {
    this.edges.push({ source, target, label });
  }

  /** Return all nodes in the graph */
  getNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  /** Return all edges in the graph */
  getEdges(): GraphEdge[] {
    return [...this.edges];
  }

  /**
   * Compute a force-directed layout for the current graph.
   *
   * Returns a `GraphLayout` mapping node IDs to 2D positions. The algorithm
   * uses Coulomb repulsion between all node pairs and Hooke attraction along
   * edges, with velocity damping for convergence.
   */
  computeLayout(options?: ForceLayoutOptions): GraphLayout {
    const repulsion = options?.repulsion ?? DEFAULT_REPULSION;
    const attraction = options?.attraction ?? DEFAULT_ATTRACTION;
    const damping = options?.damping ?? DEFAULT_DAMPING;
    const iterations = options?.iterations ?? DEFAULT_ITERATIONS;

    const nodeIds = [...this.nodes.keys()];
    const positions = new Map<string, { x: number; y: number }>();
    const velocities = new Map<string, { vx: number; vy: number }>();

    // Initialize positions in a circle
    const angleStep = (2 * Math.PI) / Math.max(nodeIds.length, 1);
    const radius = Math.max(100, nodeIds.length * 20);

    for (let i = 0; i < nodeIds.length; i++) {
      const id = nodeIds[i] ?? "";
      positions.set(id, {
        x: radius * Math.cos(i * angleStep),
        y: radius * Math.sin(i * angleStep),
      });
      velocities.set(id, { vx: 0, vy: 0 });
    }

    // Run simulation
    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between all pairs
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          const idI = nodeIds[i] ?? "";
          const idJ = nodeIds[j] ?? "";
          const a = positions.get(idI);
          const b = positions.get(idJ);
          if (!(a && b)) {
            continue;
          }

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = Math.max(dx * dx + dy * dy, 1);
          const dist = Math.sqrt(distSq);
          const force = repulsion / distSq;
          const fx = (force * dx) / dist;
          const fy = (force * dy) / dist;

          const va = velocities.get(idI);
          const vb = velocities.get(idJ);
          if (va) {
            va.vx -= fx;
            va.vy -= fy;
          }
          if (vb) {
            vb.vx += fx;
            vb.vy += fy;
          }
        }
      }

      // Attraction along edges
      for (const edge of this.edges) {
        const a = positions.get(edge.source);
        const b = positions.get(edge.target);
        if (!(a && b)) {
          continue;
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const fx = attraction * dx;
        const fy = attraction * dy;

        const va = velocities.get(edge.source);
        const vb = velocities.get(edge.target);
        if (va) {
          va.vx += fx;
          va.vy += fy;
        }
        if (vb) {
          vb.vx -= fx;
          vb.vy -= fy;
        }
      }

      // Apply velocities with damping
      for (const id of nodeIds) {
        const pos = positions.get(id);
        const vel = velocities.get(id);
        if (!(pos && vel)) {
          continue;
        }

        vel.vx *= damping;
        vel.vy *= damping;
        pos.x += vel.vx;
        pos.y += vel.vy;
      }
    }

    // Build result
    const layout: GraphLayout = {};
    for (const id of nodeIds) {
      const pos = positions.get(id);
      if (pos) {
        layout[id] = {
          x: Math.round(pos.x * 100) / 100,
          y: Math.round(pos.y * 100) / 100,
        };
      }
    }

    logger.info(
      { nodes: nodeIds.length, iterations },
      "Force-directed layout computed"
    );

    return layout;
  }

  /** Reset the builder, removing all nodes and edges */
  clear(): void {
    this.nodes.clear();
    this.edges = [];
  }
}
