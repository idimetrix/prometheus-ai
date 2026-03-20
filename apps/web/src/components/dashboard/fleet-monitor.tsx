"use client";

import { useMemo } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type NodeStatus = "running" | "completed" | "failed" | "pending" | "blocked";

interface FleetNode {
  agentRole: string;
  dependsOn: string[];
  id: string;
  label: string;
  status: NodeStatus;
}

interface FleetMessage {
  fromNodeId: string;
  id: string;
  summary: string;
  timestamp: number;
  toNodeId: string;
}

interface FleetMonitorProps {
  className?: string;
  messages: FleetMessage[];
  nodes: FleetNode[];
  onSelectNode?: (nodeId: string) => void;
  selectedNodeId?: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const NODE_STATUS_COLOR: Record<NodeStatus, string> = {
  blocked: "border-zinc-600 bg-zinc-800 text-zinc-500",
  completed: "border-green-600 bg-green-950/30 text-green-400",
  failed: "border-red-600 bg-red-950/30 text-red-400",
  pending: "border-zinc-600 bg-zinc-900 text-zinc-400",
  running: "border-blue-500 bg-blue-950/30 text-blue-400",
};

const NODE_STATUS_DOT: Record<NodeStatus, string> = {
  blocked: "bg-zinc-600",
  completed: "bg-green-500",
  failed: "bg-red-500",
  pending: "bg-zinc-500",
  running: "bg-blue-500 animate-pulse",
};

/* -------------------------------------------------------------------------- */
/*  DAG layout helper (simple topological layers)                              */
/* -------------------------------------------------------------------------- */

interface LayoutNode extends FleetNode {
  column: number;
  row: number;
}

function computeLayout(nodes: FleetNode[]): LayoutNode[] {
  // Compute layers using topological sorting
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const layers = new Map<string, number>();
  const visited = new Set<string>();

  function getLayer(nodeId: string): number {
    if (layers.has(nodeId)) {
      return layers.get(nodeId) ?? 0;
    }
    if (visited.has(nodeId)) {
      return 0; // cycle protection
    }
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node || node.dependsOn.length === 0) {
      layers.set(nodeId, 0);
      return 0;
    }

    const maxParentLayer = Math.max(
      ...node.dependsOn.map((depId) => getLayer(depId))
    );
    const layer = maxParentLayer + 1;
    layers.set(nodeId, layer);
    return layer;
  }

  for (const node of nodes) {
    getLayer(node.id);
  }

  // Group by layer
  const layerGroups = new Map<number, FleetNode[]>();
  for (const node of nodes) {
    const layer = layers.get(node.id) ?? 0;
    const group = layerGroups.get(layer) ?? [];
    group.push(node);
    layerGroups.set(layer, group);
  }

  // Assign positions
  const result: LayoutNode[] = [];
  for (const [col, group] of layerGroups) {
    for (const [row, node] of group.entries()) {
      result.push({ ...node, column: col, row });
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function FleetMonitor({
  nodes,
  messages,
  selectedNodeId,
  onSelectNode,
  className = "",
}: FleetMonitorProps) {
  const layoutNodes = useMemo(() => computeLayout(nodes), [nodes]);

  const maxCol = Math.max(...layoutNodes.map((n) => n.column), 0);
  const maxRow = Math.max(...layoutNodes.map((n) => n.row), 0);

  const recentMessages = useMemo(
    () => [...messages].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    [messages]
  );

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <h3 className="font-semibold text-sm text-zinc-200">Fleet Monitor</h3>

      {/* DAG visualization */}
      <div className="overflow-auto rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
        <div
          className="relative grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${maxCol + 1}, minmax(140px, 1fr))`,
            gridTemplateRows: `repeat(${maxRow + 1}, auto)`,
          }}
        >
          {layoutNodes.map((node) => {
            const isSelected = node.id === selectedNodeId;
            return (
              <button
                className={`rounded-lg border-2 p-3 text-left transition-all ${NODE_STATUS_COLOR[node.status]} ${
                  isSelected ? "ring-2 ring-blue-400" : ""
                }`}
                key={node.id}
                onClick={() => onSelectNode?.(node.id)}
                style={{
                  gridColumn: node.column + 1,
                  gridRow: node.row + 1,
                }}
                type="button"
              >
                <div className="flex items-center gap-1.5">
                  <div
                    className={`h-2 w-2 rounded-full ${NODE_STATUS_DOT[node.status]}`}
                  />
                  <span className="truncate font-medium text-xs">
                    {node.label}
                  </span>
                </div>
                <span className="mt-0.5 block text-[10px] opacity-60">
                  {node.agentRole}
                </span>
                {node.dependsOn.length > 0 && (
                  <span className="mt-1 block text-[9px] opacity-40">
                    deps: {node.dependsOn.join(", ")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Message flow */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
        <span className="mb-2 block text-xs text-zinc-500">
          Recent Messages ({messages.length})
        </span>
        <div className="flex flex-col gap-1">
          {recentMessages.map((msg) => (
            <div className="flex items-center gap-2 text-xs" key={msg.id}>
              <span className="text-[10px] text-zinc-600">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
              <span className="font-mono text-blue-400">{msg.fromNodeId}</span>
              <span className="text-zinc-600">-&gt;</span>
              <span className="font-mono text-green-400">{msg.toNodeId}</span>
              <span className="truncate text-zinc-500">{msg.summary}</span>
            </div>
          ))}
          {recentMessages.length === 0 && (
            <span className="text-xs text-zinc-600">No messages yet</span>
          )}
        </div>
      </div>
    </div>
  );
}

export type { FleetMessage, FleetMonitorProps, FleetNode, NodeStatus };
