"use client";

import { useCallback, useState } from "react";
import { type FileEntry, useSessionStore } from "@/stores/session.store";

interface FileTreeNodeProps {
  depth: number;
  entry: FileEntry;
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  added: "text-green-400 animate-pulse",
  modified: "text-yellow-400 animate-pulse",
  deleted: "text-red-400 animate-pulse line-through",
};

function FileTreeNode({
  entry,
  depth,
  onSelectFile,
  selectedPath,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDirectory = entry.type === "directory";
  const isSelected = entry.path === selectedPath;
  const statusClass = entry.status ? (STATUS_STYLES[entry.status] ?? "") : "";

  const handleClick = useCallback(() => {
    if (isDirectory) {
      setExpanded((prev) => !prev);
    } else {
      onSelectFile(entry.path);
    }
  }, [isDirectory, entry.path, onSelectFile]);

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-0.5 text-left text-sm transition-colors ${
          isSelected
            ? "bg-violet-500/15 text-violet-300"
            : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
        } ${statusClass}`}
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={entry.path}
        type="button"
      >
        {isDirectory ? (
          <span className="shrink-0 text-xs text-zinc-600">
            {expanded ? "\u25BE" : "\u25B8"}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-zinc-600">{"\u2022"}</span>
        )}
        <span className="min-w-0 truncate">{entry.name}</span>
        {entry.status && (
          <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider opacity-60">
            {entry.status[0]}
          </span>
        )}
      </button>
      {isDirectory && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeNode
              depth={depth + 1}
              entry={child}
              key={child.path}
              onSelectFile={onSelectFile}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTreePanel() {
  const fileTree = useSessionStore((s) => s.fileTree);
  const activeFilePath = useSessionStore((s) => s.activeFilePath);
  const openFile = useSessionStore((s) => s.openFile);

  const handleSelectFile = useCallback(
    (path: string) => {
      openFile(path);
    },
    [openFile]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          Files
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {fileTree.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-zinc-600">
            No files yet
          </div>
        ) : (
          fileTree.map((entry) => (
            <FileTreeNode
              depth={0}
              entry={entry}
              key={entry.path}
              onSelectFile={handleSelectFile}
              selectedPath={activeFilePath}
            />
          ))
        )}
      </div>
    </div>
  );
}
