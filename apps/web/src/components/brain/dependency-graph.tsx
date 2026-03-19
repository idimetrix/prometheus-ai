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
import { useCallback, useEffect, useRef, useState } from "react";

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
  default: "#8b5cf6",
};

function getNodeColor(type: string): string {
  return FILE_TYPE_COLORS[type] ?? "#8b5cf6";
}

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
  const [pan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

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

  const handleMouseDown = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
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

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) {
        return;
      }
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
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => setDragging(null), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.3, Math.min(3, prev - e.deltaY * 0.001)));
  }, []);

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: interactive graph visualization
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: graph has interactive drag/zoom
    <svg
      className="rounded-lg border border-border bg-card"
      height={height}
      onMouseLeave={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      ref={svgRef}
      role="img"
      width={width}
    >
      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
        {simLinks.map((link) => {
          const sx = link.source.x ?? 0;
          const sy = link.source.y ?? 0;
          const tx = link.target.x ?? 0;
          const ty = link.target.y ?? 0;
          const hl =
            hoveredNode === link.source.id || hoveredNode === link.target.id;
          return (
            <line
              key={`${link.source.id}-${link.target.id}`}
              stroke={hl ? "#8b5cf6" : "#3f3f46"}
              strokeOpacity={hl ? 0.8 : 0.3}
              strokeWidth={hl ? 2 : Math.max(1, (link.strength ?? 1) * 1.5)}
              x1={sx}
              x2={tx}
              y1={sy}
              y2={ty}
            />
          );
        })}

        {simNodes.map((node) => {
          const isHov = hoveredNode === node.id;
          const color = getNodeColor(node.type);
          const nx = node.x ?? 0;
          const ny = node.y ?? 0;
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG <g> cannot be replaced with <button>
            <g
              className="cursor-pointer"
              key={node.id}
              onClick={() => onNodeClick?.(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onNodeClick?.(node.id);
                }
              }}
              onMouseDown={(e) => handleMouseDown(node.id, e)}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              role="button"
              tabIndex={0}
              transform={`translate(${nx},${ny})`}
            >
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
                {node.label.length > 12
                  ? `${node.label.slice(0, 10)}...`
                  : node.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
