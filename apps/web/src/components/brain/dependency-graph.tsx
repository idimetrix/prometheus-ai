"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Minus, Plus, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string;
  strength?: number;
  target: string;
}

interface DependencyGraphProps {
  edges: GraphEdge[];
  height?: number;
  nodes: GraphNode[];
  onNodeClick?: (nodeId: string) => void;
  width?: number;
}

interface D3Node extends SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
}

interface D3Link extends SimulationLinkDatum<D3Node> {
  strength?: number;
}

const NODE_RADIUS = 24;

const FILE_TYPE_COLORS: Record<string, string> = {
  ts: "#3b82f6",
  tsx: "#06b6d4",
  js: "#eab308",
  jsx: "#f97316",
  py: "#22c55e",
  go: "#06b6d4",
  rs: "#f97316",
  css: "#ec4899",
  html: "#ef4444",
  json: "#a1a1aa",
  module: "#8b5cf6",
  component: "#a855f7",
  file: "#64748b",
  default: "#8b5cf6",
};

const FILE_TYPE_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  py: "Python",
  go: "Go",
  rs: "Rust",
  css: "CSS",
  html: "HTML",
  json: "JSON",
  module: "Module",
  component: "Component",
  file: "File",
  default: "Other",
};

function getNodeColor(type: string): string {
  return FILE_TYPE_COLORS[type] ?? "#8b5cf6";
}

/* -------------------------------------------------------------------------- */
/*  Zoom Controls                                                              */
/* -------------------------------------------------------------------------- */

function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  zoom: number;
}) {
  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
      <button
        className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        onClick={onZoomIn}
        title="Zoom in"
        type="button"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        onClick={onZoomOut}
        title="Zoom out"
        type="button"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        onClick={onZoomReset}
        title="Reset zoom"
        type="button"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      <div className="mt-1 text-center font-mono text-[9px] text-zinc-600">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Legend                                                                      */
/* -------------------------------------------------------------------------- */

function GraphLegend({
  visibleTypes,
  activeTypes,
  onToggleType,
}: {
  activeTypes: Set<string>;
  onToggleType: (type: string) => void;
  visibleTypes: string[];
}) {
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/90 p-2">
      {visibleTypes.map((type) => {
        const color = getNodeColor(type);
        const label = FILE_TYPE_LABELS[type] ?? type;
        const isActive = activeTypes.has(type);

        return (
          <button
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] transition-opacity ${
              isActive ? "opacity-100" : "opacity-40"
            }`}
            key={type}
            onClick={() => onToggleType(type)}
            type="button"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-zinc-400">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Search / Filter Input                                                      */
/* -------------------------------------------------------------------------- */

function GraphSearch({
  value,
  onChange,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1">
      <Search className="h-3 w-3 text-zinc-500" />
      <input
        className="w-32 bg-transparent text-xs text-zinc-300 outline-none placeholder:text-zinc-600"
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search nodes..."
        type="text"
        value={value}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hover Tooltip                                                              */
/* -------------------------------------------------------------------------- */

function NodeTooltip({ node, x, y }: { node: D3Node; x: number; y: number }) {
  const typeLabel = FILE_TYPE_LABELS[node.type] ?? node.type;
  const color = getNodeColor(node.type);

  return (
    <div
      className="pointer-events-none absolute z-50 rounded-lg border border-zinc-800 bg-zinc-950 p-2 shadow-xl"
      style={{ left: x + 20, top: y - 40 }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium text-xs text-zinc-200">{node.label}</span>
      </div>
      <div className="mt-1 space-y-0.5 text-[10px] text-zinc-500">
        <div>
          Type: <span className="text-zinc-400">{typeLabel}</span>
        </div>
        <div>
          ID: <span className="font-mono text-zinc-400">{node.id}</span>
        </div>
      </div>
      <div className="mt-1 text-[9px] text-zinc-600">Click to navigate</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Render helpers                                                             */
/* -------------------------------------------------------------------------- */

function computeLinkOpacity(
  hl: boolean,
  searchHl: boolean,
  hasSearch: boolean
): number {
  if (hasSearch && !searchHl) {
    return 0.08;
  }
  if (hl) {
    return 0.8;
  }
  return 0.3;
}

function renderLink(
  link: D3Link & { source: D3Node; target: D3Node },
  isNodeVisible: (node: D3Node) => boolean,
  isNodeHighlighted: (nodeId: string) => boolean,
  hoveredNode: string | null,
  searchMatches: Set<string> | null
): React.ReactNode {
  if (!(isNodeVisible(link.source) && isNodeVisible(link.target))) {
    return null;
  }

  const sx = link.source.x ?? 0;
  const sy = link.source.y ?? 0;
  const tx = link.target.x ?? 0;
  const ty = link.target.y ?? 0;
  const hl = hoveredNode === link.source.id || hoveredNode === link.target.id;
  const searchHl =
    searchMatches !== null &&
    (isNodeHighlighted(link.source.id) || isNodeHighlighted(link.target.id));
  const linkOpacity = computeLinkOpacity(hl, searchHl, searchMatches !== null);

  return (
    <line
      key={`${link.source.id}-${link.target.id}`}
      stroke={hl || searchHl ? "#8b5cf6" : "#3f3f46"}
      strokeOpacity={linkOpacity}
      strokeWidth={hl ? 2 : Math.max(1, (link.strength ?? 1) * 1.5)}
      x1={sx}
      x2={tx}
      y1={sy}
      y2={ty}
    />
  );
}

function renderNode(
  node: D3Node,
  isNodeVisible: (node: D3Node) => boolean,
  isNodeHighlighted: (nodeId: string) => boolean,
  hoveredNode: string | null,
  searchMatches: Set<string> | null,
  onNodeClick: ((nodeId: string) => void) | undefined,
  handleNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void,
  setHoveredNode: (nodeId: string | null) => void
): React.ReactNode {
  if (!isNodeVisible(node)) {
    return null;
  }

  const isHov = hoveredNode === node.id;
  const isSearchMatch = isNodeHighlighted(node.id);
  const dimmed = searchMatches !== null && !isSearchMatch;
  const color = getNodeColor(node.type);
  const nx = node.x ?? 0;
  const ny = node.y ?? 0;

  return (
    <g
      className="cursor-pointer"
      key={node.id}
      onClick={() => onNodeClick?.(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNodeClick?.(node.id);
        }
      }}
      onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
      onMouseEnter={() => setHoveredNode(node.id)}
      onMouseLeave={() => setHoveredNode(null)}
      opacity={dimmed ? 0.2 : 1}
      role="button"
      tabIndex={0}
      transform={`translate(${nx},${ny})`}
    >
      {isSearchMatch && (
        <circle
          fill="none"
          r={NODE_RADIUS + 8}
          stroke="#8b5cf6"
          strokeDasharray="4 2"
          strokeOpacity={0.6}
          strokeWidth={1.5}
        />
      )}
      <circle
        fill={color}
        fillOpacity={isHov ? 0.3 : 0.15}
        r={isHov ? NODE_RADIUS + 4 : NODE_RADIUS}
        stroke={color}
        strokeOpacity={isHov ? 1 : 0.6}
        strokeWidth={isHov ? 2 : 1}
      />
      <text
        className="select-none"
        dominantBaseline="middle"
        fill="#fafafa"
        fontSize={10}
        textAnchor="middle"
      >
        {node.label.length > 12 ? `${node.label.slice(0, 10)}...` : node.label}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/*  DependencyGraph (Enhanced)                                                 */
/* -------------------------------------------------------------------------- */

export function DependencyGraph({
  nodes,
  edges,
  width = 600,
  height = 400,
  onNodeClick,
}: DependencyGraphProps) {
  const [simNodes, setSimNodes] = useState<D3Node[]>([]);
  const [simLinks, setSimLinks] = useState<
    Array<{ source: D3Node; target: D3Node; strength?: number }>
  >([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Collect unique node types for legend
  const nodeTypes = useMemo(() => {
    const types = new Set<string>();
    for (const node of nodes) {
      types.add(node.type ?? "default");
    }
    return Array.from(types);
  }, [nodes]);

  // Initialize active types when nodes change
  useEffect(() => {
    setActiveTypes(new Set(nodeTypes));
  }, [nodeTypes]);

  // Search matching node IDs
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) {
      return null;
    }
    const query = searchQuery.toLowerCase();
    return new Set(
      nodes
        .filter(
          (n) =>
            n.label.toLowerCase().includes(query) ||
            n.id.toLowerCase().includes(query)
        )
        .map((n) => n.id)
    );
  }, [nodes, searchQuery]);

  useEffect(() => {
    if (nodes.length === 0) {
      setSimNodes([]);
      setSimLinks([]);
      return;
    }

    const d3Nodes: D3Node[] = nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type ?? "default",
      x: n.x,
      y: n.y,
    }));

    const d3Links: D3Link[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      strength: e.strength,
    }));

    const sim = forceSimulation(d3Nodes)
      .force(
        "link",
        forceLink<D3Node, D3Link>(d3Links)
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", forceManyBody().strength(-300))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide(NODE_RADIUS + 4));

    sim.on("tick", () => {
      for (const node of d3Nodes) {
        node.x = Math.max(
          NODE_RADIUS,
          Math.min(width - NODE_RADIUS, node.x ?? 0)
        );
        node.y = Math.max(
          NODE_RADIUS,
          Math.min(height - NODE_RADIUS, node.y ?? 0)
        );
      }
      setSimNodes([...d3Nodes]);
      setSimLinks(
        d3Links.map((l) => ({
          source: l.source as unknown as D3Node,
          target: l.target as unknown as D3Node,
          strength: l.strength,
        }))
      );
    });

    sim.alpha(1).restart();

    return () => {
      sim.stop();
    };
  }, [nodes, edges, width, height]);

  const handleNodeMouseDown = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const node = simNodes.find((n) => n.id === nodeId);
      if (!node) {
        return;
      }
      dragOffsetRef.current = {
        x: e.clientX - (node.x ?? 0),
        y: e.clientY - (node.y ?? 0),
      };
      setDragging(nodeId);
    },
    [simNodes]
  );

  const handleSvgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only pan when clicking on empty area (not on a node)
      if (
        (e.target as Element).tagName === "svg" ||
        (e.target as Element).tagName === "rect"
      ) {
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: pan.x,
          panY: pan.y,
        };
      }
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging) {
        setSimNodes((prev) =>
          prev.map((n) =>
            n.id === dragging
              ? {
                  ...n,
                  x: e.clientX - dragOffsetRef.current.x,
                  y: e.clientY - dragOffsetRef.current.y,
                  fx: e.clientX - dragOffsetRef.current.x,
                  fy: e.clientY - dragOffsetRef.current.y,
                }
              : n
          )
        );
      } else if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan({
          x: panStartRef.current.panX + dx,
          y: panStartRef.current.panY + dy,
        });
      }
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.3, Math.min(3, prev - e.deltaY * 0.001)));
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(3, prev * 1.3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(0.3, prev / 1.3));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleToggleType = useCallback((type: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Determine node visibility based on active types
  const isNodeVisible = useCallback(
    (node: D3Node): boolean => {
      return activeTypes.has(node.type);
    },
    [activeTypes]
  );

  // Determine if node is highlighted by search
  const isNodeHighlighted = useCallback(
    (nodeId: string): boolean => {
      if (!searchMatches) {
        return false;
      }
      return searchMatches.has(nodeId);
    },
    [searchMatches]
  );

  // Get the hovered node data for tooltip
  const hoveredNodeData = useMemo(
    () => simNodes.find((n) => n.id === hoveredNode) ?? null,
    [simNodes, hoveredNode]
  );

  return (
    <div className="relative" style={{ width, height }}>
      {/* Search input */}
      <GraphSearch onChange={setSearchQuery} value={searchQuery} />

      {/* Zoom controls */}
      <ZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        zoom={zoom}
      />

      {/* Legend */}
      {nodeTypes.length > 0 && (
        <GraphLegend
          activeTypes={activeTypes}
          onToggleType={handleToggleType}
          visibleTypes={nodeTypes}
        />
      )}

      {/* Hover tooltip */}
      {hoveredNodeData && (
        <NodeTooltip
          node={hoveredNodeData}
          x={(hoveredNodeData.x ?? 0) * zoom + pan.x}
          y={(hoveredNodeData.y ?? 0) * zoom + pan.y}
        />
      )}

      <svg
        aria-label="Dependency graph"
        className="rounded-lg border border-border bg-card"
        height={height}
        onMouseDown={handleSvgMouseDown}
        onMouseLeave={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        ref={svgRef}
        role="application"
        width={width}
      >
        <title>Dependency graph</title>
        {/* Background rect for pan events */}
        <rect fill="transparent" height={height} width={width} />

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {simLinks.map((link) =>
            renderLink(
              link,
              isNodeVisible,
              isNodeHighlighted,
              hoveredNode,
              searchMatches
            )
          )}

          {simNodes.map((node) =>
            renderNode(
              node,
              isNodeVisible,
              isNodeHighlighted,
              hoveredNode,
              searchMatches,
              onNodeClick,
              handleNodeMouseDown,
              setHoveredNode
            )
          )}
        </g>
      </svg>
    </div>
  );
}
