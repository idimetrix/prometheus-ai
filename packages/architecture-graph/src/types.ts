// ---------------------------------------------------------------------------
// Graph node / edge / layout types
// ---------------------------------------------------------------------------

/** A node in the architecture graph */
export interface GraphNode {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Arbitrary metadata attached to the node */
  metadata: Record<string, unknown>;
  /** Node type (e.g. "service", "package", "file", "module") */
  type: string;
}

/** A directed edge between two nodes */
export interface GraphEdge {
  /** Optional label describing the relationship */
  label?: string;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
}

/** 2D position for layout rendering */
export interface LayoutPosition {
  x: number;
  y: number;
}

/** Mapping from node ID to its computed layout position */
export type GraphLayout = Record<string, LayoutPosition>;
