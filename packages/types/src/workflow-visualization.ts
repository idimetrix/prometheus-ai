/** Status of a node in the workflow DAG */
export type DAGNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

/** A node in the workflow directed acyclic graph */
export interface DAGNode {
  /** Agent role handling this node */
  agentRole: string;
  /** When this node completed */
  completedAt?: string;
  /** Unique node identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Optional metadata for display */
  metadata?: Record<string, unknown>;
  /** Workflow phase this node belongs to */
  phase: string;
  /** When this node started executing */
  startedAt?: string;
  /** Current execution status */
  status: DAGNodeStatus;
}

/** Type of relationship between DAG nodes */
export type DAGEdgeType = "blocks" | "informs";

/** An edge connecting two nodes in the workflow DAG */
export interface DAGEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Relationship type: 'blocks' = hard dependency, 'informs' = soft/informational */
  type: DAGEdgeType;
}

/** Complete workflow DAG structure for visualization */
export interface WorkflowDAG {
  /** All edges connecting nodes */
  edges: DAGEdge[];
  /** All nodes in the DAG */
  nodes: DAGNode[];
}

/** Summary of a workflow's progress for dashboard display */
export interface WorkflowProgress {
  /** Number of completed nodes */
  completedNodes: number;
  /** Current active phase */
  currentPhase: string;
  /** Estimated time remaining in ms */
  estimatedRemainingMs: number | null;
  /** Percentage complete (0-100) */
  percentComplete: number;
  /** Total number of nodes */
  totalNodes: number;
}

/** Workflow status for the status aggregation endpoint */
export interface WorkflowStatus {
  /** The full DAG for visualization */
  dag: WorkflowDAG;
  /** Workflow/session ID */
  id: string;
  /** Organization ID */
  orgId: string;
  /** Progress summary */
  progress: WorkflowProgress;
  /** When the workflow started */
  startedAt: string;
  /** Current status */
  status: "running" | "completed" | "failed" | "cancelled" | "paused";
  /** Last update timestamp */
  updatedAt: string;
}
