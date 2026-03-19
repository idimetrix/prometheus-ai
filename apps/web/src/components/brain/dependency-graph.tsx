"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface GraphNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

interface DependencyGraphProps {
  edges: GraphEdge[];
  height?: number;
  nodes: GraphNode[];
  width?: number;
}

interface SimNode {
  id: string;
  label: string;
  vx: number;
  vy: number;
  x: number;
  y: number;
}

const NODE_RADIUS = 24;
const REPULSION = 2000;
const SPRING_K = 0.02;
const SPRING_LENGTH = 120;
const DAMPING = 0.9;
const SIMULATION_STEPS = 120;

export function DependencyGraph({
  nodes,
  edges,
  width = 600,
  height = 400,
}: DependencyGraphProps) {
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Initialize + run force simulation
  useEffect(() => {
    const initial: SimNode[] = nodes.map((n, i) => ({
      id: n.id,
      label: n.label,
      x: n.x ?? width / 2 + Math.cos((i / nodes.length) * Math.PI * 2) * 100,
      y: n.y ?? height / 2 + Math.sin((i / nodes.length) * Math.PI * 2) * 100,
      vx: 0,
      vy: 0,
    }));

    const nodeMap = new Map<string, SimNode>();
    for (const n of initial) {
      nodeMap.set(n.id, n);
    }

    for (let step = 0; step < SIMULATION_STEPS; step++) {
      // Repulsion between all pairs
      for (let i = 0; i < initial.length; i++) {
        for (let j = i + 1; j < initial.length; j++) {
          const a = initial[i] as SimNode;
          const b = initial[j] as SimNode;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = REPULSION / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Spring forces along edges
      for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!(source && target)) {
          continue;
        }
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const displacement = dist - SPRING_LENGTH;
        const force = SPRING_K * displacement;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      // Apply velocity + damping + bounds
      for (const n of initial) {
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(NODE_RADIUS, Math.min(width - NODE_RADIUS, n.x));
        n.y = Math.max(NODE_RADIUS, Math.min(height - NODE_RADIUS, n.y));
      }
    }

    setSimNodes([...initial]);
  }, [nodes, edges, width, height]);

  const handleMouseDown = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.preventDefault();
      const node = simNodes.find((n) => n.id === nodeId);
      if (!(node && svgRef.current)) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      dragOffsetRef.current = {
        x: e.clientX - rect.left - node.x,
        y: e.clientY - rect.top - node.y,
      };
      setDragging(nodeId);
    },
    [simNodes]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!(dragging && svgRef.current)) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      const x = Math.max(
        NODE_RADIUS,
        Math.min(
          width - NODE_RADIUS,
          e.clientX - rect.left - dragOffsetRef.current.x
        )
      );
      const y = Math.max(
        NODE_RADIUS,
        Math.min(
          height - NODE_RADIUS,
          e.clientY - rect.top - dragOffsetRef.current.y
        )
      );

      setSimNodes((prev) =>
        prev.map((n) => (n.id === dragging ? { ...n, x, y } : n))
      );
    },
    [dragging, width, height]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const nodeMap = new Map<string, SimNode>();
  for (const n of simNodes) {
    nodeMap.set(n.id, n);
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: interactive graph canvas for node dragging
    <div
      className="rounded-md border border-zinc-800 bg-zinc-950"
      onMouseLeave={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      role="application"
    >
      <svg
        className="w-full"
        height={height}
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <title>Dependency graph</title>

        {/* Edges */}
        {edges.map((edge) => {
          const source = nodeMap.get(edge.source);
          const target = nodeMap.get(edge.target);
          if (!(source && target)) {
            return null;
          }
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              stroke="rgb(63, 63, 70)"
              strokeWidth="1.5"
              x1={source.x}
              x2={target.x}
              y1={source.y}
              y2={target.y}
            />
          );
        })}

        {/* Nodes */}
        {simNodes.map((node) => (
          <g
            className={dragging === node.id ? "cursor-grabbing" : "cursor-grab"}
            key={node.id}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG circle used as draggable node */}
            <circle
              className="cursor-grab"
              cx={node.x}
              cy={node.y}
              fill="rgb(39, 39, 42)"
              onMouseDown={(e) => handleMouseDown(node.id, e)}
              r={NODE_RADIUS}
              stroke="rgb(139, 92, 246)"
              strokeWidth="2"
            />
            <text
              className="pointer-events-none select-none fill-zinc-300 text-[10px]"
              dominantBaseline="middle"
              textAnchor="middle"
              x={node.x}
              y={node.y}
            >
              {node.label.length > 8
                ? `${node.label.slice(0, 7)}...`
                : node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
