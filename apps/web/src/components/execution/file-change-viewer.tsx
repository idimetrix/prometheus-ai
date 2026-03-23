"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileChange {
  action: "created" | "modified" | "deleted";
  filePath: string;
  linesAdded: number;
  linesRemoved: number;
}

interface FileChangeViewerProps {
  changes: FileChange[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_STYLES: Record<
  FileChange["action"],
  { badge: string; dot: string; icon: string; label: string }
> = {
  created: {
    badge: "bg-green-500/20 text-green-300",
    dot: "bg-green-400",
    icon: "M12 4.5v15m7.5-7.5h-15",
    label: "Created",
  },
  modified: {
    badge: "bg-yellow-500/20 text-yellow-300",
    dot: "bg-yellow-400",
    icon: "m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10",
    label: "Modified",
  },
  deleted: {
    badge: "bg-red-500/20 text-red-300",
    dot: "bg-red-400",
    icon: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0",
    label: "Deleted",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileName(filePath: string): string {
  const parts = filePath.split("/");
  return parts.at(-1) ?? filePath;
}

function getDirectory(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(0, -1).join("/");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileChangeViewer({ changes }: FileChangeViewerProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFile((prev) => (prev === filePath ? null : filePath));
  }, []);

  const totalAdded = changes.reduce((sum, c) => sum + c.linesAdded, 0);
  const totalRemoved = changes.reduce((sum, c) => sum + c.linesRemoved, 0);

  const createdCount = changes.filter((c) => c.action === "created").length;
  const modifiedCount = changes.filter((c) => c.action === "modified").length;
  const deletedCount = changes.filter((c) => c.action === "deleted").length;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-zinc-400"
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
          <span className="font-medium text-xs text-zinc-300">
            Files Changed
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            {changes.length}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          {createdCount > 0 && (
            <span className="text-green-400">+{createdCount} new</span>
          )}
          {modifiedCount > 0 && (
            <span className="text-yellow-400">{modifiedCount} modified</span>
          )}
          {deletedCount > 0 && (
            <span className="text-red-400">{deletedCount} deleted</span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="max-h-64 overflow-auto">
        {changes.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-xs text-zinc-600">
            No file changes
          </div>
        ) : (
          changes.map((change) => {
            const style = ACTION_STYLES[change.action];
            const isExpanded = expandedFile === change.filePath;

            return (
              <div
                className="border-zinc-800/50 border-b last:border-b-0"
                key={change.filePath}
              >
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-800/30"
                  onClick={() => toggleFile(change.filePath)}
                  type="button"
                >
                  {/* Action dot */}
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                  />

                  {/* File path */}
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-zinc-200">
                      {getFileName(change.filePath)}
                    </span>
                    {getDirectory(change.filePath) && (
                      <span className="ml-1.5 font-mono text-[10px] text-zinc-600">
                        {getDirectory(change.filePath)}
                      </span>
                    )}
                  </div>

                  {/* Line counts */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {change.linesAdded > 0 && (
                      <span className="font-mono text-[10px] text-green-400">
                        +{change.linesAdded}
                      </span>
                    )}
                    {change.linesRemoved > 0 && (
                      <span className="font-mono text-[10px] text-red-400">
                        -{change.linesRemoved}
                      </span>
                    )}
                  </div>

                  {/* Action badge */}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${style.badge}`}
                  >
                    {style.label}
                  </span>

                  {/* Expand chevron */}
                  <svg
                    aria-hidden="true"
                    className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
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
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-zinc-800/50 border-t bg-zinc-950/50 px-3 py-2">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <svg
                          aria-hidden="true"
                          className={`h-3 w-3 ${
                            change.action === "deleted"
                              ? "text-red-400"
                              : "text-zinc-400"
                          }`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          viewBox="0 0 24 24"
                        >
                          <path
                            d={style.icon}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className="text-[10px] text-zinc-400">
                          {style.label}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {change.linesAdded + change.linesRemoved} lines changed
                      </div>
                      <div className="font-mono text-[10px] text-zinc-600">
                        {change.filePath}
                      </div>
                    </div>

                    {/* Visual diff bar */}
                    {(change.linesAdded > 0 || change.linesRemoved > 0) && (
                      <div className="mt-2 flex items-center gap-1">
                        {Array.from(
                          {
                            length: Math.min(
                              30,
                              change.linesAdded + change.linesRemoved
                            ),
                          },
                          (_, i) => (
                            <div
                              className={`h-2 w-1 rounded-sm ${
                                i < change.linesAdded
                                  ? "bg-green-500"
                                  : "bg-red-500"
                              }`}
                              key={`bar-${String(i)}`}
                            />
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer totals */}
      {changes.length > 0 && (
        <div className="flex items-center justify-between border-zinc-800 border-t px-3 py-2">
          <span className="text-[10px] text-zinc-500">Total</span>
          <div className="flex items-center gap-3 font-mono text-[10px]">
            <span className="text-green-400">+{totalAdded}</span>
            <span className="text-red-400">-{totalRemoved}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export type { FileChange, FileChangeViewerProps };
