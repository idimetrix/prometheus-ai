"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "blocked";

export interface TaskNode {
  dependencies: string[];
  id: string;
  label: string;
  status: TaskStatus;
}

export interface TaskPlan {
  nodes: TaskNode[];
}

interface DAGViewProps {
  plan: TaskPlan;
  progress: Record<string, TaskStatus>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<TaskStatus, { fill: string; stroke: string }> = {
  pending: { fill: "#3f3f46", stroke: "#52525b" },
  running: { fill: "#1d4ed8", stroke: "#3b82f6" },
  complete: { fill: "#15803d", stroke: "#22c55e" },
  failed: { fill: "#b91c1c", stroke: "#ef4444" },
  blocked: { fill: "#a16207", stroke: "#eab308" },
};

const NODE_WIDTH = 160;
const NODE_HEIGHT = 40;
const HORIZONTAL_GAP = 40;
const VERTICAL_GAP = 60;

// ---------------------------------------------------------------------------
// Layout: simple topological sort + layer assignment
// ---------------------------------------------------------------------------

interface LayoutNode {
  height: number;
  id: string;
  label: string;
  layer: number;
  order: number;
  status: TaskStatus;
  width: number;
  x: number;
  y: number;
}

interface LayoutEdge {
  from: string;
  to: string;
}

function computeLayout(
  nodes: TaskNode[],
  progress: Record<string, TaskStatus>
): { edges: LayoutEdge[]; layoutNodes: LayoutNode[] } {
  // Build adjacency and in-degree
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const node of nodes) {
    if (!inDegree.has(node.id)) {
      inDegree.set(node.id, 0);
    }
    for (const dep of node.dependencies) {
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      const existing = children.get(dep) ?? [];
      existing.push(node.id);
      children.set(dep, existing);
    }
  }

  // Layer assignment via BFS (topological)
  const layers = new Map<string, number>();
  const queue: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      layers.set(id, 0);
    }
  }

  let idx = 0;
  while (idx < queue.length) {
    const current = queue[idx] ?? "";
    idx++;
    const currentLayer = layers.get(current) ?? 0;

    for (const child of children.get(current) ?? []) {
      const existingLayer = layers.get(child) ?? 0;
      layers.set(child, Math.max(existingLayer, currentLayer + 1));
      const deg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, deg);
      if (deg === 0) {
        queue.push(child);
      }
    }
  }

  // Group by layer
  const layerGroups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    const group = layerGroups.get(layer) ?? [];
    group.push(id);
    layerGroups.set(layer, group);
  }

  // Position nodes
  const layoutNodes: LayoutNode[] = [];
  for (const [layer, ids] of layerGroups) {
    for (let order = 0; order < ids.length; order++) {
      const id = ids[order] ?? "";
      const node = nodeMap.get(id);
      if (!node) {
        continue;
      }
      layoutNodes.push({
        id,
        label: node.label,
        status: progress[id] ?? node.status,
        layer,
        order,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        x: layer * (NODE_WIDTH + HORIZONTAL_GAP) + 20,
        y: order * (NODE_HEIGHT + VERTICAL_GAP) + 20,
      });
    }
  }

  // Edges
  const edges: LayoutEdge[] = [];
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      edges.push({ from: dep, to: node.id });
    }
  }

  return { layoutNodes, edges };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DAGView({ plan, progress }: DAGViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const { layoutNodes, edges } = useMemo(
    () => computeLayout(plan.nodes, progress),
    [plan.nodes, progress]
  );

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of layoutNodes) {
      map.set(node.id, { x: node.x, y: node.y });
    }
    return map;
  }, [layoutNodes]);

  // Compute SVG dimensions
  const svgWidth = useMemo(() => {
    let maxX = 400;
    for (const node of layoutNodes) {
      maxX = Math.max(maxX, node.x + NODE_WIDTH + 40);
    }
    return maxX;
  }, [layoutNodes]);

  const svgHeight = useMemo(() => {
    let maxY = 200;
    for (const node of layoutNodes) {
      maxY = Math.max(maxY, node.y + NODE_HEIGHT + 40);
    }
    return maxY;
  }, [layoutNodes]);

  // Auto-scroll to running nodes
  useEffect(() => {
    const runningNode = layoutNodes.find((n) => n.status === "running");
    if (runningNode && svgRef.current?.parentElement) {
      svgRef.current.parentElement.scrollTo({
        left: Math.max(0, runningNode.x - 100),
        top: Math.max(0, runningNode.y - 100),
        behavior: "smooth",
      });
    }
  }, [layoutNodes]);

  const handleNodeClick = useCallback((_nodeId: string) => {
    // Future: open task detail panel
  }, []);

  if (plan.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-600">
        No task plan available
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-zinc-950">
      <svg
        className="min-h-full min-w-full"
        height={svgHeight}
        ref={svgRef}
        width={svgWidth}
      >
        <title>Task DAG View</title>
        {/* Edges */}
        {edges.map((edge) => {
          const from = nodePositions.get(edge.from);
          const to = nodePositions.get(edge.to);
          if (!(from && to)) {
            return null;
          }
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              stroke="#3f3f46"
              strokeWidth={1.5}
              x1={from.x + NODE_WIDTH}
              x2={to.x}
              y1={from.y + NODE_HEIGHT / 2}
              y2={to.y + NODE_HEIGHT / 2}
            />
          );
        })}

        {/* Nodes */}
        {layoutNodes.map((node) => {
          const colors = STATUS_COLORS[node.status];
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG group element used as interactive node in DAG visualization
            <g
              className="cursor-pointer"
              key={node.id}
              onClick={() => handleNodeClick(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleNodeClick(node.id);
                }
              }}
              tabIndex={0}
            >
              <rect
                fill={colors.fill}
                height={NODE_HEIGHT}
                rx={8}
                stroke={colors.stroke}
                strokeWidth={1.5}
                width={NODE_WIDTH}
                x={node.x}
                y={node.y}
              />
              {/* Status pulse for running */}
              {node.status === "running" && (
                <circle
                  cx={node.x + 14}
                  cy={node.y + NODE_HEIGHT / 2}
                  fill="#3b82f6"
                  r={4}
                >
                  <animate
                    attributeName="opacity"
                    dur="1.5s"
                    repeatCount="indefinite"
                    values="1;0.3;1"
                  />
                </circle>
              )}
              <text
                className="select-none"
                dominantBaseline="central"
                fill="#e4e4e7"
                fontSize={11}
                textAnchor="middle"
                x={node.x + NODE_WIDTH / 2}
                y={node.y + NODE_HEIGHT / 2}
              >
                {node.label.length > 18
                  ? `${node.label.slice(0, 18)}...`
                  : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
