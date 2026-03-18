"use client";
import * as React from "react";
import { cn } from "../lib/utils";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  status?: "added" | "modified" | "deleted" | "unchanged";
}

interface FileTreeProps {
  files: FileNode[];
  onFileClick?: (path: string) => void;
  className?: string;
}

export function FileTree({ files, onFileClick, className }: FileTreeProps) {
  return (
    <div className={cn("text-sm font-mono", className)}>
      {files.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={0} onFileClick={onFileClick} />
      ))}
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  onFileClick,
}: {
  node: FileNode;
  depth: number;
  onFileClick?: (path: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);

  const statusColors: Record<string, string> = {
    added: "text-green-500",
    modified: "text-yellow-500",
    deleted: "text-red-500",
    unchanged: "text-muted-foreground",
  };

  const statusColor = statusColors[node.status ?? "unchanged"];

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 hover:bg-muted text-left"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <span className="text-xs">{expanded ? "▼" : "▶"}</span>
          <span className="text-muted-foreground">{node.name}/</span>
        </button>
        {expanded && node.children?.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onFileClick?.(node.path)}
      className={cn(
        "flex w-full items-center gap-1 rounded px-1 py-0.5 hover:bg-muted text-left",
        statusColor
      )}
      style={{ paddingLeft: `${depth * 16 + 20}px` }}
    >
      <span>{node.name}</span>
    </button>
  );
}
