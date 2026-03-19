"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ArchNodeType =
  | "file"
  | "function"
  | "class"
  | "module"
  | "interface"
  | "component"
  | "hook";

export interface ArchNode {
  codeSnippet?: string;
  filePath?: string;
  id: string;
  label: string;
  type: ArchNodeType;
}

export interface ArchEdge {
  label?: string;
  source: string;
  target: string;
}

interface ArchitectureExplorerProps {
  edges: ArchEdge[];
  nodes: ArchNode[];
  onNodeSelect?: (node: ArchNode | null) => void;
}

const NODE_TYPE_COLORS: Record<
  ArchNodeType,
  { bg: string; border: string; text: string }
> = {
  file: {
    bg: "bg-blue-500/15",
    border: "border-blue-500/40",
    text: "text-blue-400",
  },
  function: {
    bg: "bg-green-500/15",
    border: "border-green-500/40",
    text: "text-green-400",
  },
  class: {
    bg: "bg-purple-500/15",
    border: "border-purple-500/40",
    text: "text-purple-400",
  },
  module: {
    bg: "bg-amber-500/15",
    border: "border-amber-500/40",
    text: "text-amber-400",
  },
  interface: {
    bg: "bg-cyan-500/15",
    border: "border-cyan-500/40",
    text: "text-cyan-400",
  },
  component: {
    bg: "bg-rose-500/15",
    border: "border-rose-500/40",
    text: "text-rose-400",
  },
  hook: {
    bg: "bg-teal-500/15",
    border: "border-teal-500/40",
    text: "text-teal-400",
  },
};

const NODE_TYPE_SVG_COLORS: Record<ArchNodeType, string> = {
  file: "#3b82f6",
  function: "#22c55e",
  class: "#a855f7",
  module: "#f59e0b",
  interface: "#06b6d4",
  component: "#f43f5e",
  hook: "#14b8a6",
};

interface SimNode {
  codeSnippet?: string;
  filePath?: string;
  id: string;
  label: string;
  type: ArchNodeType;
  vx: number;
  vy: number;
  x: number;
  y: number;
}

function runForceLayout(
  nodes: ArchNode[],
  edges: ArchEdge[],
  width: number,
  height: number,
  iterations: number
): SimNode[] {
  const simNodes: SimNode[] = nodes.map((n, i) => ({
    ...n,
    x: width / 2 + (Math.cos((i / nodes.length) * Math.PI * 2) * width) / 3,
    y: height / 2 + (Math.sin((i / nodes.length) * Math.PI * 2) * height) / 3,
    vx: 0,
    vy: 0,
  }));

  const nodeIndex = new Map(simNodes.map((n, i) => [n.id, i]));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const dampening = 0.85;

    // Repulsion between all node pairs
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        if (!(a && b)) {
          continue;
        }
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (300 * alpha) / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx -= dx;
        a.vy -= dy;
        b.vx += dx;
        b.vy += dy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const si = nodeIndex.get(edge.source);
      const ti = nodeIndex.get(edge.target);
      if (si === undefined || ti === undefined) {
        continue;
      }
      const a = simNodes[si];
      const b = simNodes[ti];
      if (!(a && b)) {
        continue;
      }
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 120) * 0.05 * alpha;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
    }

    // Center gravity
    for (const node of simNodes) {
      node.vx += (width / 2 - node.x) * 0.01 * alpha;
      node.vy += (height / 2 - node.y) * 0.01 * alpha;
    }

    // Apply velocities
    for (const node of simNodes) {
      node.vx *= dampening;
      node.vy *= dampening;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(60, Math.min(width - 60, node.x));
      node.y = Math.max(30, Math.min(height - 30, node.y));
    }
  }

  return simNodes;
}

const ALL_NODE_TYPES: ArchNodeType[] = [
  "file",
  "function",
  "class",
  "module",
  "interface",
  "component",
  "hook",
];

export function ArchitectureExplorer({
  nodes,
  edges,
  onNodeSelect,
}: ArchitectureExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<ArchNodeType>>(
    new Set(ALL_NODE_TYPES)
  );

  const width = 900;
  const height = 600;

  const filteredNodes = useMemo(
    () => nodes.filter((n) => activeFilters.has(n.type)),
    [nodes, activeFilters]
  );

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes]
  );

  const filteredEdges = useMemo(
    () =>
      edges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
      ),
    [edges, filteredNodeIds]
  );

  const layoutNodes = useMemo(
    () => runForceLayout(filteredNodes, filteredEdges, width, height, 100),
    [filteredNodes, filteredEdges]
  );

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of layoutNodes) {
      map.set(n.id, { x: n.x, y: n.y });
    }
    return map;
  }, [layoutNodes]);

  // Compute dependents for impact analysis
  const dependentsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!map.has(edge.source)) {
        map.set(edge.source, new Set());
      }
      map.get(edge.source)?.add(edge.target);
    }
    return map;
  }, [edges]);

  const impactedNodes = useMemo(() => {
    if (!selectedNodeId) {
      return new Set<string>();
    }
    const visited = new Set<string>();
    const queue = [selectedNodeId];
    while (queue.length > 0) {
      const current = queue.pop();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);
      const deps = dependentsMap.get(current);
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }
    }
    visited.delete(selectedNodeId);
    return visited;
  }, [selectedNodeId, dependentsMap]);

  const handleNodeClick = useCallback(
    (node: SimNode) => {
      const newId = selectedNodeId === node.id ? null : node.id;
      setSelectedNodeId(newId);
      if (newId) {
        const archNode = nodes.find((n) => n.id === newId) ?? null;
        onNodeSelect?.(archNode);
      } else {
        onNodeSelect?.(null);
      }
    },
    [selectedNodeId, nodes, onNodeSelect]
  );

  const toggleFilter = useCallback((type: ArchNodeType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Minimap scale
  const minimapScale = 0.15;
  const minimapW = width * minimapScale;
  const minimapH = height * minimapScale;

  // Compute viewport bounds for minimap
  const [scrollPos, setScrollPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const handler = () => {
      setScrollPos({ x: el.scrollLeft, y: el.scrollTop });
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-950">
      {/* Filter bar */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <span className="font-medium text-xs text-zinc-500 uppercase tracking-wider">
          Filter
        </span>
        {ALL_NODE_TYPES.map((type) => {
          const colors = NODE_TYPE_COLORS[type];
          const active = activeFilters.has(type);
          return (
            <button
              className={`rounded-full border px-2 py-0.5 font-medium text-[10px] transition-opacity ${
                active
                  ? `${colors.bg} ${colors.border} ${colors.text}`
                  : "border-zinc-700 bg-zinc-900 text-zinc-600 opacity-50"
              }`}
              key={type}
              onClick={() => toggleFilter(type)}
              type="button"
            >
              {type}
            </button>
          );
        })}
        <span className="ml-auto text-[10px] text-zinc-600">
          {filteredNodes.length} nodes / {filteredEdges.length} edges
        </span>
      </div>

      {/* Graph area */}
      <div className="relative flex-1 overflow-auto" ref={containerRef}>
        <div
          className="relative"
          style={{ width: `${width}px`, height: `${height}px` }}
        >
          {/* SVG connections layer */}
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative connection lines */}
          <svg
            className="pointer-events-none absolute inset-0"
            height={height}
            role="img"
            width={width}
          >
            <defs>
              <marker
                id="arrowhead"
                markerHeight="7"
                markerWidth="10"
                orient="auto"
                refX="10"
                refY="3.5"
              >
                <polygon fill="#52525b" points="0 0, 10 3.5, 0 7" />
              </marker>
              <marker
                id="arrowhead-red"
                markerHeight="7"
                markerWidth="10"
                orient="auto"
                refX="10"
                refY="3.5"
              >
                <polygon fill="#ef4444" points="0 0, 10 3.5, 0 7" />
              </marker>
            </defs>
            {filteredEdges.map((edge) => {
              const sp = nodePositions.get(edge.source);
              const tp = nodePositions.get(edge.target);
              if (!(sp && tp)) {
                return null;
              }

              const isImpacted =
                selectedNodeId !== null &&
                (edge.source === selectedNodeId ||
                  impactedNodes.has(edge.source)) &&
                impactedNodes.has(edge.target);

              const isSelected =
                edge.source === selectedNodeId ||
                edge.target === selectedNodeId;

              let strokeColor = "#3f3f46";
              if (isImpacted) {
                strokeColor = "#ef4444";
              } else if (isSelected) {
                strokeColor = "#8b5cf6";
              }

              let strokeAlpha = 0.3;
              if (isImpacted) {
                strokeAlpha = 0.8;
              } else if (isSelected) {
                strokeAlpha = 0.7;
              }

              return (
                <line
                  key={`${edge.source}-${edge.target}`}
                  markerEnd={
                    isImpacted ? "url(#arrowhead-red)" : "url(#arrowhead)"
                  }
                  stroke={strokeColor}
                  strokeOpacity={strokeAlpha}
                  strokeWidth={isImpacted || isSelected ? 2 : 1}
                  x1={sp.x}
                  x2={tp.x}
                  y1={sp.y}
                  y2={tp.y}
                />
              );
            })}
          </svg>

          {/* Nodes layer */}
          {layoutNodes.map((node) => {
            const colors = NODE_TYPE_COLORS[node.type];
            const isSelected = node.id === selectedNodeId;
            const isImpacted = impactedNodes.has(node.id);

            let nodeClass = `${colors.bg} ${colors.border} hover:brightness-125`;
            if (isSelected) {
              nodeClass =
                "border-violet-500 bg-violet-500/20 ring-1 ring-violet-500/40";
            } else if (isImpacted) {
              nodeClass =
                "border-red-500/60 bg-red-500/15 ring-1 ring-red-500/30";
            }

            let typeTextClass = colors.text;
            if (isSelected) {
              typeTextClass = "text-violet-300";
            } else if (isImpacted) {
              typeTextClass = "text-red-300";
            }

            let labelTextClass = "text-zinc-200";
            if (isSelected) {
              labelTextClass = "text-violet-100";
            } else if (isImpacted) {
              labelTextClass = "text-red-100";
            }

            return (
              <button
                className={`absolute flex flex-col items-center justify-center rounded-lg border px-3 py-1.5 text-center transition-all ${nodeClass}`}
                key={node.id}
                onClick={() => handleNodeClick(node)}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  transform: "translate(-50%, -50%)",
                }}
                type="button"
              >
                <span className={`font-mono text-[10px] ${typeTextClass}`}>
                  {node.type}
                </span>
                <span
                  className={`max-w-[100px] truncate font-medium text-xs ${labelTextClass}`}
                >
                  {node.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Minimap */}
        <div className="absolute right-2 bottom-2 rounded-md border border-zinc-700 bg-zinc-900/90 p-1">
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: minimap overview */}
          <svg height={minimapH} role="img" width={minimapW}>
            {filteredEdges.map((edge) => {
              const sp = nodePositions.get(edge.source);
              const tp = nodePositions.get(edge.target);
              if (!(sp && tp)) {
                return null;
              }
              return (
                <line
                  key={`mm-${edge.source}-${edge.target}`}
                  stroke="#52525b"
                  strokeOpacity={0.4}
                  strokeWidth={0.5}
                  x1={sp.x * minimapScale}
                  x2={tp.x * minimapScale}
                  y1={sp.y * minimapScale}
                  y2={tp.y * minimapScale}
                />
              );
            })}
            {layoutNodes.map((node) => {
              const color = NODE_TYPE_SVG_COLORS[node.type];
              return (
                <circle
                  cx={node.x * minimapScale}
                  cy={node.y * minimapScale}
                  fill={node.id === selectedNodeId ? "#8b5cf6" : color}
                  key={`mm-${node.id}`}
                  r={2}
                />
              );
            })}
            {/* Viewport rectangle */}
            {containerRef.current && (
              <rect
                fill="none"
                height={(containerRef.current.clientHeight / height) * minimapH}
                rx={1}
                stroke="#a1a1aa"
                strokeOpacity={0.4}
                strokeWidth={1}
                width={(containerRef.current.clientWidth / width) * minimapW}
                x={(scrollPos.x / width) * minimapW}
                y={(scrollPos.y / height) * minimapH}
              />
            )}
          </svg>
        </div>
      </div>

      {/* Impact analysis legend */}
      {selectedNodeId && impactedNodes.size > 0 && (
        <div className="flex items-center gap-3 border-zinc-800 border-t px-3 py-1.5">
          <span className="text-[10px] text-zinc-500">Impact analysis:</span>
          <span className="flex items-center gap-1 text-[10px] text-violet-400">
            <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
            Selected
          </span>
          <span className="flex items-center gap-1 text-[10px] text-red-400">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            Impacted ({impactedNodes.size})
          </span>
        </div>
      )}
    </div>
  );
}
