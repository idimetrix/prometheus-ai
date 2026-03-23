"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  onNodeClick?: (nodeId: string) => void;
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
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCurvePath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return ["M", x1, y1, "C", midX, y1, ",", midX, y2, ",", x2, y2].join(" ");
}

function truncateLabel(label: string): string {
  if (label.length > 18) {
    return label.slice(0, 18).concat("...");
  }
  return label;
}

// ---------------------------------------------------------------------------
// Layout
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

function buildDependencyGraph(nodes: TaskNode[]): {
  inDegree: Map<string, number>;
  children: Map<string, string[]>;
} {
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

  return { inDegree, children };
}

function assignLayers(
  inDegree: Map<string, number>,
  children: Map<string, string[]>
): Map<string, number> {
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
      layers.set(child, Math.max(layers.get(child) ?? 0, currentLayer + 1));
      const deg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, deg);
      if (deg === 0) {
        queue.push(child);
      }
    }
  }

  return layers;
}

function computeLayout(
  nodes: TaskNode[],
  progress: Record<string, TaskStatus>
): { edges: LayoutEdge[]; layoutNodes: LayoutNode[] } {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const { inDegree, children } = buildDependencyGraph(nodes);
  const layers = assignLayers(inDegree, children);

  const layerGroups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    const group = layerGroups.get(layer) ?? [];
    group.push(id);
    layerGroups.set(layer, group);
  }

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

  const edges: LayoutEdge[] = [];
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      edges.push({ from: dep, to: node.id });
    }
  }

  return { layoutNodes, edges };
}

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------

function Minimap({
  layoutNodes,
  edges,
  svgWidth,
  svgHeight,
  viewBox,
  onNavigate,
}: {
  edges: LayoutEdge[];
  layoutNodes: LayoutNode[];
  onNavigate: (x: number, y: number) => void;
  svgHeight: number;
  svgWidth: number;
  viewBox: { height: number; width: number; x: number; y: number };
}) {
  const minimapW = 160;
  const minimapH = 100;
  const scaleX = minimapW / Math.max(svgWidth, 1);
  const scaleY = minimapH / Math.max(svgHeight, 1);
  const scale = Math.min(scaleX, scaleY);

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of layoutNodes) {
      map.set(node.id, { x: node.x, y: node.y });
    }
    return map;
  }, [layoutNodes]);

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      onNavigate(
        (e.clientX - rect.left) / scale,
        (e.clientY - rect.top) / scale
      );
    },
    [scale, onNavigate]
  );

  const vb = `0 0 ${String(svgWidth)} ${String(svgHeight)}`;

  return (
    <div className="absolute right-2 bottom-2 overflow-hidden rounded border border-zinc-800 bg-zinc-900/90 shadow-lg">
      <svg
        aria-label="Pipeline minimap"
        className="cursor-crosshair"
        height={minimapH}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
          }
        }}
        role="application"
        tabIndex={0}
        viewBox={vb}
        width={minimapW}
      >
        <title>DAG Minimap</title>
        {edges.map((edge) => {
          const from = nodePositions.get(edge.from);
          const to = nodePositions.get(edge.to);
          if (!(from && to)) {
            return null;
          }
          const k = `mm-${edge.from}-${edge.to}`;
          return (
            <line
              key={k}
              stroke="#3f3f46"
              strokeWidth={1}
              x1={from.x + NODE_WIDTH}
              x2={to.x}
              y1={from.y + NODE_HEIGHT / 2}
              y2={to.y + NODE_HEIGHT / 2}
            />
          );
        })}
        {layoutNodes.map((node) => {
          const colors = STATUS_COLORS[node.status];
          const k = `mm-n-${node.id}`;
          return (
            <rect
              fill={colors.fill}
              height={NODE_HEIGHT}
              key={k}
              rx={4}
              width={NODE_WIDTH}
              x={node.x}
              y={node.y}
            />
          );
        })}
        <rect
          fill="none"
          height={viewBox.height}
          rx={2}
          stroke="#8b5cf6"
          strokeDasharray="4 2"
          strokeWidth={3}
          width={viewBox.width}
          x={viewBox.x}
          y={viewBox.y}
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main DAGView
// ---------------------------------------------------------------------------

export function DAGView({ plan, progress, onNodeClick }: DAGViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

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

  useEffect(() => {
    const runningNode = layoutNodes.find((n) => n.status === "running");
    if (runningNode && containerRef.current) {
      const cr = containerRef.current.getBoundingClientRect();
      setPan({
        x: -(runningNode.x - cr.width / 2 + NODE_WIDTH / 2),
        y: -(runningNode.y - cr.height / 2 + NODE_HEIGHT / 2),
      });
    }
  }, [layoutNodes]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const pos = nodePositions.get(nodeId);
      if (pos && containerRef.current) {
        const cr = containerRef.current.getBoundingClientRect();
        setFocusedNodeId(nodeId);
        setPan({
          x: -(pos.x * zoom - cr.width / 2 + (NODE_WIDTH * zoom) / 2),
          y: -(pos.y * zoom - cr.height / 2 + (NODE_HEIGHT * zoom) / 2),
        });
        onNodeClick?.(nodeId);
      }
    },
    [nodePositions, zoom, onNodeClick]
  );

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFocusedNodeId(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta)));
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) {
        return;
      }
      const target = e.target as Element;
      if (target.closest("[data-dag-node]")) {
        return;
      }
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    },
    [pan]
  );

  useEffect(() => {
    if (!isPanning) {
      return;
    }
    const onMove = (e: MouseEvent) => {
      setPan({
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
      });
    };
    const onUp = () => setIsPanning(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

  const handleMinimapNavigate = useCallback(
    (x: number, y: number) => {
      if (!containerRef.current) {
        return;
      }
      const cr = containerRef.current.getBoundingClientRect();
      setPan({
        x: -(x * zoom - cr.width / 2),
        y: -(y * zoom - cr.height / 2),
      });
    },
    [zoom]
  );

  const viewBox = useMemo(() => {
    if (!containerRef.current) {
      return { x: 0, y: 0, width: svgWidth, height: svgHeight };
    }
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
  }, [pan, zoom, svgWidth, svgHeight]);

  const containerCls = isPanning
    ? "relative h-full overflow-hidden bg-zinc-950 cursor-grabbing"
    : "relative h-full overflow-hidden bg-zinc-950 cursor-grab";

  const translateStyle = {
    transform: `translate(${String(pan.x)}px, ${String(pan.y)}px)`,
  };

  const scaleTransform = `scale(${String(zoom)})`;

  if (plan.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-600">
        No task plan available
      </div>
    );
  }

  return (
    <div
      className={containerCls}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
        }
      }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      ref={containerRef}
      role="application"
      tabIndex={0}
    >
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        <button
          className="rounded border border-zinc-700 bg-zinc-800/90 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          onClick={handleZoomIn}
          title="Zoom in"
          type="button"
        >
          +
        </button>
        <button
          className="rounded border border-zinc-700 bg-zinc-800/90 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          onClick={handleZoomOut}
          title="Zoom out"
          type="button"
        >
          -
        </button>
        <button
          className="rounded border border-zinc-700 bg-zinc-800/90 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700"
          onClick={handleZoomReset}
          title="Reset view"
          type="button"
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>

      <svg
        className="min-h-full min-w-full"
        height={svgHeight * zoom}
        ref={svgRef}
        style={translateStyle}
        width={svgWidth * zoom}
      >
        <title>Task DAG View</title>
        <defs>
          <marker
            id="dag-arrow"
            markerHeight={6}
            markerWidth={6}
            orient="auto"
            refX={5}
            refY={3}
            viewBox="0 0 6 6"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="#52525b" />
          </marker>
          <marker
            id="dag-arrow-active"
            markerHeight={6}
            markerWidth={6}
            orient="auto"
            refX={5}
            refY={3}
            viewBox="0 0 6 6"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="#3b82f6" />
          </marker>
        </defs>

        <g transform={scaleTransform}>
          {edges.map((edge) => {
            const from = nodePositions.get(edge.from);
            const to = nodePositions.get(edge.to);
            if (!(from && to)) {
              return null;
            }
            const fromStatus = progress[edge.from] ?? "pending";
            const toStatus = progress[edge.to] ?? "pending";
            const isActive = fromStatus === "running" || toStatus === "running";
            const x1 = from.x + NODE_WIDTH;
            const y1 = from.y + NODE_HEIGHT / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_HEIGHT / 2;
            const pathD = makeCurvePath(x1, y1, x2, y2);
            const k = `edge-${edge.from}-${edge.to}`;
            const markerEnd = isActive
              ? "url(#dag-arrow-active)"
              : "url(#dag-arrow)";

            return (
              <g key={k}>
                <path
                  d={pathD}
                  fill="none"
                  markerEnd={markerEnd}
                  stroke={isActive ? "#3b82f6" : "#3f3f46"}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                {isActive && (
                  <circle fill="#60a5fa" r={3}>
                    <animateMotion
                      dur="2s"
                      path={pathD}
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
              </g>
            );
          })}

          {layoutNodes.map((node) => {
            const colors = STATUS_COLORS[node.status];
            const isFocused = focusedNodeId === node.id;

            return (
              <g
                className="cursor-pointer"
                data-dag-node="true"
                key={node.id}
                onClick={() => handleNodeClick(node.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleNodeClick(node.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                {isFocused && (
                  <rect
                    fill="none"
                    height={NODE_HEIGHT + 8}
                    rx={12}
                    stroke="#8b5cf6"
                    strokeDasharray="4 2"
                    strokeWidth={2}
                    width={NODE_WIDTH + 8}
                    x={node.x - 4}
                    y={node.y - 4}
                  >
                    <animate
                      attributeName="stroke-opacity"
                      dur="1.5s"
                      repeatCount="indefinite"
                      values="1;0.4;1"
                    />
                  </rect>
                )}
                <rect
                  fill={colors.fill}
                  height={NODE_HEIGHT}
                  rx={8}
                  stroke={colors.stroke}
                  strokeWidth={isFocused ? 2.5 : 1.5}
                  width={NODE_WIDTH}
                  x={node.x}
                  y={node.y}
                />
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
                {node.status === "complete" && (
                  <text
                    dominantBaseline="central"
                    fill="#22c55e"
                    fontSize={12}
                    textAnchor="middle"
                    x={node.x + 14}
                    y={node.y + NODE_HEIGHT / 2}
                  >
                    &#10003;
                  </text>
                )}
                {node.status === "failed" && (
                  <text
                    dominantBaseline="central"
                    fill="#ef4444"
                    fontSize={12}
                    textAnchor="middle"
                    x={node.x + 14}
                    y={node.y + NODE_HEIGHT / 2}
                  >
                    &#10007;
                  </text>
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
                  {truncateLabel(node.label)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <Minimap
        edges={edges}
        layoutNodes={layoutNodes}
        onNavigate={handleMinimapNavigate}
        svgHeight={svgHeight}
        svgWidth={svgWidth}
        viewBox={viewBox}
      />

      <div className="absolute bottom-2 left-2 flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900/90 px-2 py-1">
        {(
          Object.entries(STATUS_COLORS) as [
            TaskStatus,
            { fill: string; stroke: string },
          ][]
        ).map(([status, colors]) => (
          <div className="flex items-center gap-1" key={status}>
            <span
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: colors.stroke }}
            />
            <span className="text-[9px] text-zinc-500 capitalize">
              {status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
