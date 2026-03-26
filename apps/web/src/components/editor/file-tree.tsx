"use client";

import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface FileTreeNode {
  children?: FileTreeNode[];
  name: string;
  path: string;
  type: "file" | "directory";
}

interface EditorFileTreeProps {
  activeFilePath?: string;
  className?: string;
  modifiedFiles?: Set<string>;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onDeleteFile?: (path: string) => void;
  onRenameFile?: (path: string) => void;
  onSelectFile?: (path: string) => void;
  root: FileTreeNode[];
}

interface ContextMenuState {
  node: FileTreeNode;
  x: number;
  y: number;
}

/* -------------------------------------------------------------------------- */
/*  File extension color mapping                                               */
/* -------------------------------------------------------------------------- */

const EXT_COLORS: Record<string, string> = {
  ts: "text-blue-400",
  tsx: "text-blue-400",
  js: "text-yellow-400",
  jsx: "text-yellow-400",
  mjs: "text-yellow-400",
  py: "text-green-400",
  css: "text-purple-400",
  scss: "text-purple-400",
  less: "text-purple-400",
  html: "text-orange-400",
  json: "text-yellow-300",
  md: "text-zinc-400",
  rs: "text-orange-500",
  go: "text-cyan-400",
  java: "text-red-400",
  rb: "text-red-500",
  sql: "text-blue-300",
  sh: "text-green-300",
  yaml: "text-pink-400",
  yml: "text-pink-400",
  toml: "text-pink-300",
  xml: "text-orange-300",
  svg: "text-orange-300",
  graphql: "text-pink-500",
};

const EXT_LABELS: Record<string, string> = {
  ts: "TS",
  tsx: "TX",
  js: "JS",
  jsx: "JX",
  py: "Py",
  css: "#",
  html: "<>",
  json: "{}",
  md: "Md",
  rs: "Rs",
  go: "Go",
  java: "Jv",
  rb: "Rb",
  sql: "Sq",
  sh: "$",
  yaml: "~",
  yml: "~",
};

function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function getFileColor(name: string): string {
  const ext = getFileExt(name);
  return EXT_COLORS[ext] ?? "text-zinc-500";
}

function getFileLabel(name: string): string {
  const ext = getFileExt(name);
  return EXT_LABELS[ext] ?? "  ";
}

/* -------------------------------------------------------------------------- */
/*  Tree Node                                                                  */
/* -------------------------------------------------------------------------- */

function TreeNodeItem({
  node,
  depth,
  expanded,
  activeFilePath,
  modifiedFiles,
  onToggle,
  onSelect,
  onContextMenu,
}: {
  activeFilePath?: string;
  depth: number;
  expanded: Set<string>;
  modifiedFiles?: Set<string>;
  node: FileTreeNode;
  onContextMenu: (e: ReactMouseEvent, node: FileTreeNode) => void;
  onSelect?: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const isActive = activeFilePath === node.path;
  const isModified = modifiedFiles?.has(node.path) ?? false;
  const isDir = node.type === "directory";

  const handleClick = useCallback(() => {
    if (isDir) {
      onToggle(node.path);
    } else {
      onSelect?.(node.path);
    }
  }, [isDir, node.path, onToggle, onSelect]);

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      onContextMenu(e, node);
    },
    [node, onContextMenu]
  );

  // Sort children: directories first, then files, alphabetical within each
  const sortedChildren = useMemo(() => {
    if (!node.children) {
      return [];
    }
    return [...node.children].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [node.children]);

  return (
    <>
      <button
        className={`flex w-full items-center gap-1 py-0.5 pr-2 text-left text-xs hover:bg-zinc-800/60 ${
          isActive ? "bg-violet-500/10 text-violet-300" : ""
        }`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        type="button"
      >
        {/* Expand/collapse chevron */}
        <span className="w-4 shrink-0 text-center text-zinc-600">
          {(() => {
            if (!isDir) {
              return " ";
            }
            return isExpanded ? "v" : ">";
          })()}
        </span>

        {/* Icon / label */}
        <span
          className={`w-5 shrink-0 font-mono text-[10px] ${isDir ? "text-zinc-500" : getFileColor(node.name)}`}
        >
          {(() => {
            if (!isDir) {
              return getFileLabel(node.name);
            }
            return isExpanded ? "[]" : "[+]";
          })()}
        </span>

        {/* Name */}
        <span
          className={`min-w-0 flex-1 truncate ${isActive ? "text-violet-300" : "text-zinc-300"}`}
        >
          {node.name}
        </span>

        {/* Modified dot */}
        {isModified && (
          <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-yellow-400" />
        )}
      </button>

      {isDir &&
        isExpanded &&
        sortedChildren.map((child) => (
          <TreeNodeItem
            activeFilePath={activeFilePath}
            depth={depth + 1}
            expanded={expanded}
            key={child.path}
            modifiedFiles={modifiedFiles}
            node={child}
            onContextMenu={onContextMenu}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Context Menu                                                               */
/* -------------------------------------------------------------------------- */

function ContextMenu({
  state,
  onClose,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onRename,
}: {
  onClose: () => void;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onDelete?: (path: string) => void;
  onRename?: (path: string) => void;
  state: ContextMenuState;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  const parentPath =
    state.node.type === "directory"
      ? state.node.path
      : state.node.path.split("/").slice(0, -1).join("/");

  const items = [
    {
      label: "New File",
      action: () => onCreateFile?.(parentPath),
    },
    {
      label: "New Folder",
      action: () => onCreateFolder?.(parentPath),
    },
    {
      label: "---",
      action: () => {
        /* no-op: separator */
      },
    },
    {
      label: "Rename",
      action: () => onRename?.(state.node.path),
    },
    {
      label: "Delete",
      action: () => onDelete?.(state.node.path),
      className: "text-red-400 hover:bg-red-500/10",
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
          }
        }}
        role="presentation"
      />
      {/* Menu */}
      <div
        className="fixed z-50 min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        ref={menuRef}
        style={{ top: state.y, left: state.x }}
      >
        {items.map((item) =>
          item.label === "---" ? (
            <div className="my-1 border-zinc-800 border-t" key="separator" />
          ) : (
            <button
              className={`w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${item.className ?? "text-zinc-300"}`}
              key={item.label}
              onClick={() => {
                item.action();
                onClose();
              }}
              type="button"
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function EditorFileTree({
  root,
  activeFilePath,
  modifiedFiles,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  className = "",
}: EditorFileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand root-level directories
    const initial = new Set<string>();
    for (const node of root) {
      if (node.type === "directory") {
        initial.add(node.path);
      }
    }
    return initial;
  });

  const [filter, setFilter] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent, node: FileTreeNode) => {
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    []
  );

  // Filter logic: if filter is set, show only matching files and their parent directories
  const filteredRoot = useMemo(() => {
    if (!filter.trim()) {
      return root;
    }

    const lowerFilter = filter.toLowerCase();

    function filterNode(node: FileTreeNode): FileTreeNode | null {
      if (node.type === "file") {
        return node.name.toLowerCase().includes(lowerFilter) ? node : null;
      }

      const filteredChildren = (node.children ?? [])
        .map(filterNode)
        .filter((n): n is FileTreeNode => n !== null);

      if (filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }

      return null;
    }

    return root.map(filterNode).filter((n): n is FileTreeNode => n !== null);
  }, [root, filter]);

  return (
    <div className={`flex h-full flex-col bg-zinc-900/50 ${className}`}>
      {/* Search filter */}
      <div className="border-zinc-800 border-b px-2 py-1.5">
        <input
          aria-label="Filter files"
          className="w-full rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 outline-none focus:border-violet-500"
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files..."
          type="text"
          value={filter}
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto py-1">
        {filteredRoot.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            {filter ? "No matching files" : "No files"}
          </div>
        ) : (
          filteredRoot.map((node) => (
            <TreeNodeItem
              activeFilePath={activeFilePath}
              depth={0}
              expanded={expanded}
              key={node.path}
              modifiedFiles={modifiedFiles}
              node={node}
              onContextMenu={handleContextMenu}
              onSelect={onSelectFile}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          onClose={() => setContextMenu(null)}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onDelete={onDeleteFile}
          onRename={onRenameFile}
          state={contextMenu}
        />
      )}
    </div>
  );
}
