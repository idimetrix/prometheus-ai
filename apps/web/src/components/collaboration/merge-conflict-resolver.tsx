"use client";

import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ConflictHunk {
  base: string;
  endLine: number;
  id: string;
  ours: string;
  startLine: number;
  theirs: string;
}

export interface ConflictFile {
  conflicts: ConflictHunk[];
  filePath: string;
  language?: string;
}

export type ConflictAction =
  | "accept-current"
  | "accept-incoming"
  | "accept-both"
  | "manual-edit";

export interface ConflictResolutionState {
  action: ConflictAction;
  conflictId: string;
  manualContent?: string;
}

export interface MergeConflictResolverProps {
  className?: string;
  files: ConflictFile[];
  onResolveAll?: (
    action: "accept-current" | "accept-incoming",
    filePath: string
  ) => void;
  onResolveConflict?: (
    filePath: string,
    conflictId: string,
    action: ConflictAction,
    content?: string
  ) => void;
  onSaveResolution?: (
    filePath: string,
    resolutions: ConflictResolutionState[]
  ) => void;
}

/* -------------------------------------------------------------------------- */
/*  Icons                                                                      */
/* -------------------------------------------------------------------------- */

function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-zinc-500"
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
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        d="M4.5 12.75l6 6 9-13.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Conflict Markers Highlighting                                              */
/* -------------------------------------------------------------------------- */

function _highlightConflictMarkers(text: string): Array<{
  content: string;
  type: "marker" | "content";
}> {
  const parts: Array<{ content: string; type: "marker" | "content" }> = [];
  const lines = text.split("\n");

  for (const line of lines) {
    if (
      line.startsWith("<<<<<<<") ||
      line.startsWith("=======") ||
      line.startsWith(">>>>>>>")
    ) {
      parts.push({ content: line, type: "marker" });
    } else {
      parts.push({ content: line, type: "content" });
    }
  }

  return parts;
}

/* -------------------------------------------------------------------------- */
/*  Three-Way Diff Panel                                                       */
/* -------------------------------------------------------------------------- */

function DiffColumn({
  content,
  label,
  labelColor,
}: {
  content: string;
  label: string;
  labelColor: string;
}) {
  const lines = content.split("\n");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        className={`px-3 py-1 font-medium text-[10px] uppercase tracking-wider ${labelColor}`}
      >
        {label}
      </div>
      <div className="flex-1 overflow-auto bg-zinc-950/50 p-2">
        <pre className="font-mono text-xs text-zinc-300 leading-5">
          {lines.map((line, lineNumber) => {
            const lineKey = `${label}-${lineNumber.toString()}`;
            return (
              <div
                className="whitespace-pre-wrap break-all px-1 hover:bg-zinc-800/30"
                key={lineKey}
              >
                <span className="mr-3 inline-block w-6 select-none text-right text-zinc-600">
                  {lineNumber + 1}
                </span>
                {line || " "}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Single Conflict Hunk                                                       */
/* -------------------------------------------------------------------------- */

function ConflictHunkView({
  hunk,
  resolution,
  onResolve,
  onManualEdit,
}: {
  hunk: ConflictHunk;
  onManualEdit: (conflictId: string, content: string) => void;
  onResolve: (conflictId: string, action: ConflictAction) => void;
  resolution: ConflictResolutionState | undefined;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(hunk.ours);

  const isResolved = resolution !== undefined;

  const resolvedContent = useMemo(() => {
    if (!resolution) {
      return null;
    }
    switch (resolution.action) {
      case "accept-current":
        return hunk.ours;
      case "accept-incoming":
        return hunk.theirs;
      case "accept-both":
        return `${hunk.ours}\n${hunk.theirs}`;
      case "manual-edit":
        return resolution.manualContent ?? hunk.ours;
      default:
        return null;
    }
  }, [resolution, hunk]);

  const handleManualSave = useCallback(() => {
    onManualEdit(hunk.id, editContent);
    setIsEditing(false);
  }, [hunk.id, editContent, onManualEdit]);

  return (
    <div
      className={`rounded-md border ${
        isResolved
          ? "border-green-900/40 bg-green-950/10"
          : "border-zinc-700 bg-zinc-900/40"
      }`}
    >
      {/* Hunk header */}
      <div className="flex items-center justify-between border-zinc-700 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">
            Lines {hunk.startLine}-{hunk.endLine}
          </span>
          {isResolved && (
            <span className="flex items-center gap-1 text-green-400 text-xs">
              <CheckIcon />
              Resolved ({resolution.action})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className={`rounded px-2 py-1 text-[11px] transition-colors ${
              resolution?.action === "accept-current"
                ? "bg-blue-600 text-white"
                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            }`}
            onClick={() => onResolve(hunk.id, "accept-current")}
            title="Accept Current (Ours)"
            type="button"
          >
            Accept Current
          </button>
          <button
            className={`rounded px-2 py-1 text-[11px] transition-colors ${
              resolution?.action === "accept-incoming"
                ? "bg-violet-600 text-white"
                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            }`}
            onClick={() => onResolve(hunk.id, "accept-incoming")}
            title="Accept Incoming (Theirs)"
            type="button"
          >
            Accept Incoming
          </button>
          <button
            className={`rounded px-2 py-1 text-[11px] transition-colors ${
              resolution?.action === "accept-both"
                ? "bg-emerald-600 text-white"
                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            }`}
            onClick={() => onResolve(hunk.id, "accept-both")}
            title="Accept Both"
            type="button"
          >
            Accept Both
          </button>
          <button
            className={`rounded px-2 py-1 text-[11px] transition-colors ${
              isEditing
                ? "bg-amber-600 text-white"
                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            }`}
            onClick={() => setIsEditing(!isEditing)}
            title="Manual Edit"
            type="button"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Three-way diff */}
      {!(isEditing || resolvedContent) && (
        <div className="flex divide-x divide-zinc-700">
          <DiffColumn
            content={hunk.base}
            label="Base"
            labelColor="text-zinc-500"
          />
          <DiffColumn
            content={hunk.ours}
            label="Current (Ours)"
            labelColor="text-blue-400"
          />
          <DiffColumn
            content={hunk.theirs}
            label="Incoming (Theirs)"
            labelColor="text-violet-400"
          />
        </div>
      )}

      {/* Resolved preview */}
      {resolvedContent && !isEditing && (
        <div className="p-3">
          <div className="mb-1 font-medium text-[10px] text-green-400 uppercase">
            Resolved Result
          </div>
          <pre className="overflow-auto rounded bg-zinc-950/50 p-3 font-mono text-xs text-zinc-300">
            {resolvedContent}
          </pre>
        </div>
      )}

      {/* Manual edit area */}
      {isEditing && (
        <div className="p-3">
          <div className="mb-2 font-medium text-[10px] text-amber-400 uppercase">
            Manual Resolution
          </div>
          <textarea
            className="w-full rounded border border-zinc-600 bg-zinc-950 p-3 font-mono text-xs text-zinc-300 focus:border-violet-500 focus:outline-none"
            onChange={(e) => setEditContent(e.target.value)}
            rows={Math.max(editContent.split("\n").length, 5)}
            value={editContent}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
              onClick={() => setIsEditing(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded bg-violet-600 px-3 py-1 text-white text-xs hover:bg-violet-500"
              onClick={handleManualSave}
              type="button"
            >
              Save Resolution
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  File-Level Conflict View                                                   */
/* -------------------------------------------------------------------------- */

function ConflictFileView({
  file,
  resolutions,
  onResolve,
  onManualEdit,
  onResolveAll,
  onSaveResolution,
}: {
  file: ConflictFile;
  onManualEdit: (filePath: string, conflictId: string, content: string) => void;
  onResolve: (
    filePath: string,
    conflictId: string,
    action: ConflictAction
  ) => void;
  onResolveAll: (
    action: "accept-current" | "accept-incoming",
    filePath: string
  ) => void;
  onSaveResolution: (
    filePath: string,
    resolutions: ConflictResolutionState[]
  ) => void;
  resolutions: Map<string, ConflictResolutionState>;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  const resolvedCount = file.conflicts.filter((c) =>
    resolutions.has(c.id)
  ).length;
  const totalCount = file.conflicts.length;
  const allResolved = resolvedCount === totalCount;

  const handleSave = useCallback(() => {
    onSaveResolution(file.filePath, [...resolutions.values()]);
  }, [file.filePath, onSaveResolution, resolutions]);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/60">
      {/* File header */}
      <button
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={`h-3 w-3 text-zinc-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M8.25 4.5l7.5 7.5-7.5 7.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <FileIcon />
        <span className="flex-1 truncate font-mono text-sm text-zinc-200">
          {file.filePath}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${
            allResolved
              ? "bg-green-900/30 text-green-400"
              : "bg-amber-900/30 text-amber-400"
          }`}
        >
          {resolvedCount}/{totalCount} resolved
        </span>
      </button>

      {isExpanded && (
        <div className="border-zinc-700 border-t px-4 py-3">
          {/* Bulk actions */}
          <div className="mb-3 flex items-center gap-2">
            <button
              className="rounded bg-blue-600/80 px-2.5 py-1 text-[11px] text-white hover:bg-blue-500"
              onClick={() => onResolveAll("accept-current", file.filePath)}
              type="button"
            >
              Resolve All: Accept Current
            </button>
            <button
              className="rounded bg-violet-600/80 px-2.5 py-1 text-[11px] text-white hover:bg-violet-500"
              onClick={() => onResolveAll("accept-incoming", file.filePath)}
              type="button"
            >
              Resolve All: Accept Incoming
            </button>
            {allResolved && (
              <button
                className="ml-auto rounded bg-green-600 px-3 py-1 text-[11px] text-white hover:bg-green-500"
                onClick={handleSave}
                type="button"
              >
                Save Resolution
              </button>
            )}
          </div>

          {/* Conflict hunks */}
          <div className="flex flex-col gap-3">
            {file.conflicts.map((hunk) => (
              <ConflictHunkView
                hunk={hunk}
                key={hunk.id}
                onManualEdit={(cid, content) =>
                  onManualEdit(file.filePath, cid, content)
                }
                onResolve={(cid, action) =>
                  onResolve(file.filePath, cid, action)
                }
                resolution={resolutions.get(hunk.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function MergeConflictResolver({
  files,
  onResolveConflict,
  onResolveAll,
  onSaveResolution,
  className = "",
}: MergeConflictResolverProps) {
  // resolutions keyed by "filePath::conflictId"
  const [resolutions, setResolutions] = useState<
    Map<string, ConflictResolutionState>
  >(new Map());

  const getFileResolutions = useCallback(
    (filePath: string): Map<string, ConflictResolutionState> => {
      const fileResolutions = new Map<string, ConflictResolutionState>();
      for (const [key, value] of resolutions) {
        if (key.startsWith(`${filePath}::`)) {
          const conflictId = key.slice(filePath.length + 2);
          fileResolutions.set(conflictId, value);
        }
      }
      return fileResolutions;
    },
    [resolutions]
  );

  const handleResolve = useCallback(
    (filePath: string, conflictId: string, action: ConflictAction) => {
      const key = `${filePath}::${conflictId}`;
      setResolutions((prev) => {
        const next = new Map(prev);
        next.set(key, { conflictId, action });
        return next;
      });
      onResolveConflict?.(filePath, conflictId, action);
    },
    [onResolveConflict]
  );

  const handleManualEdit = useCallback(
    (filePath: string, conflictId: string, content: string) => {
      const key = `${filePath}::${conflictId}`;
      setResolutions((prev) => {
        const next = new Map(prev);
        next.set(key, {
          conflictId,
          action: "manual-edit",
          manualContent: content,
        });
        return next;
      });
      onResolveConflict?.(filePath, conflictId, "manual-edit", content);
    },
    [onResolveConflict]
  );

  const handleResolveAll = useCallback(
    (action: "accept-current" | "accept-incoming", filePath: string) => {
      const file = files.find((f) => f.filePath === filePath);
      if (!file) {
        return;
      }

      setResolutions((prev) => {
        const next = new Map(prev);
        for (const hunk of file.conflicts) {
          next.set(`${filePath}::${hunk.id}`, {
            conflictId: hunk.id,
            action,
          });
        }
        return next;
      });

      onResolveAll?.(action, filePath);
    },
    [files, onResolveAll]
  );

  const handleSaveResolution = useCallback(
    (filePath: string, fileResolutions: ConflictResolutionState[]) => {
      onSaveResolution?.(filePath, fileResolutions);
    },
    [onSaveResolution]
  );

  const totalConflicts = files.reduce((sum, f) => sum + f.conflicts.length, 0);
  const totalResolved = [...resolutions.values()].length;

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <h2 className="font-semibold text-lg text-zinc-200">
              Merge Conflicts
            </h2>
          </div>
          <span className="text-sm text-zinc-500">
            {files.length} file{files.length === 1 ? "" : "s"} with{" "}
            {totalConflicts} conflict{totalConflicts === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${
              totalResolved === totalConflicts
                ? "text-green-400"
                : "text-zinc-400"
            }`}
          >
            {totalResolved}/{totalConflicts} resolved
          </span>
        </div>
      </div>

      {/* File list */}
      <div className="flex flex-col gap-3">
        {files.map((file) => (
          <ConflictFileView
            file={file}
            key={file.filePath}
            onManualEdit={handleManualEdit}
            onResolve={handleResolve}
            onResolveAll={handleResolveAll}
            onSaveResolution={handleSaveResolution}
            resolutions={getFileResolutions(file.filePath)}
          />
        ))}
      </div>
    </div>
  );
}
