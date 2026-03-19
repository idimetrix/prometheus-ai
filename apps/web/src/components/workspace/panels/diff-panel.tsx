"use client";

import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiffViewMode = "unified" | "split";

export interface DiffFile {
  /** Whether this file was deleted */
  isDeleted?: boolean;
  /** Whether this file is newly created */
  isNew?: boolean;
  /** Modified content (empty string for deleted files) */
  newContent: string;
  /** Original content (empty string for new files) */
  oldContent: string;
  /** File path relative to project root */
  path: string;
}

interface DiffLine {
  content: string;
  newLineNum: number | null;
  oldLineNum: number | null;
  type: "addition" | "deletion" | "context" | "header";
}

interface DiffHunk {
  lines: DiffLine[];
  newCount: number;
  newStart: number;
  oldCount: number;
  oldStart: number;
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

/**
 * Compute a line-level diff between two strings using a simple LCS-based
 * algorithm. Produces hunks with context lines around changes.
 */
function computeDiff(
  oldText: string,
  newText: string,
  contextLines = 3
): DiffHunk[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Build the edit script using the LCS approach
  const editOps = computeEditOps(oldLines, newLines);

  // Group into hunks with context
  return buildHunks(editOps, oldLines, newLines, contextLines);
}

interface EditOp {
  newIdx: number;
  oldIdx: number;
  type: "equal" | "insert" | "delete";
}

function computeEditOps(oldLines: string[], newLines: string[]): EditOp[] {
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files, fall back to a simpler approach
  if (m * n > 10_000_000) {
    return simpleDiff(oldLines, newLines);
  }

  // Standard LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    if (!(row && prevRow)) {
      continue;
    }
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }

  // Backtrack to build edit ops
  const ops: EditOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: "equal", oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (
      j > 0 &&
      (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))
    ) {
      ops.unshift({ type: "insert", oldIdx: i - 1, newIdx: j - 1 });
      j--;
    } else {
      ops.unshift({ type: "delete", oldIdx: i - 1, newIdx: j - 1 });
      i--;
    }
  }

  return ops;
}

/** Simple line-by-line diff for very large files */
function simpleDiff(oldLines: string[], newLines: string[]): EditOp[] {
  const ops: EditOp[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < oldLines.length && i < newLines.length) {
      if (oldLines[i] === newLines[i]) {
        ops.push({ type: "equal", oldIdx: i, newIdx: i });
      } else {
        ops.push({ type: "delete", oldIdx: i, newIdx: i });
        ops.push({ type: "insert", oldIdx: i, newIdx: i });
      }
    } else if (i < oldLines.length) {
      ops.push({ type: "delete", oldIdx: i, newIdx: newLines.length });
    } else {
      ops.push({ type: "insert", oldIdx: oldLines.length, newIdx: i });
    }
  }

  return ops;
}

function buildHunks(
  ops: EditOp[],
  oldLines: string[],
  newLines: string[],
  contextLines: number
): DiffHunk[] {
  // Convert ops to DiffLines with line numbers
  const allDiffLines: DiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const op of ops) {
    if (op.type === "equal") {
      allDiffLines.push({
        type: "context",
        oldLineNum,
        newLineNum,
        content: oldLines[op.oldIdx] ?? "",
      });
      oldLineNum++;
      newLineNum++;
    } else if (op.type === "delete") {
      allDiffLines.push({
        type: "deletion",
        oldLineNum,
        newLineNum: null,
        content: oldLines[op.oldIdx] ?? "",
      });
      oldLineNum++;
    } else {
      allDiffLines.push({
        type: "addition",
        oldLineNum: null,
        newLineNum,
        content: newLines[op.newIdx] ?? "",
      });
      newLineNum++;
    }
  }

  // Find change regions and expand with context
  const changeIndices = new Set<number>();
  for (let idx = 0; idx < allDiffLines.length; idx++) {
    const line = allDiffLines[idx];
    if (line && (line.type === "addition" || line.type === "deletion")) {
      for (
        let c = Math.max(0, idx - contextLines);
        c <= Math.min(allDiffLines.length - 1, idx + contextLines);
        c++
      ) {
        changeIndices.add(c);
      }
    }
  }

  if (changeIndices.size === 0) {
    return [];
  }

  // Group consecutive indices into hunks
  const sortedIndices = [...changeIndices].sort((a, b) => a - b);
  const hunks: DiffHunk[] = [];
  let currentHunkLines: DiffLine[] = [];
  let hunkStartOld = 0;
  let hunkStartNew = 0;
  let lastIdx = -2;

  for (const idx of sortedIndices) {
    const line = allDiffLines[idx];
    if (!line) {
      continue;
    }

    // If there's a gap, start a new hunk
    if (idx - lastIdx > 1 && currentHunkLines.length > 0) {
      hunks.push(finalizeHunk(currentHunkLines, hunkStartOld, hunkStartNew));
      currentHunkLines = [];
    }

    if (currentHunkLines.length === 0) {
      hunkStartOld = line.oldLineNum ?? (line.type === "addition" ? 0 : 1);
      hunkStartNew = line.newLineNum ?? (line.type === "deletion" ? 0 : 1);
    }

    currentHunkLines.push(line);
    lastIdx = idx;
  }

  if (currentHunkLines.length > 0) {
    hunks.push(finalizeHunk(currentHunkLines, hunkStartOld, hunkStartNew));
  }

  return hunks;
}

function finalizeHunk(
  lines: DiffLine[],
  startOld: number,
  startNew: number
): DiffHunk {
  let oldCount = 0;
  let newCount = 0;

  for (const line of lines) {
    if (line.type === "context") {
      oldCount++;
      newCount++;
    } else if (line.type === "deletion") {
      oldCount++;
    } else if (line.type === "addition") {
      newCount++;
    }
  }

  return {
    oldStart: startOld,
    oldCount,
    newStart: startNew,
    newCount,
    lines,
  };
}

// ---------------------------------------------------------------------------
// DiffPanel component
// ---------------------------------------------------------------------------

/** Sample diff data for empty state — removed when real data is connected */
const EMPTY_STATE_FILES: DiffFile[] = [];

interface DiffPanelProps {
  /** Files to display diffs for. Falls back to empty state when not provided. */
  files?: DiffFile[];
}

export function DiffPanel({ files }: DiffPanelProps) {
  const diffFiles = files ?? EMPTY_STATE_FILES;
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [expandedHunks, setExpandedHunks] = useState<Set<string>>(new Set());

  const selectedFile = diffFiles[selectedFileIdx];

  const hunks = useMemo(() => {
    if (!selectedFile) {
      return [];
    }
    return computeDiff(selectedFile.oldContent, selectedFile.newContent);
  }, [selectedFile]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === "addition") {
          additions++;
        }
        if (line.type === "deletion") {
          deletions++;
        }
      }
    }
    return { additions, deletions };
  }, [hunks]);

  const toggleHunk = (hunkId: string) => {
    setExpandedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(hunkId)) {
        next.delete(hunkId);
      } else {
        next.add(hunkId);
      }
      return next;
    });
  };

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  if (diffFiles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-950">
        <div className="text-sm text-zinc-600">No changes to display</div>
        <div className="mt-1 text-xs text-zinc-700">
          File diffs will appear here when agents make changes
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <div className="flex items-center gap-3">
          {/* File selector */}
          <select
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-violet-500"
            onChange={(e) => setSelectedFileIdx(Number(e.target.value))}
            value={selectedFileIdx}
          >
            {diffFiles.map((file, idx) => (
              <option key={file.path} value={idx}>
                {file.path}
                {file.isNew ? " (new)" : ""}
                {file.isDeleted ? " (deleted)" : ""}
              </option>
            ))}
          </select>

          {/* Stats */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-400">+{stats.additions}</span>
            <span className="text-red-400">-{stats.deletions}</span>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 rounded border border-zinc-800 p-0.5">
          <button
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              viewMode === "unified"
                ? "bg-violet-500/20 text-violet-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setViewMode("unified")}
            type="button"
          >
            Unified
          </button>
          <button
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              viewMode === "split"
                ? "bg-violet-500/20 text-violet-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setViewMode("split")}
            type="button"
          >
            Split
          </button>
        </div>
      </div>

      {/* File header */}
      {selectedFile && (
        <div className="flex items-center gap-2 border-zinc-800 border-b bg-zinc-900/30 px-3 py-1.5">
          <FileStatusBadge file={selectedFile} />
          <span className="font-mono text-xs text-zinc-400">
            {selectedFile.path}
          </span>
        </div>
      )}

      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        {viewMode === "unified" ? (
          <UnifiedDiffView
            expandedHunks={expandedHunks}
            hunks={hunks}
            onToggleHunk={toggleHunk}
          />
        ) : (
          <SplitDiffView
            expandedHunks={expandedHunks}
            hunks={hunks}
            onToggleHunk={toggleHunk}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FileStatusBadge({ file }: { file: DiffFile }) {
  if (file.isNew) {
    return (
      <span className="rounded bg-green-500/20 px-1.5 py-0.5 font-medium text-[10px] text-green-400">
        NEW
      </span>
    );
  }
  if (file.isDeleted) {
    return (
      <span className="rounded bg-red-500/20 px-1.5 py-0.5 font-medium text-[10px] text-red-400">
        DEL
      </span>
    );
  }
  return (
    <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 font-medium text-[10px] text-yellow-400">
      MOD
    </span>
  );
}

// ---------------------------------------------------------------------------
// Unified diff view
// ---------------------------------------------------------------------------

function UnifiedDiffView({
  hunks,
  expandedHunks,
  onToggleHunk,
}: {
  hunks: DiffHunk[];
  expandedHunks: Set<string>;
  onToggleHunk: (id: string) => void;
}) {
  if (hunks.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-zinc-700">
        Files are identical
      </div>
    );
  }

  return (
    <div className="font-mono text-xs">
      {hunks.map((hunk, hunkIdx) => {
        const hunkId = `hunk-${hunkIdx}`;
        const isCollapsed =
          hunk.lines.length > 50 && !expandedHunks.has(hunkId);

        return (
          <div key={hunkId}>
            {/* Hunk header */}
            <div className="sticky top-0 z-10 flex items-center gap-2 border-zinc-800 border-y bg-zinc-900/80 px-3 py-1 backdrop-blur-sm">
              <span className="text-violet-400">
                @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
                {hunk.newCount} @@
              </span>
              {hunk.lines.length > 50 && (
                <button
                  className="text-[10px] text-zinc-600 hover:text-zinc-400"
                  onClick={() => onToggleHunk(hunkId)}
                  type="button"
                >
                  {isCollapsed
                    ? `Show all ${hunk.lines.length} lines`
                    : "Collapse"}
                </button>
              )}
            </div>

            {/* Lines */}
            {(isCollapsed ? hunk.lines.slice(0, 20) : hunk.lines).map(
              (line) => (
                <div
                  className={`flex leading-5 ${getUnifiedLineBg(line.type)}`}
                  key={`${hunkId}-${line.type}-${line.oldLineNum ?? "n"}-${line.newLineNum ?? "n"}`}
                >
                  {/* Old line number */}
                  <span className="w-12 shrink-0 select-none pr-2 text-right text-zinc-700">
                    {line.oldLineNum ?? ""}
                  </span>
                  {/* New line number */}
                  <span className="w-12 shrink-0 select-none pr-2 text-right text-zinc-700">
                    {line.newLineNum ?? ""}
                  </span>
                  {/* Prefix */}
                  <span
                    className={`w-4 shrink-0 select-none text-center ${getLinePrefixColor(line.type)}`}
                  >
                    {getLinePrefix(line.type)}
                  </span>
                  {/* Content */}
                  <span
                    className={`min-w-0 whitespace-pre-wrap break-all pl-1 ${getLineTextColor(line.type)}`}
                  >
                    {line.content}
                  </span>
                </div>
              )
            )}

            {isCollapsed && (
              <button
                className="w-full border-zinc-800 border-b bg-zinc-900/50 py-1 text-center text-[10px] text-zinc-600 hover:text-zinc-400"
                onClick={() => onToggleHunk(hunkId)}
                type="button"
              >
                ... {hunk.lines.length - 20} more lines (click to expand)
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split diff view
// ---------------------------------------------------------------------------

function SplitDiffView({
  hunks,
  expandedHunks,
  onToggleHunk,
}: {
  hunks: DiffHunk[];
  expandedHunks: Set<string>;
  onToggleHunk: (id: string) => void;
}) {
  // Build paired rows for split view
  const rows = useMemo(() => {
    const result: Array<{
      left: DiffLine | null;
      right: DiffLine | null;
      hunkIdx: number;
    }> = [];

    for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
      const hunk = hunks[hunkIdx];
      if (!hunk) {
        continue;
      }

      // Group consecutive deletions and additions for side-by-side pairing
      let lineIdx = 0;
      while (lineIdx < hunk.lines.length) {
        const line = hunk.lines[lineIdx];
        if (!line) {
          lineIdx++;
          continue;
        }

        if (line.type === "context") {
          result.push({ left: line, right: line, hunkIdx });
          lineIdx++;
        } else if (line.type === "deletion") {
          // Collect consecutive deletions
          const deletions: DiffLine[] = [];
          while (
            lineIdx < hunk.lines.length &&
            hunk.lines[lineIdx]?.type === "deletion"
          ) {
            const delLine = hunk.lines[lineIdx];
            if (delLine) {
              deletions.push(delLine);
            }
            lineIdx++;
          }

          // Collect consecutive additions
          const additions: DiffLine[] = [];
          while (
            lineIdx < hunk.lines.length &&
            hunk.lines[lineIdx]?.type === "addition"
          ) {
            const addLine = hunk.lines[lineIdx];
            if (addLine) {
              additions.push(addLine);
            }
            lineIdx++;
          }

          // Pair them up
          const maxPairs = Math.max(deletions.length, additions.length);
          for (let p = 0; p < maxPairs; p++) {
            result.push({
              left: deletions[p] ?? null,
              right: additions[p] ?? null,
              hunkIdx,
            });
          }
        } else {
          // Standalone addition (no paired deletion)
          result.push({ left: null, right: line, hunkIdx });
          lineIdx++;
        }
      }
    }

    return result;
  }, [hunks]);

  if (hunks.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-zinc-700">
        Files are identical
      </div>
    );
  }

  return (
    <div className="font-mono text-xs">
      {/* Hunk headers */}
      {hunks.map((hunk, hunkIdx) => {
        const hunkId = `split-hunk-${hunkIdx}`;
        const hunkRows = rows.filter((r) => r.hunkIdx === hunkIdx);
        const isCollapsed = hunkRows.length > 50 && !expandedHunks.has(hunkId);
        const displayRows = isCollapsed ? hunkRows.slice(0, 20) : hunkRows;

        return (
          <div key={hunkId}>
            {/* Hunk header */}
            <div className="sticky top-0 z-10 flex items-center gap-2 border-zinc-800 border-y bg-zinc-900/80 px-3 py-1 backdrop-blur-sm">
              <span className="text-violet-400">
                @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
                {hunk.newCount} @@
              </span>
              {hunkRows.length > 50 && (
                <button
                  className="text-[10px] text-zinc-600 hover:text-zinc-400"
                  onClick={() => onToggleHunk(hunkId)}
                  type="button"
                >
                  {isCollapsed
                    ? `Show all ${hunkRows.length} rows`
                    : "Collapse"}
                </button>
              )}
            </div>

            {/* Split rows */}
            {displayRows.map((row) => (
              <div
                className="flex"
                key={`${hunkId}-${row.left?.oldLineNum ?? "n"}-${row.right?.newLineNum ?? "n"}-${row.left?.type ?? "e"}-${row.right?.type ?? "e"}`}
              >
                {/* Left side (old) */}
                <div
                  className={`flex w-1/2 border-zinc-800/50 border-r leading-5 ${getSplitLineBg(row.left?.type ?? null, "old")}`}
                >
                  <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-700">
                    {row.left?.oldLineNum ?? ""}
                  </span>
                  <span
                    className={`w-4 shrink-0 select-none text-center ${row.left?.type === "deletion" ? "text-red-500" : "text-zinc-700"}`}
                  >
                    {row.left?.type === "deletion" ? "-" : " "}
                  </span>
                  <span
                    className={`min-w-0 whitespace-pre-wrap break-all pl-1 ${row.left?.type === "deletion" ? "text-red-300" : "text-zinc-400"}`}
                  >
                    {row.left?.content ?? ""}
                  </span>
                </div>

                {/* Right side (new) */}
                <div
                  className={`flex w-1/2 leading-5 ${getSplitLineBg(row.right?.type ?? null, "new")}`}
                >
                  <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-700">
                    {row.right?.newLineNum ?? ""}
                  </span>
                  <span
                    className={`w-4 shrink-0 select-none text-center ${row.right?.type === "addition" ? "text-green-500" : "text-zinc-700"}`}
                  >
                    {row.right?.type === "addition" ? "+" : " "}
                  </span>
                  <span
                    className={`min-w-0 whitespace-pre-wrap break-all pl-1 ${row.right?.type === "addition" ? "text-green-300" : "text-zinc-400"}`}
                  >
                    {row.right?.content ?? ""}
                  </span>
                </div>
              </div>
            ))}

            {isCollapsed && (
              <button
                className="w-full border-zinc-800 border-b bg-zinc-900/50 py-1 text-center text-[10px] text-zinc-600 hover:text-zinc-400"
                onClick={() => onToggleHunk(hunkId)}
                type="button"
              >
                ... {hunkRows.length - 20} more rows (click to expand)
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function getUnifiedLineBg(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "bg-green-500/10";
    case "deletion":
      return "bg-red-500/10";
    default:
      return "";
  }
}

function getSplitLineBg(
  type: DiffLine["type"] | null,
  side: "old" | "new"
): string {
  if (type === "deletion" && side === "old") {
    return "bg-red-500/10";
  }
  if (type === "addition" && side === "new") {
    return "bg-green-500/10";
  }
  if (type === "context") {
    return "";
  }
  // Empty side when the other side has a change
  if (type === null) {
    return "bg-zinc-900/30";
  }
  return "";
}

function getLinePrefix(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return " ";
  }
}

function getLinePrefixColor(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-green-500";
    case "deletion":
      return "text-red-500";
    default:
      return "text-zinc-700";
  }
}

function getLineTextColor(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-green-300";
    case "deletion":
      return "text-red-300";
    default:
      return "text-zinc-400";
  }
}
