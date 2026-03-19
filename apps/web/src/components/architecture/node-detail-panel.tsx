"use client";

import { useMemo } from "react";
import type { ArchEdge, ArchNode, ArchNodeType } from "./architecture-explorer";

interface NodeDetailPanelProps {
  edges: ArchEdge[];
  node: ArchNode | null;
  nodes: ArchNode[];
  onClose?: () => void;
}

const TYPE_BADGE_COLORS: Record<ArchNodeType, string> = {
  file: "bg-blue-500/20 text-blue-400",
  function: "bg-green-500/20 text-green-400",
  class: "bg-purple-500/20 text-purple-400",
  module: "bg-amber-500/20 text-amber-400",
  interface: "bg-cyan-500/20 text-cyan-400",
  component: "bg-rose-500/20 text-rose-400",
  hook: "bg-teal-500/20 text-teal-400",
};

function impactBarColor(score: number): string {
  if (score >= 70) {
    return "bg-red-500";
  }
  if (score >= 40) {
    return "bg-amber-500";
  }
  return "bg-green-500";
}

function impactTextColor(score: number): string {
  if (score >= 70) {
    return "text-red-400";
  }
  if (score >= 40) {
    return "text-amber-400";
  }
  return "text-green-400";
}

function ConnectionItem({
  label,
  type,
  direction,
}: {
  direction: "in" | "out";
  label: string;
  type: ArchNodeType;
}) {
  const badgeColor = TYPE_BADGE_COLORS[type] ?? "bg-zinc-500/20 text-zinc-400";
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
      <span
        className={`text-[10px] ${direction === "in" ? "text-green-500" : "text-amber-500"}`}
      >
        {direction === "in" ? "\u2190" : "\u2192"}
      </span>
      <span
        className={`rounded-full px-1.5 py-0.5 font-medium text-[9px] ${badgeColor}`}
      >
        {type}
      </span>
      <span className="truncate text-xs text-zinc-300">{label}</span>
    </div>
  );
}

export function NodeDetailPanel({
  node,
  nodes,
  edges,
  onClose,
}: NodeDetailPanelProps) {
  const nodeMap = useMemo(() => {
    const map = new Map<string, ArchNode>();
    for (const n of nodes) {
      map.set(n.id, n);
    }
    return map;
  }, [nodes]);

  const incomingConnections = useMemo(
    () =>
      node
        ? edges
            .filter((e) => e.target === node.id)
            .map((e) => nodeMap.get(e.source))
            .filter((n): n is ArchNode => n !== undefined)
        : [],
    [node, edges, nodeMap]
  );

  const outgoingConnections = useMemo(
    () =>
      node
        ? edges
            .filter((e) => e.source === node.id)
            .map((e) => nodeMap.get(e.target))
            .filter((n): n is ArchNode => n !== undefined)
        : [],
    [node, edges, nodeMap]
  );

  const impactScore = useMemo(() => {
    if (!node) {
      return 0;
    }
    // Simple impact score: sum of direct + transitive dependents
    const visited = new Set<string>();
    const queue = [node.id];
    while (queue.length > 0) {
      const current = queue.pop();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const edge of edges) {
        if (edge.source === current && !visited.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }
    visited.delete(node.id);
    const totalNodes = nodes.length || 1;
    return Math.round((visited.size / totalNodes) * 100);
  }, [node, edges, nodes]);

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-xs text-zinc-600">Select a node to view details</p>
      </div>
    );
  }

  const badgeColor =
    TYPE_BADGE_COLORS[node.type] ?? "bg-zinc-500/20 text-zinc-400";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-start justify-between border-zinc-800 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${badgeColor}`}
            >
              {node.type}
            </span>
            <h3 className="truncate font-medium text-sm text-zinc-200">
              {node.label}
            </h3>
          </div>
          {node.filePath && (
            <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
              {node.filePath}
            </p>
          )}
        </div>
        {onClose && (
          <button
            className="ml-2 shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onClose}
            type="button"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <title>Close</title>
              <path
                d="M6 18L18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Impact Score */}
        <div>
          <h4 className="mb-1.5 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Impact Score
          </h4>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-all ${impactBarColor(impactScore)}`}
                style={{ width: `${impactScore}%` }}
              />
            </div>
            <span
              className={`font-bold font-mono text-xs ${impactTextColor(impactScore)}`}
            >
              {impactScore}%
            </span>
          </div>
        </div>

        {/* Incoming Connections */}
        <div>
          <h4 className="mb-1.5 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Incoming ({incomingConnections.length})
          </h4>
          {incomingConnections.length === 0 ? (
            <p className="text-xs text-zinc-600">No incoming connections</p>
          ) : (
            <div className="space-y-1">
              {incomingConnections.map((conn) => (
                <ConnectionItem
                  direction="in"
                  key={conn.id}
                  label={conn.label}
                  type={conn.type}
                />
              ))}
            </div>
          )}
        </div>

        {/* Outgoing Connections */}
        <div>
          <h4 className="mb-1.5 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Outgoing ({outgoingConnections.length})
          </h4>
          {outgoingConnections.length === 0 ? (
            <p className="text-xs text-zinc-600">No outgoing connections</p>
          ) : (
            <div className="space-y-1">
              {outgoingConnections.map((conn) => (
                <ConnectionItem
                  direction="out"
                  key={conn.id}
                  label={conn.label}
                  type={conn.type}
                />
              ))}
            </div>
          )}
        </div>

        {/* Code Preview */}
        {node.codeSnippet && (
          <div>
            <h4 className="mb-1.5 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
              Code Preview
            </h4>
            <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900/70 p-2 font-mono text-[11px] text-zinc-300 leading-relaxed">
              {node.codeSnippet}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
