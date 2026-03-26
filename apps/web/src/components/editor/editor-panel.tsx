"use client";

import { useCallback, useState } from "react";
import { DiffEditorPanel } from "./diff-editor";
import { type EditorTab, EditorTabs } from "./editor-tabs";
import { EditorFileTree, type FileTreeNode } from "./file-tree";
import type { EditorFile } from "./monaco-editor";
import { detectLanguage, MonacoEditor } from "./monaco-editor";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type ViewMode = "editor" | "diff";

interface DiffState {
  language: string;
  modified: string;
  original: string;
}

interface EditorPanelProps {
  /** Currently active file path in the editor */
  activeFilePath?: string;
  /** The file tree structure to display */
  className?: string;
  /** Current diff state when in diff mode */
  diff?: DiffState;
  /** File tree nodes */
  fileTree: FileTreeNode[];
  /** Whether files are still loading */
  isLoading?: boolean;
  /** Set of modified file paths for indicators */
  modifiedFiles?: Set<string>;
  /** Callback when diff is accepted */
  onAcceptDiff?: (content: string) => void;
  /** Callback to close a file tab */
  onCloseFile?: (path: string) => void;
  /** Callback to create a new file */
  onCreateFile?: (parentPath: string) => void;
  /** Callback to create a new folder */
  onCreateFolder?: (parentPath: string) => void;
  /** Callback to delete a file */
  onDeleteFile?: (path: string) => void;
  /** Callback when file content changes in editor */
  onFileChange?: (path: string, content: string) => void;
  /** Callback when diff is rejected */
  onRejectDiff?: () => void;
  /** Callback to rename a file */
  onRenameFile?: (path: string) => void;
  /** Callback to select/open a file */
  onSelectFile?: (path: string) => void;
  /** Open files to show as tabs */
  openFiles?: EditorTab[];
  /** Read-only mode (e.g. when agent is working) */
  readOnly?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Status Bar                                                                 */
/* -------------------------------------------------------------------------- */

function StatusBar({
  file,
  readOnly,
}: {
  file?: EditorFile;
  readOnly?: boolean;
}) {
  if (!file) {
    return (
      <div className="flex h-6 items-center border-zinc-800 border-t bg-zinc-900/50 px-3 text-[10px] text-zinc-600">
        No file open
      </div>
    );
  }

  const language = file.language ?? detectLanguage(file.path);
  const lineCount = file.content.split("\n").length;

  return (
    <div className="flex h-6 items-center gap-4 border-zinc-800 border-t bg-zinc-900/50 px-3 text-[10px] text-zinc-500">
      <span>{language}</span>
      <span>{lineCount} lines</span>
      <span>UTF-8</span>
      <span>Spaces: 2</span>
      {readOnly && (
        <span className="ml-auto rounded bg-yellow-500/20 px-1.5 py-0.5 text-yellow-400">
          READ ONLY
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Loading State                                                              */
/* -------------------------------------------------------------------------- */

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center gap-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        <span className="text-xs text-zinc-500">Loading files...</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty State                                                                */
/* -------------------------------------------------------------------------- */

function EmptyEditorState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-zinc-950 text-zinc-600">
      <svg
        aria-hidden="true"
        className="h-12 w-12 text-zinc-700"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        viewBox="0 0 24 24"
      >
        <path
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-sm">Select a file to start editing</span>
      <span className="text-xs text-zinc-700">
        Use the file tree on the left or press Ctrl+P to search
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Editor Panel                                                               */
/* -------------------------------------------------------------------------- */

export function EditorPanel({
  fileTree,
  openFiles = [],
  activeFilePath,
  modifiedFiles,
  readOnly = false,
  isLoading = false,
  diff,
  onSelectFile,
  onCloseFile,
  onFileChange,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onAcceptDiff,
  onRejectDiff,
  className = "",
}: EditorPanelProps) {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [isResizing, setIsResizing] = useState(false);

  // Build the current file for the editor
  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const currentEditorFile: EditorFile | undefined = activeFile
    ? {
        path: activeFile.path,
        content: "", // Content is managed by the parent via onChange
        language: detectLanguage(activeFile.path),
      }
    : undefined;

  const handleFileChange = useCallback(
    (content: string) => {
      if (activeFilePath) {
        onFileChange?.(activeFilePath, content);
      }
    },
    [activeFilePath, onFileChange]
  );

  // Switch to diff view if diff state is provided
  const effectiveViewMode = diff ? "diff" : viewMode;

  // Sidebar resize handler
  const handleResizeStart = useCallback(() => {
    setIsResizing(true);

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(160, Math.min(400, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div
      className={`flex h-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 ${className}`}
    >
      {/* File tree sidebar */}
      {!sidebarCollapsed && (
        <>
          <div className="shrink-0" style={{ width: sidebarWidth }}>
            <div className="flex h-full flex-col">
              {/* Sidebar header */}
              <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
                <span className="font-medium text-xs text-zinc-400">
                  Explorer
                </span>
                <button
                  className="rounded p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
                  onClick={() => setSidebarCollapsed(true)}
                  title="Collapse sidebar"
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              {/* File tree */}
              <EditorFileTree
                activeFilePath={activeFilePath}
                className="flex-1"
                modifiedFiles={modifiedFiles}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onSelectFile={onSelectFile}
                root={fileTree}
              />
            </div>
          </div>

          {/* Resize handle */}
          <div
            aria-valuemax={80}
            aria-valuemin={15}
            aria-valuenow={sidebarWidth}
            className={`w-1 shrink-0 cursor-col-resize hover:bg-violet-500/30 ${
              isResizing ? "bg-violet-500/30" : "bg-zinc-800"
            }`}
            onMouseDown={handleResizeStart}
            role="separator"
            tabIndex={0}
          />
        </>
      )}

      {/* Main editor area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Collapsed sidebar toggle */}
        {sidebarCollapsed && (
          <div className="border-zinc-800 border-b">
            <button
              className="px-2 py-1.5 text-zinc-600 hover:text-zinc-400"
              onClick={() => setSidebarCollapsed(false)}
              title="Expand sidebar"
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}

        {/* View mode toggle (only when diff is available) */}
        {diff && (
          <div className="flex items-center gap-1 border-zinc-800 border-b bg-zinc-900/30 px-2 py-1">
            <button
              className={`rounded px-2 py-0.5 text-[10px] ${
                effectiveViewMode === "editor"
                  ? "bg-violet-500/20 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => setViewMode("editor")}
              type="button"
            >
              Editor
            </button>
            <button
              className={`rounded px-2 py-0.5 text-[10px] ${
                effectiveViewMode === "diff"
                  ? "bg-violet-500/20 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => setViewMode("diff")}
              type="button"
            >
              Diff
            </button>
          </div>
        )}

        {/* Tab bar */}
        <EditorTabs
          activeTab={activeFilePath}
          onCloseTab={(path) => onCloseFile?.(path)}
          onSelectTab={(path) => onSelectFile?.(path)}
          tabs={openFiles}
        />

        {/* Editor content */}
        <div className="flex-1 overflow-hidden">
          {(() => {
            if (isLoading) {
              return <LoadingState />;
            }
            if (effectiveViewMode === "diff" && diff) {
              return (
                <DiffEditorPanel
                  language={diff.language}
                  modified={diff.modified}
                  onAccept={onAcceptDiff}
                  onReject={onRejectDiff}
                  original={diff.original}
                />
              );
            }
            if (currentEditorFile) {
              return (
                <MonacoEditor
                  file={currentEditorFile}
                  onChange={handleFileChange}
                  readOnly={readOnly}
                />
              );
            }
            return <EmptyEditorState />;
          })()}
        </div>

        {/* Status bar */}
        <StatusBar file={currentEditorFile} readOnly={readOnly} />
      </div>
    </div>
  );
}
