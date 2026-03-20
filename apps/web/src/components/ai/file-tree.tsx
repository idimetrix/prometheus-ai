"use client";

import { useCallback, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type FileStatus = "added" | "modified" | "deleted" | "renamed" | "unchanged";

interface FileTreeNode {
  children?: FileTreeNode[];
  name: string;
  path: string;
  status?: FileStatus;
  type: "file" | "directory";
}

interface FileTreeProps {
  className?: string;
  defaultExpanded?: Set<string>;
  highlightPaths?: Set<string>;
  onSelect?: (path: string) => void;
  root: FileTreeNode[];
  selectedPath?: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const FILE_TYPE_ICONS: Record<string, string> = {
  css: "# ",
  html: "< ",
  json: "{ ",
  md: "M ",
  ts: "TS",
  tsx: "TX",
  js: "JS",
  jsx: "JX",
  py: "Py",
  rs: "Rs",
  go: "Go",
  yaml: "~ ",
  yml: "~ ",
  toml: "~ ",
  sh: "$ ",
  sql: "DB",
};

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_TYPE_ICONS[ext] ?? "  ";
}

const STATUS_COLORS: Record<FileStatus, string> = {
  added: "text-green-400",
  deleted: "text-red-400",
  modified: "text-yellow-400",
  renamed: "text-blue-400",
  unchanged: "text-zinc-400",
};

const STATUS_BADGE: Record<FileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  unchanged: "",
};

/* -------------------------------------------------------------------------- */
/*  Tree node component                                                        */
/* -------------------------------------------------------------------------- */

function TreeNode({
  node,
  depth,
  expanded,
  selectedPath,
  highlightPaths,
  onToggle,
  onSelect,
}: {
  depth: number;
  expanded: Set<string>;
  highlightPaths?: Set<string>;
  node: FileTreeNode;
  onSelect?: (path: string) => void;
  onToggle: (path: string) => void;
  selectedPath?: string;
}) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const isHighlighted = highlightPaths?.has(node.path);
  const status = node.status ?? "unchanged";

  const handleClick = useCallback(() => {
    if (node.type === "directory") {
      onToggle(node.path);
    } else {
      onSelect?.(node.path);
    }
  }, [node.path, node.type, onToggle, onSelect]);

  return (
    <>
      <button
        className={`flex w-full items-center gap-1 py-0.5 pr-2 text-left text-xs hover:bg-zinc-800/60 ${
          isSelected ? "bg-zinc-800" : ""
        } ${isHighlighted ? "ring-1 ring-blue-500/30" : ""}`}
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        type="button"
      >
        {/* Expand/collapse indicator */}
        <span className="w-4 shrink-0 text-center text-zinc-600">
          {node.type === "directory" && isExpanded && "v"}
          {node.type === "directory" && !isExpanded && ">"}
          {node.type !== "directory" && " "}
        </span>

        {/* Icon */}
        <span className="w-5 shrink-0 font-mono text-[10px] text-zinc-500">
          {node.type === "directory" && isExpanded && "[] "}
          {node.type === "directory" && !isExpanded && "[+]"}
          {node.type !== "directory" && getFileIcon(node.name)}
        </span>

        {/* Name */}
        <span
          className={`flex-1 truncate ${
            status === "unchanged" ? "text-zinc-300" : STATUS_COLORS[status]
          }`}
        >
          {node.name}
        </span>

        {/* Status badge */}
        {status !== "unchanged" && (
          <span
            className={`shrink-0 font-mono text-[10px] ${STATUS_COLORS[status]}`}
          >
            {STATUS_BADGE[status]}
          </span>
        )}
      </button>

      {/* Children */}
      {node.type === "directory" &&
        isExpanded &&
        node.children?.map((child) => (
          <TreeNode
            depth={depth + 1}
            expanded={expanded}
            highlightPaths={highlightPaths}
            key={child.path}
            node={child}
            onSelect={onSelect}
            onToggle={onToggle}
            selectedPath={selectedPath}
          />
        ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function FileTree({
  root,
  selectedPath,
  highlightPaths,
  defaultExpanded = new Set<string>(),
  onSelect,
  className = "",
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <div
      className={`overflow-auto rounded-lg border border-zinc-700 bg-zinc-900/50 py-1 ${className}`}
    >
      {root.map((node) => (
        <TreeNode
          depth={0}
          expanded={expanded}
          highlightPaths={highlightPaths}
          key={node.path}
          node={node}
          onSelect={onSelect}
          onToggle={handleToggle}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

export type { FileStatus, FileTreeNode, FileTreeProps };
