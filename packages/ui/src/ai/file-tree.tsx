"use client";
import { useState } from "react";
import { cn } from "../lib/utils";

interface FileNode {
  children?: FileNode[];
  name: string;
  path: string;
  status?: "added" | "modified" | "deleted" | "unchanged";
  type: "file" | "directory";
}

interface FileTreeProps {
  className?: string;
  files: FileNode[];
  onFileClick?: (path: string) => void;
}

export function FileTree({ files, onFileClick, className }: FileTreeProps) {
  return (
    <div className={cn("font-mono text-sm", className)}>
      {files.map((node) => (
        <FileTreeNode
          depth={0}
          key={node.path}
          node={node}
          onFileClick={onFileClick}
        />
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
  const [expanded, setExpanded] = useState(true);

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
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted"
          onClick={() => setExpanded(!expanded)}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          type="button"
        >
          <span className="text-xs">{expanded ? "▼" : "▶"}</span>
          <span className="text-muted-foreground">{node.name}/</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <FileTreeNode
              depth={depth + 1}
              key={child.path}
              node={child}
              onFileClick={onFileClick}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={cn(
        "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted",
        statusColor
      )}
      onClick={() => onFileClick?.(node.path)}
      style={{ paddingLeft: `${depth * 16 + 20}px` }}
      type="button"
    >
      <span>{node.name}</span>
    </button>
  );
}
