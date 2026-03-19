"use client";

import { useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface DecisionNode {
  children?: DecisionNode[];
  id: string;
  label: string;
  score: number;
  selected?: boolean;
  visits: number;
}

interface DecisionTreeViewerProps {
  onNodeSelect?: (nodeId: string) => void;
  root: DecisionNode;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getScoreColor(score: number): string {
  if (score >= 0.8) {
    return "border-green-500/50 bg-green-500/10 text-green-400";
  }
  if (score >= 0.6) {
    return "border-blue-500/50 bg-blue-500/10 text-blue-400";
  }
  if (score >= 0.4) {
    return "border-yellow-500/50 bg-yellow-500/10 text-yellow-400";
  }
  if (score >= 0.2) {
    return "border-orange-500/50 bg-orange-500/10 text-orange-400";
  }
  return "border-red-500/50 bg-red-500/10 text-red-400";
}

function getScoreBarColor(score: number): string {
  if (score >= 0.6) {
    return "bg-green-500/60";
  }
  if (score >= 0.3) {
    return "bg-yellow-500/60";
  }
  return "bg-red-500/60";
}

function getScoreBarWidth(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function getNodeStyle(
  isSelected: boolean,
  onPath: boolean,
  scoreColor: string
): string {
  if (isSelected) {
    return "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/20";
  }
  if (onPath) {
    return "border-violet-500/30 bg-violet-500/5";
  }
  return scoreColor;
}

function isOnSelectedPath(node: DecisionNode): boolean {
  if (node.selected) {
    return true;
  }
  if (node.children) {
    return node.children.some(isOnSelectedPath);
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Tree Node Component                                                        */
/* -------------------------------------------------------------------------- */

function TreeNode({
  depth,
  node,
  onNodeSelect,
}: {
  depth: number;
  node: DecisionNode;
  onNodeSelect?: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2 || isOnSelectedPath(node));
  const hasChildren = node.children && node.children.length > 0;
  const onPath = isOnSelectedPath(node);
  const scoreColor = getScoreColor(node.score);

  return (
    <div className="relative">
      {/* Connector line from parent */}
      {depth > 0 && (
        <div className="absolute -top-3 left-3 h-3 w-px bg-zinc-700" />
      )}

      {/* Node */}
      <button
        className={`group relative w-full rounded-lg border p-2.5 text-left transition-all ${getNodeStyle(
          node.selected ?? false,
          onPath,
          scoreColor
        )}`}
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          }
          onNodeSelect?.(node.id);
        }}
        type="button"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {/* Expand/collapse indicator */}
            {hasChildren && (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-zinc-800 text-[10px] text-zinc-400">
                {expanded ? "-" : "+"}
              </span>
            )}
            {!hasChildren && <span className="w-4" />}

            {/* Selected path marker */}
            {node.selected && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
            )}

            {/* Label */}
            <span
              className={`truncate text-xs ${
                node.selected ? "font-medium text-violet-300" : "text-zinc-300"
              }`}
            >
              {node.label}
            </span>
          </div>

          {/* Score badge */}
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500">
              v:{node.visits}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${scoreColor}`}
            >
              {(node.score * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Score bar */}
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              node.selected ? "bg-violet-500" : getScoreBarColor(node.score)
            }`}
            style={{ width: getScoreBarWidth(node.score) }}
          />
        </div>
      </button>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="relative mt-1 ml-6 space-y-1">
          {/* Vertical connector line */}
          <div
            className="absolute top-0 left-3 w-px bg-zinc-800"
            style={{
              height: "calc(100% - 12px)",
            }}
          />

          {node.children?.map((child, _idx) => (
            <div className="relative" key={child.id}>
              {/* Horizontal connector */}
              <div className="absolute top-5 -left-3 h-px w-3 bg-zinc-800" />

              <TreeNode
                depth={depth + 1}
                node={child}
                onNodeSelect={onNodeSelect}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function DecisionTreeViewer({
  root,
  onNodeSelect,
}: DecisionTreeViewerProps) {
  const [_selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  function handleSelect(nodeId: string) {
    setSelectedNodeId(nodeId);
    onNodeSelect?.(nodeId);
  }

  // Count total nodes and selected path length
  function countNodes(node: DecisionNode): number {
    let count = 1;
    if (node.children) {
      for (const child of node.children) {
        count += countNodes(child);
      }
    }
    return count;
  }

  function countSelectedPath(node: DecisionNode): number {
    if (node.selected) {
      let count = 1;
      if (node.children) {
        for (const child of node.children) {
          count += countSelectedPath(child);
        }
      }
      return count;
    }
    if (node.children) {
      for (const child of node.children) {
        const childCount = countSelectedPath(child);
        if (childCount > 0) {
          return 1 + childCount;
        }
      }
    }
    return 0;
  }

  const totalNodes = countNodes(root);
  const pathLength = countSelectedPath(root);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
            Decision Tree (MCTS)
          </h3>
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span>{totalNodes} strategies explored</span>
            {pathLength > 0 && (
              <span className="text-violet-400">
                {pathLength} nodes on selected path
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 border-zinc-800 border-b px-3 py-1.5">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-violet-500" />
          <span className="text-[10px] text-zinc-500">Selected</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-[10px] text-zinc-500">High confidence</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-yellow-500" />
          <span className="text-[10px] text-zinc-500">Medium</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-[10px] text-zinc-500">Low</span>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-3">
        <TreeNode depth={0} node={root} onNodeSelect={handleSelect} />
      </div>
    </div>
  );
}
