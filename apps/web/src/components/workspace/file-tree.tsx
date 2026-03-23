"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileTreeNode {
  children?: FileTreeNode[];
  name: string;
  path: string;
  /** "modified" | "new" | "deleted" | undefined for unchanged */
  status?: "modified" | "new" | "deleted";
  type: "file" | "directory";
}

interface FileTreeProps {
  files: FileTreeNode[];
  onSelectFile: (path: string) => void;
  selectedPath?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  modified: "text-blue-400",
  new: "text-green-400",
  deleted: "text-red-400",
};

const STATUS_ICONS: Record<string, string> = {
  modified: "M",
  new: "+",
  deleted: "D",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TreeNodeItem({
  node,
  depth,
  expandedPaths,
  onToggle,
  onSelect,
  selectedPath,
  searchQuery,
}: {
  depth: number;
  expandedPaths: Set<string>;
  node: FileTreeNode;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  searchQuery: string;
  selectedPath?: string;
}) {
  const isDirectory = node.type === "directory";
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = node.path === selectedPath;
  const statusColor = node.status ? STATUS_COLORS[node.status] : undefined;
  const statusIcon = node.status ? STATUS_ICONS[node.status] : undefined;

  // Filter by search query
  const matchesSearch =
    searchQuery === "" ||
    node.name.toLowerCase().includes(searchQuery.toLowerCase());

  const hasMatchingChildren = useMemo(() => {
    if (searchQuery === "" || !node.children) {
      return true;
    }
    const checkChildren = (children: FileTreeNode[]): boolean =>
      children.some(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (c.children ? checkChildren(c.children) : false)
      );
    return checkChildren(node.children);
  }, [node.children, searchQuery]);

  if (!(matchesSearch || hasMatchingChildren)) {
    return null;
  }

  const handleClick = () => {
    if (isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <>
      <button
        className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-left font-mono text-xs transition-colors hover:bg-zinc-800/50 ${
          isSelected ? "bg-violet-500/10 text-violet-300" : "text-zinc-400"
        }`}
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        type="button"
      >
        {/* Expand/collapse icon for directories */}
        {isDirectory ? (
          <svg
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="m9 5 7 7-7 7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span className="inline-block w-3 shrink-0" />
        )}

        {/* File/folder icon */}
        {isDirectory ? (
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 ${statusColor ?? "text-zinc-600"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {/* Name */}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>

        {/* Status badge */}
        {statusIcon && (
          <span
            className={`shrink-0 font-medium text-[10px] ${statusColor ?? "text-zinc-600"}`}
          >
            {statusIcon}
          </span>
        )}
      </button>

      {/* Children */}
      {isDirectory &&
        isExpanded &&
        node.children?.map((child) => (
          <TreeNodeItem
            depth={depth + 1}
            expandedPaths={expandedPaths}
            key={child.path}
            node={child}
            onSelect={onSelect}
            onToggle={onToggle}
            searchQuery={searchQuery}
            selectedPath={selectedPath}
          />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FileTree({ files, onSelectFile, selectedPath }: FileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (path: string) => {
      onSelectFile(path);
    },
    [onSelectFile]
  );

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Search filter */}
      <div className="border-zinc-800 border-b px-2 py-1.5">
        <input
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-violet-500/50"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter files..."
          type="text"
          value={searchQuery}
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto py-1">
        {files.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No files
          </div>
        ) : (
          files.map((node) => (
            <TreeNodeItem
              depth={0}
              expandedPaths={expandedPaths}
              key={node.path}
              node={node}
              onSelect={handleSelect}
              onToggle={handleToggle}
              searchQuery={searchQuery}
              selectedPath={selectedPath}
            />
          ))
        )}
      </div>
    </div>
  );
}
