"use client";

import { useCallback, useMemo, useRef, useState } from "react";

interface GraphNode {
  id: string;
  label: string;
  modified?: boolean;
  type: "file" | "module" | "task";
  x?: number;
  y?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: "imports" | "depends_on" | "calls";
}

interface DependencyGraphProps {
  edges: GraphEdge[];
  highlightedNodes?: Set<string>;
  nodes: GraphNode[];
  onNodeClick?: (nodeId: string) => void;
}

/**
 * Dependency Graph Visualization — SVG-based interactive graph.
 * Visualizes file dependencies, module relationships, or task dependencies.
 * No external D3.js dependency — uses pure SVG with force-directed layout.
 */
export function DependencyGraph({
  nodes,
  edges,
  onNodeClick,
  highlightedNodes = new Set(),
}: DependencyGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Simple force-directed layout
  const layoutNodes = useMemo(() => {
    const positioned = nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const radius = Math.min(300, nodes.length * 20);
      return {
        ...node,
        x: node.x ?? 400 + radius * Math.cos(angle),
        y: node.y ?? 300 + radius * Math.sin(angle),
      };
    });

    // Simple force simulation (5 iterations)
    const nodeMap = new Map(positioned.map((n) => [n.id, n]));

    for (let iter = 0; iter < 5; iter++) {
      // Repulsion between all nodes
      for (let i = 0; i < positioned.length; i++) {
        for (let j = i + 1; j < positioned.length; j++) {
          const a = positioned[i]!;
          const b = positioned[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const force = 2000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.x -= fx;
          a.y -= fy;
          b.x += fx;
          b.y += fy;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!(source && target)) {
          continue;
        }
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = (dist - 100) * 0.01;
        const fx = (dx / Math.max(1, dist)) * force;
        const fy = (dy / Math.max(1, dist)) * force;
        source.x += fx;
        source.y += fy;
        target.x -= fx;
        target.y -= fy;
      }
    }

    return positioned;
  }, [nodes, edges]);

  const nodeMap = useMemo(
    () => new Map(layoutNodes.map((n) => [n.id, n])),
    [layoutNodes]
  );

  const connectedToSelected = useMemo(() => {
    if (!selectedNode) {
      return new Set<string>();
    }
    const connected = new Set<string>();
    for (const edge of edges) {
      if (edge.source === selectedNode) {
        connected.add(edge.target);
      }
      if (edge.target === selectedNode) {
        connected.add(edge.source);
      }
    }
    return connected;
  }, [selectedNode, edges]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNode((prev) => (prev === nodeId ? null : nodeId));
      onNodeClick?.(nodeId);
    },
    [onNodeClick]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(3, z - e.deltaY * 0.001)));
  };

  const getNodeColor = (node: GraphNode) => {
    if (selectedNode === node.id) {
      return "#3b82f6";
    }
    if (connectedToSelected.has(node.id)) {
      return "#60a5fa";
    }
    if (highlightedNodes.has(node.id)) {
      return "#22c55e";
    }
    if (node.modified) {
      return "#eab308";
    }
    if (node.type === "module") {
      return "#8b5cf6";
    }
    if (node.type === "task") {
      return "#f97316";
    }
    return "#71717a";
  };

  const getNodeRadius = (node: GraphNode) => {
    if (selectedNode === node.id) {
      return 10;
    }
    const edgeCount = edges.filter(
      (e) => e.source === node.id || e.target === node.id
    ).length;
    return Math.max(5, Math.min(12, 4 + edgeCount));
  };

  const truncateLabel = (label: string, maxLen = 20) => {
    if (label.length <= maxLen) {
      return label;
    }
    const parts = label.split("/");
    return parts.at(-1)?.slice(0, maxLen) ?? label.slice(0, maxLen);
  };

  if (nodes.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
        No dependency data available
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[400px] w-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
      {/* Controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button
          className="flex h-7 w-7 items-center justify-center rounded border border-zinc-300 bg-white text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
        >
          +
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded border border-zinc-300 bg-white text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))}
        >
          -
        </button>
        <button
          className="flex h-7 items-center justify-center rounded border border-zinc-300 bg-white px-2 text-xs hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 flex gap-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-zinc-500" /> File
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-purple-500" /> Module
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-yellow-500" /> Modified
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-green-500" /> Highlighted
        </span>
      </div>

      {/* Stats */}
      <div className="absolute top-2 left-2 z-10 text-[10px] text-zinc-400">
        {nodes.length} nodes, {edges.length} edges
      </div>

      <svg
        className="cursor-grab active:cursor-grabbing"
        height="100%"
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        ref={svgRef}
        viewBox="0 0 800 600"
        width="100%"
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {edges.map((edge, i) => {
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!(source && target)) {
              return null;
            }

            const isHighlighted =
              selectedNode === edge.source || selectedNode === edge.target;

            return (
              <line
                key={`edge-${i}`}
                markerEnd="url(#arrowhead)"
                stroke={isHighlighted ? "#3b82f6" : "#d4d4d8"}
                strokeOpacity={isHighlighted ? 0.8 : 0.3}
                strokeWidth={isHighlighted ? 1.5 : 0.5}
                x1={source.x}
                x2={target.x}
                y1={source.y}
                y2={target.y}
              />
            );
          })}

          {/* Nodes */}
          {layoutNodes.map((node) => {
            const r = getNodeRadius(node);
            return (
              <g
                className="cursor-pointer"
                key={node.id}
                onClick={() => handleNodeClick(node.id)}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  fill={getNodeColor(node)}
                  opacity={
                    !selectedNode ||
                    selectedNode === node.id ||
                    connectedToSelected.has(node.id)
                      ? 1
                      : 0.3
                  }
                  r={r}
                  stroke={selectedNode === node.id ? "#fff" : "none"}
                  strokeWidth={2}
                />
                <text
                  fill={selectedNode === node.id ? "#3b82f6" : "#71717a"}
                  fontSize={8}
                  opacity={
                    !selectedNode ||
                    selectedNode === node.id ||
                    connectedToSelected.has(node.id)
                      ? 1
                      : 0.2
                  }
                  textAnchor="middle"
                  x={node.x}
                  y={node.y + r + 10}
                >
                  {truncateLabel(node.label)}
                </text>
              </g>
            );
          })}

          {/* Arrow marker */}
          <defs>
            <marker
              id="arrowhead"
              markerHeight="4"
              markerWidth="6"
              orient="auto"
              refX="6"
              refY="2"
            >
              <polygon fill="#d4d4d8" points="0 0, 6 2, 0 4" />
            </marker>
          </defs>
        </g>
      </svg>
    </div>
  );
}
